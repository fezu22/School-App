import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import PrincipalTask from '../src/staff/src/models/principalTask';
import SafetyAlert from '../src/staff/src/models/safetyAlert';
import {processSafetyAlertAction} from '../src/staff/src/services/safety-alert.service';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {PERMISSIONS} from '../src/staff/src/constants/permissions';

// Real transactions and independent competing writes; never a configured DB.
let db: MongoMemoryReplSet, server: Server, base: string;
let branch: mongoose.Types.ObjectId, foreignBranch: mongoose.Types.ObjectId;
let principal: mongoose.Types.ObjectId, peer: mongoose.Types.ObjectId, teacher: mongoose.Types.ObjectId;
let token: string, request: mongoose.Types.ObjectId, task: mongoose.Types.ObjectId, alert: mongoose.Types.ObjectId;
const saved = {jwt: process.env.JWT_SECRET, policy: process.env.PRINCIPAL_APPROVAL_AUTHORITY};
const permissions = [...ROLE_PERMISSIONS.principal];

before(async () => {
  db = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(db.getUri(), {dbName: 'principal_commit_authority', autoIndex: false});
  // Create collections before the first transaction (including on older Mongo).
  for (const model of [Branch, User, Session, ApprovalRequest, PrincipalTask, SafetyAlert]) await model.createCollection();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});
beforeEach(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = [...permissions];
  process.env.JWT_SECRET = 'principal-commit-isolated-fixture';
  for (const model of [ApprovalRequest, PrincipalTask, Session, User, Branch, SafetyAlert]) await model.collection.deleteMany({});
  branch = (await Branch.create({name: 'Branch A', code: 'AA', address: 'fixture', city: 'fixture'}))._id;
  foreignBranch = (await Branch.create({name: 'Branch B', code: 'BB', address: 'fixture', city: 'fixture'}))._id;
  const createUser = async (name: string, role: 'principal' | 'teacher') => (await new User({
    fullName: name, email: `${name}@fixture.invalid`, password: 'fixture', role, branchId: branch,
  }).save())._id;
  principal = await createUser('principal', 'principal');
  peer = await createUser('peer', 'principal');
  teacher = await createUser('teacher', 'teacher');
  token = generateAccessToken(String(principal), 'principal');
  await registerSession(String(principal), token, 'principal');
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(Object.fromEntries([principal, peer].map(id =>
    [String(id), {branchId: String(branch), types: ['leave']}])));
  request = (await ApprovalRequest.create({branchId: branch, requesterId: teacher, entityType: 'user', entityId: teacher,
    approvalType: 'leave', reason: 'Fixture'}))._id;
  task = (await new PrincipalTask({branchId: branch, createdBy: principal, assignedTo: principal, title: 'Fixture'}).save())._id;
  alert = (await new SafetyAlert({branchId: branch, type: 'incident', title: 'Fixture'}).save())._id;
});
after(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = permissions;
  for (const [key, value] of Object.entries({JWT_SECRET: saved.jwt, PRINCIPAL_APPROVAL_AUTHORITY: saved.policy})) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (db) await db.stop();
});
async function http(path: string, method: string, body?: unknown, extraHeaders = {}) {
  const response = await fetch(base + path, {method, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders,
  }, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, body: await response.json()};
}
const approve = (action = 'approved', extra = {}) => http(`/approval-requests/${request}`, 'PATCH', {action, ...extra});
const complete = (action = 'complete') => http(`/principal/tasks/${task}`, 'PATCH', {action});
const createTask = () => http('/principal/tasks', 'POST', {title: 'New task', assignedTo: String(teacher)});

// The external change is committed immediately before the real target CAS.
// It is deliberately outside the request's session and fires only once so a
// driver transaction retry cannot erase or repeat the competing operation.
function beforeTarget(model: typeof ApprovalRequest | typeof PrincipalTask | typeof SafetyAlert, change: () => Promise<unknown>) {
  const original = model.findOneAndUpdate.bind(model);
  let fired = false;
  mock.method(model, 'findOneAndUpdate', async (...args: Parameters<typeof original>) => {
    if (!fired) {fired = true; await change();}
    return Reflect.apply(original, model, args);
  });
}
const changes = {
  transfer: () => User.collection.updateOne({_id: principal}, {$set: {branchId: foreignBranch}}),
  demotion: () => User.collection.updateOne({_id: principal}, {$set: {role: 'teacher'}}),
  disabled: () => User.collection.updateOne({_id: principal}, {$set: {isActive: false}}),
  deleted: () => User.collection.deleteOne({_id: principal}),
  revoked: () => Session.collection.updateMany({token}, {$set: {isRevoked: true}}),
  'deleted session': () => Session.collection.deleteMany({token}),
  'inactive Branch': () => Branch.collection.updateOne({_id: branch}, {$set: {isActive: false}}),
  permission: async () => {ROLE_PERMISSIONS.principal = permissions.filter(p =>
    p !== PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE && p !== PERMISSIONS.PRINCIPAL_TASKS_MANAGE && p !== PERMISSIONS.PRINCIPAL_SAFETY_MANAGE);},
};
for (const [name, change] of Object.entries(changes)) {
  for (const kind of ['approval', 'task'] as const) test(`${kind}: ${name} before target write aborts target and history`, async () => {
    const model = kind === 'approval' ? ApprovalRequest : PrincipalTask;
    const id = kind === 'approval' ? request : task;
    const beforeState = await model.collection.findOne({_id: id});
    beforeTarget(model, change);
    const result = await (kind === 'approval' ? approve() : complete());
    assert.equal(result.status, name.includes('session') || name === 'revoked' ? 401 : 403, JSON.stringify(result.body));
    assert.deepEqual(await model.collection.findOne({_id: id}), beforeState);
  });
}

// Also exercise a change AFTER a target write has succeeded provisionally in
// the transaction. A mere second pre-write check would fail these tests.
for (const kind of ['approval', 'task'] as const) test(`${kind}: transfer after provisional target update rolls it back`, async () => {
  const model = kind === 'approval' ? ApprovalRequest : PrincipalTask;
  const id = kind === 'approval' ? request : task;
  const beforeState = await model.collection.findOne({_id: id});
  const original = model.findOneAndUpdate.bind(model);
  let changed = false;
  mock.method(model, 'findOneAndUpdate', async (...args: Parameters<typeof original>) => {
    const result = await Reflect.apply(original, model, args);
    if (!changed) {changed = true; await changes.transfer();}
    return result;
  });
  assert.equal((await (kind === 'approval' ? approve() : complete())).status, 403);
  assert.deepEqual(await model.collection.findOne({_id: id}), beforeState);
});

for (const action of ['approved', 'rejected', 'changes_requested', 'delegated']) test(`${action}: valid active Principal succeeds`, async () => {
  const extra = action === 'delegated' ? {delegatedTo: String(peer), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()}
    : action === 'approved' ? {} : {reason: 'Please correct'};
  assert.equal((await approve(action, extra)).status, 200);
  const state = await ApprovalRequest.findById(request).lean();
  assert.equal(state?.status, action === 'delegated' ? 'pending' : action);
  assert.equal(state?.history.length, 1);
});
for (const action of ['start', 'complete', 'cancel']) test(`task ${action}: active own Branch allowed`, async () => {
  assert.equal((await complete(action)).status, 200);
  const state = await PrincipalTask.findById(task).lean();
  assert.equal(state?.status, {start: 'in_progress', complete: 'completed', cancel: 'cancelled'}[action]);
  assert.equal(state?.history.length, 1);
});
test('task create: valid assignee and actor commit once', async () => {
  assert.equal((await createTask()).status, 201);
  assert.equal(await PrincipalTask.countDocuments({title: 'New task'}), 1);
});
for (const action of ['approved', 'rejected', 'changes_requested', 'delegated']) test(`${action}: lost authority rolls back history and delegation`, async () => {
  const beforeState = await ApprovalRequest.findById(request).lean();
  beforeTarget(ApprovalRequest, changes.transfer);
  assert.equal((await approve(action, {reason: 'Fixture', ...(action === 'delegated' ? {
    delegatedTo: String(peer), delegationExpiresAt: new Date(Date.now() + 60000).toISOString(),
  } : {})})).status, 403);
  assert.deepEqual(await ApprovalRequest.findById(request).lean(), beforeState);
});
for (const change of ['actor', 'assignee'] as const) test(`task create: ${change} transferred after provisional insert aborts creation`, async () => {
  const original = PrincipalTask.prototype.save;
  let changed = false;
  mock.method(PrincipalTask.prototype, 'save', async function (this: InstanceType<typeof PrincipalTask>, ...args: Parameters<typeof original>) {
    const result = await original.apply(this, args);
    if (!changed) {changed = true; await User.collection.updateOne({_id: change === 'actor' ? principal : teacher}, {$set: {branchId: foreignBranch}});}
    return result;
  });
  assert.equal((await createTask()).status, 403);
  assert.equal(await PrincipalTask.countDocuments({title: 'New task'}), 0);
});
for (const operation of ['create', 'start', 'complete', 'cancel', 'approve'] as const) test(`inactive own Branch rejects ${operation}`, async () => {
  await changes['inactive Branch']();
  const beforeState = await PrincipalTask.findById(task).lean();
  const beforeApproval = await ApprovalRequest.findById(request).lean();
  const result = await (operation === 'create' ? createTask() : operation === 'approve' ? approve() : complete(operation));
  assert.equal(result.status, 403);
  assert.deepEqual(await PrincipalTask.findById(task).lean(), beforeState);
  assert.deepEqual(await ApprovalRequest.findById(request).lean(), beforeApproval);
  assert.equal(await PrincipalTask.countDocuments({title: 'New task'}), 0);
});
for (const isActive of [true, false]) test(`foreign Branch active=${isActive} remains concealed for tasks and approvals`, async () => {
  await Branch.updateOne({_id: foreignBranch}, {$set: {isActive}});
  await ApprovalRequest.collection.updateOne({_id: request}, {$set: {branchId: foreignBranch}});
  await PrincipalTask.collection.updateOne({_id: task}, {$set: {branchId: foreignBranch}});
  const a = await ApprovalRequest.findById(request).lean(), t = await PrincipalTask.findById(task).lean();
  assert.equal((await approve()).status, 404);
  assert.equal((await complete()).status, 404);
  assert.deepEqual(await ApprovalRequest.findById(request).lean(), a);
  assert.deepEqual(await PrincipalTask.findById(task).lean(), t);
});
test('duplicate approval has one decision and one history entry', async () => {
  const results = await Promise.all([approve(), approve()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await ApprovalRequest.findById(request).lean())?.history.length, 1);
});
test('duplicate task completion has one history entry', async () => {
  const results = await Promise.all([complete(), complete()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await PrincipalTask.findById(task).lean())?.history.length, 1);
});
test('target revision CAS is preserved for approvals and tasks', async () => {
  for (const model of [ApprovalRequest, PrincipalTask]) {
    const id = model === ApprovalRequest ? request : task;
    beforeTarget(model, () => model.collection.updateOne({_id: id}, {$inc: {__v: 1}}));
    assert.equal((await (model === ApprovalRequest ? approve() : complete())).status, 409);
    assert.equal((await model.collection.findOne({_id: id}))?.history.length, 0);
    mock.restoreAll();
  }
});
test('delegate transfer before delegation commit rejects the whole operation', async () => {
  beforeTarget(ApprovalRequest, () => User.collection.updateOne({_id: peer}, {$set: {branchId: foreignBranch}}));
  assert.equal((await approve('delegated', {delegatedTo: String(peer), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()})).status, 403);
  const state = await ApprovalRequest.findById(request).lean();
  assert.equal(state?.history.length, 0);
  assert.equal(state?.delegatedTo, undefined);
});
test('delegator loses authority before delegate decision: no decision history', async () => {
  await ApprovalRequest.updateOne({_id: request}, {$set: {delegatedTo: principal, delegatedBy: peer, delegationExpiresAt: new Date(Date.now() + 60000)}});
  const beforeState = await ApprovalRequest.findById(request).lean();
  beforeTarget(ApprovalRequest, () => User.collection.updateOne({_id: peer}, {$set: {role: 'teacher'}}));
  assert.equal((await approve()).status, 403);
  assert.deepEqual(await ApprovalRequest.findById(request).lean(), beforeState);
});
test('policy removed during final write fails closed without committed decision', async () => {
  beforeTarget(ApprovalRequest, async () => {process.env.PRINCIPAL_APPROVAL_AUTHORITY = '{}';});
  assert.equal((await approve()).status, 403);
  assert.equal((await ApprovalRequest.findById(request).lean())?.history.length, 0);
});
test('inactive Branch historical task reads retain existing access', async () => {
  await changes['inactive Branch']();
  assert.equal((await http(`/principal/tasks/${task}`, 'GET')).status, 200);
});

for (const [name, change] of Object.entries(changes)) test(`task create: ${name} after provisional insert leaves no task`, async () => {
  const original = PrincipalTask.prototype.save;
  let changed = false;
  mock.method(PrincipalTask.prototype, 'save', async function (this: InstanceType<typeof PrincipalTask>, ...args: Parameters<typeof original>) {
    const result = await original.apply(this, args);
    if (!changed) {changed = true; await change();}
    return result;
  });
  assert.equal((await createTask()).status, name.includes('session') || name === 'revoked' ? 401 : 403);
  assert.equal(await PrincipalTask.countDocuments({title: 'New task'}), 0);
});
test('revoked authenticated token record cannot be replaced by a duplicate valid row', async () => {
  beforeTarget(ApprovalRequest, async () => {
    await Session.collection.updateMany({token}, {$set: {isRevoked: true}});
    await registerSession(String(principal), token, 'principal');
  });
  assert.equal((await approve()).status, 401);
  assert.equal((await ApprovalRequest.findById(request).lean())?.history.length, 0);
});

for (const kind of ['principal', 'teacher'] as const) test(`requester resubmission (${kind}) is fenced and remains functional`, async () => {
  const requester = kind === 'principal' ? principal : teacher;
  token = generateAccessToken(String(requester), kind);
  await registerSession(String(requester), token, kind);
  await ApprovalRequest.updateOne({_id: request}, {$set: {requesterId: requester, entityId: requester, status: 'changes_requested'}});
  const details = await http(`/approval-requests/${request}/resubmission`, 'GET');
  const revision = details.body.data.revision;
  assert.equal((await http(`/approval-requests/${request}/resubmit`, 'PATCH', {reason: 'Corrected'}, {'If-Match': `"${revision}"`})).status, 200);
  assert.equal((await ApprovalRequest.findById(request).lean())?.status, 'pending');
});
test('Principal requester transfer before resubmission commit rolls back pending/history', async () => {
  await ApprovalRequest.updateOne({_id: request}, {$set: {requesterId: principal, entityId: principal, status: 'changes_requested'}});
  const details = await http(`/approval-requests/${request}/resubmission`, 'GET');
  const beforeState = await ApprovalRequest.findById(request).lean();
  beforeTarget(ApprovalRequest, changes.transfer);
  assert.equal((await http(`/approval-requests/${request}/resubmit`, 'PATCH', {reason: 'Corrected'}, {'If-Match': `"${details.body.data.revision}"`})).status, 403);
  assert.deepEqual(await ApprovalRequest.findById(request).lean(), beforeState);
});

for (const [name, change] of Object.entries(changes)) test(`shared Safety authority: ${name} rolls back target and history`, async () => {
  const beforeState = await SafetyAlert.findById(alert).lean();
  beforeTarget(SafetyAlert, change);
  const result = await http(`/principal/safety-alerts/${alert}`, 'PATCH', {action: 'resolve'});
  assert.equal(result.status, name.includes('session') || name === 'revoked' ? 401 : 403);
  assert.deepEqual(await SafetyAlert.findById(alert).lean(), beforeState);
});
for (const action of ['assign', 'resolve', 'escalate'] as const) test(`shared Safety ${action}: active Branch service still commits`, async () => {
  // Service-level success intentionally avoids asserting the known P-PR2 HTTP
  // response bug away. Its void return and controller are left unchanged.
  await processSafetyAlertAction({alertId: String(alert), actorId: String(principal), branchId: String(branch), token,
    action, ...(action === 'assign' ? {assignedTo: String(teacher)} : {})});
  assert.equal((await SafetyAlert.findById(alert).lean())?.history.length, 1);
});
test('shared Safety assignment fences assignee transfer', async () => {
  const beforeState = await SafetyAlert.findById(alert).lean();
  beforeTarget(SafetyAlert, () => User.collection.updateOne({_id: teacher}, {$set: {branchId: foreignBranch}}));
  assert.equal((await http(`/principal/safety-alerts/${alert}`, 'PATCH', {action: 'assign', assignedTo: String(teacher)})).status, 403);
  assert.deepEqual(await SafetyAlert.findById(alert).lean(), beforeState);
});
