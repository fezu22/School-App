import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import {request as nodeRequest} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, {UserRole} from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import PrincipalTask from '../src/staff/src/models/principalTask';
import SafetyAlert from '../src/staff/src/models/safetyAlert';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {PERMISSIONS} from '../src/staff/src/constants/permissions';
import {dateField, objectBody} from '../src/staff/src/utils/request-validation';
import {createPrincipalTask, processPrincipalTaskAction} from '../src/staff/src/services/principal-task.service';
import {processSafetyAlertAction} from '../src/staff/src/services/safety-alert.service';

// This suite never imports dotenv/config or reads MONGODB_URI.
let database: MongoMemoryReplSet;
let server: Server;
let base: string;
const originalJwt = process.env.JWT_SECRET;
const originalAuthority = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
type Actor = {id: mongoose.Types.ObjectId; token: string};
let principal: Actor, peer: Actor, teacher: Actor, student: Actor, foreign: Actor, admin: Actor;
let branch: mongoose.Types.ObjectId, otherBranch: mongoose.Types.ObjectId;
const future = () => new Date(Date.now() + 86400000).toISOString();

before(async () => {
  database = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(database.getUri(), {dbName: 'principal_write_contract_tests', autoIndex: false});
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

const actor = async (name: string, role: UserRole, branchId?: mongoose.Types.ObjectId): Promise<Actor> => {
  const user = await new User({fullName: name, email: `${name}@test.invalid`, password: 'fixture-only', role, branchId}).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return {id: user._id, token};
};

beforeEach(async () => {
  mock.restoreAll();
  process.env.JWT_SECRET = 'isolated-principal-write-test-secret';
  for (const model of [PrincipalTask, SafetyAlert, ApprovalRequest, Session, User, Branch]) await model.collection.deleteMany({});
  branch = (await Branch.create({name: 'Branch A', code: 'AA', address: 'test', city: 'test'}))._id;
  otherBranch = (await Branch.create({name: 'Branch B', code: 'BB', address: 'test', city: 'test'}))._id;
  principal = await actor('principal', 'principal', branch);
  peer = await actor('peer', 'principal', branch);
  teacher = await actor('teacher', 'teacher', branch);
  student = await actor('student', 'student', branch);
  foreign = await actor('foreign', 'principal', otherBranch);
  admin = await actor('admin', 'super_admin');
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: {branchId: String(branch), types: ['leave']},
    [String(peer.id)]: {branchId: String(branch), types: ['leave']},
  });
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (originalJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwt;
  if (originalAuthority === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = originalAuthority;
});

const http = async (path: string, method: string, body: unknown, person: Actor | undefined = principal) => {
  const response = await fetch(`${base}${path}`, {
    method, headers: {'Content-Type': 'application/json', ...(person ? {Authorization: `Bearer ${person.token}`} : {})},
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  assert.equal(raw.includes('private-database-internals'), false);
  return {status: response.status, data: JSON.parse(raw), raw};
};
const create = (body: unknown = {title: 'Valid task', assignedTo: String(teacher.id)}) => http('/principal/tasks', 'POST', body);
const task = (extra: Record<string, unknown> = {}) => new PrincipalTask({branchId: branch, title: 'Test task', createdBy: principal.id, assignedTo: principal.id, ...extra}).save();
const alert = (extra: Record<string, unknown> = {}) => new SafetyAlert({branchId: branch, type: 'incident', title: 'Test alert', ...extra}).save();
const taskAction = (id: unknown, body: unknown = {action: 'complete'}, person = principal) => http(`/principal/tasks/${String(id)}`, 'PATCH', body, person);
const safetyAction = (id: unknown, body: unknown = {action: 'resolve'}, person = principal) => http(`/principal/safety-alerts/${String(id)}`, 'PATCH', body, person);

test('task assignees expose only active same-branch Principal and Teacher display fields', async () => {
  const inactive = await actor('inactive-assignee', 'teacher', branch);
  await User.updateOne({_id: inactive.id}, {$set: {isActive: false}});
  const result = await http('/principal/task-assignees', 'GET', undefined);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.data.map((user: {_id: string}) => user._id).sort(), [principal, peer, teacher].map(user => String(user.id)).sort());
  for (const user of result.data.data) assert.deepEqual(Object.keys(user).sort(), ['_id', 'fullName', 'role']);
  for (const user of [inactive, student, admin, foreign]) {
    assert.equal(result.raw.includes(String(user.id)), false);
  }
});

test('task assignees enforce authentication, Principal role, task permission and server branch', async () => {
  // This helper's default actor is Principal; use raw fetch for missing auth.
  const anonymous = await fetch(`${base}/principal/task-assignees`);
  assert.equal(anonymous.status, 401);
  for (const person of [student, teacher, admin]) {
    assert.equal((await http('/principal/task-assignees', 'GET', undefined, person)).status, 403);
  }
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = original.filter(permission => permission !== PERMISSIONS.PRINCIPAL_TASKS_MANAGE);
    assert.equal((await http('/principal/task-assignees', 'GET', undefined)).status, 403);
    assert.equal((await http('/principal/tasks', 'GET', undefined)).data.canAssign, false);
  } finally {ROLE_PERMISSIONS.principal = original;}
  const normal = await http('/principal/task-assignees', 'GET', undefined);
  const query = await http(`/principal/task-assignees?branchId=${otherBranch}&actorId=${foreign.id}`, 'GET', undefined);
  assert.deepEqual(query.data, normal.data);
  const spoof = await fetch(`${base}/principal/task-assignees?branchId=${otherBranch}`, {
    headers: {Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json'},
  });
  const spoofPayload = await spoof.json() as {data: unknown};
  assert.deepEqual(spoofPayload.data, normal.data.data);
  const bodySpoof = await new Promise<string>((resolve, reject) => {
    const body = JSON.stringify({branchId: String(otherBranch), actorId: String(foreign.id)});
    const transport = nodeRequest(`${base}/principal/task-assignees`, {
      method: 'GET', headers: {Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
    }, response => {
      let raw = ''; response.setEncoding('utf8');
      response.on('data', chunk => {raw += chunk;}); response.on('end', () => resolve(raw));
    });
    transport.on('error', reject); transport.end(body);
  });
  assert.deepEqual(JSON.parse(bodySpoof), normal.data);
});

test('task POST independently rejects forged or newly invalid assignees after candidate GET', async () => {
  const result = await http('/principal/task-assignees', 'GET', undefined);
  assert.ok(result.data.data.some((user: {_id: string}) => user._id === String(teacher.id)));
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  for (const [person, expected] of [[foreign, 404], [student, 403], [admin, 404], [teacher, 403]] as const) {
    assert.equal((await create({title: 'Valid task', assignedTo: String(person.id)})).status, expected);
  }
  assert.equal((await create({title: 'Valid task', assignedTo: String(new mongoose.Types.ObjectId())})).status, 404);
  assert.equal(await PrincipalTask.countDocuments(), 0);
  const eligible = await create({title: 'Valid task', assignedTo: String(peer.id)});
  assert.equal(eligible.status, 201);
  assert.equal(eligible.data.data.assignee.fullName, 'peer');
});

test('task list filters are validated, literal and branch-scoped while retaining newest-first ordering', async () => {
  const matching = await task({title: 'Review [results]', priority: 'high', status: 'in_progress'});
  await task({title: 'Review results', priority: 'normal'});
  await task({title: 'Review [results]', priority: 'high', status: 'in_progress', branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  const list = await http(`/principal/tasks?status=in_progress&priority=high&search=${encodeURIComponent('[results]')}&branchId=${otherBranch}`, 'GET', undefined);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.data.map((entry: {_id: string}) => entry._id), [String(matching._id)]);
  for (const query of ['status=unknown', 'priority=unknown', 'search[bad]=x', 'status=pending&status=completed', `search=${'a'.repeat(151)}`]) {
    assert.equal((await http(`/principal/tasks?${query}`, 'GET', undefined)).status, 400);
  }
  const legacyId = new mongoose.Types.ObjectId();
  await PrincipalTask.collection.insertOne({_id: legacyId, branchId: branch, title: 'Legacy task', createdBy: principal.id, assignedTo: teacher.id});
  const legacy = await http('/principal/tasks?status=pending&priority=normal', 'GET', undefined);
  assert.ok(legacy.data.data.some((item: {_id: string}) => item._id === String(legacyId)));
});

test('task detail display identities are scoped and permitted actions match current ownership, state and permission', async () => {
  const item = await task({assignedTo: teacher.id});
  const detail = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
  assert.equal(detail.data.data.assignee.fullName, 'teacher');
  assert.equal(detail.data.data.creator.fullName, 'principal');
  assert.deepEqual(detail.data.data.capabilities.allowedActions, ['start', 'complete', 'cancel']);
  assert.deepEqual((await http(`/principal/tasks/${item._id}`, 'GET', undefined, peer)).data.data.capabilities.allowedActions, []);
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = original.filter(permission => permission !== PERMISSIONS.PRINCIPAL_TASKS_MANAGE);
    assert.deepEqual((await http(`/principal/tasks/${item._id}`, 'GET', undefined)).data.data.capabilities.allowedActions, []);
  } finally {ROLE_PERMISSIONS.principal = original;}
  const started = await taskAction(item._id, {action: 'start'});
  assert.deepEqual(started.data.data.capabilities.allowedActions, ['complete', 'cancel']);
  assert.equal(started.data.data.history[0].performer.fullName, 'principal');
  const completed = await taskAction(item._id, {action: 'complete'});
  assert.deepEqual(completed.data.data.capabilities.allowedActions, []);
  assert.ok(completed.data.data.completedAt);
  const legacyForeign = await task({assignedTo: foreign.id, createdBy: foreign.id, history: [{action: 'start', performedBy: foreign.id, createdAt: new Date()}]});
  const scoped = await http(`/principal/tasks/${legacyForeign._id}`, 'GET', undefined);
  assert.equal(scoped.data.data.assignee, null);
  assert.equal(scoped.data.data.creator, null);
  assert.equal(scoped.data.data.history[0].performer, null);
  assert.equal(scoped.raw.includes('foreign@test.invalid'), false);
});

test('non-empty task history preserves public fields and IDs across detail, list and action responses', async () => {
  const timestamp = new Date('2026-01-02T03:04:05.000Z');
  const item = await task({status: 'in_progress', history: [{action: 'start', performedBy: principal.id, createdAt: timestamp}]});
  const original = item.toObject().history[0];
  const expectedOriginal = JSON.parse(JSON.stringify(original));
  const detail = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
  const list = await http('/principal/tasks', 'GET', undefined);
  const action = await taskAction(item._id, {action: 'complete'});
  for (const result of [detail, list, action]) assert.equal(result.status, 200);
  const listed = list.data.data.find((entry: {_id: string}) => entry._id === String(item._id));
  for (const entry of [detail.data.data.history[0], listed.history[0], action.data.data.history[0]]) {
    const {performer, ...existingFields} = entry;
    assert.deepEqual(existingFields, expectedOriginal);
    assert.deepEqual(performer, {_id: String(principal.id), fullName: 'principal', role: 'principal'});
    assert.deepEqual(Object.keys(entry).sort(), ['_id', 'action', 'createdAt', 'performedBy', 'performer']);
  }
  const stored = await PrincipalTask.findById(item._id);
  assert.ok(stored);
  const expectedHistory = JSON.parse(JSON.stringify(stored.toObject().history));
  assert.equal(action.data.data.history.length, 2);
  for (let index = 0; index < expectedHistory.length; index++) {
    const {performer, ...entry} = action.data.data.history[index];
    assert.deepEqual(entry, expectedHistory[index]);
    assert.match(entry._id, /^[a-f0-9]{24}$/);
    assert.deepEqual(Object.keys(performer).sort(), ['_id', 'fullName', 'role']);
  }
  assert.notEqual(action.data.data.history[0]._id, action.data.data.history[1]._id);
});

test('task history retains raw identities while missing, deleted and foreign performers are null and private fields stay absent', async () => {
  const deleted = await actor('deleted-performer', 'principal', branch);
  await User.deleteOne({_id: deleted.id});
  const missingId = new mongoose.Types.ObjectId();
  await User.updateOne({_id: peer.id}, {$set: {phone: 'private-phone-marker'}});
  const item = await task({history: [
    {action: 'start', performedBy: peer.id, createdAt: new Date()},
    {action: 'start', performedBy: missingId, createdAt: new Date()},
    {action: 'start', performedBy: deleted.id, createdAt: new Date()},
    {action: 'start', performedBy: foreign.id, createdAt: new Date()},
  ]});
  const history = JSON.parse(JSON.stringify(item.toObject().history));
  const detail = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
  const list = await http('/principal/tasks', 'GET', undefined);
  const action = await taskAction(item._id, {action: 'complete'});
  for (const result of [detail, list, action]) {
    assert.equal(result.status, 200);
    const responseTask = result === list ? result.data.data.find((entry: {_id: string}) => entry._id === String(item._id)) : result.data.data;
    for (let index = 0; index < history.length; index++) {
      const {performer, ...entry} = responseTask.history[index];
      assert.deepEqual(entry, history[index]);
      assert.deepEqual(Object.keys(responseTask.history[index]).sort(), ['_id', 'action', 'createdAt', 'performedBy', 'performer']);
      if (index === 0) assert.deepEqual(performer, {_id: String(peer.id), fullName: 'peer', role: 'principal'});
      else assert.equal(performer, null);
    }
    for (const marker of ['"email"', '"phone"', '"password"', '"permissions"', '"sessions"', '"bootstrapKey"', 'private-phone-marker', 'foreign@test.invalid', 'deleted-performer']) {
      assert.equal(result.raw.includes(marker), false);
    }
  }
});

test('task titles are required, typed, trimmed, and enforce schema lengths', async () => {
  for (const title of [undefined, '', '   ', 'x', 123, {}, 'x'.repeat(151)]) {
    assert.equal((await create({title, assignedTo: String(teacher.id)})).status, 400);
  }
  for (const description of [123, null, [], 'x'.repeat(2001)]) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), description})).status, 400);
  }
  assert.equal(await PrincipalTask.countDocuments(), 0);
});

test('task priority and assigned user ID cannot be coerced', async () => {
  for (const priority of ['', 'URGENT', 'unknown', false, 1, null]) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), priority})).status, 400);
  }
  for (const assignedTo of [undefined, '', 'invalid', 1, {}, [String(teacher.id)]]) {
    assert.equal((await create({title: 'valid', assignedTo})).status, 400);
  }
});

test('assignment conceals missing/foreign users and denies students/inactive users', async () => {
  for (const person of [foreign, {id: new mongoose.Types.ObjectId()}]) {
    assert.equal((await create({title: 'valid', assignedTo: String(person.id)})).status, 404);
  }
  assert.equal((await create({title: 'valid', assignedTo: String(student.id)})).status, 403);
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  assert.equal((await create({title: 'valid', assignedTo: String(teacher.id)})).status, 403);
});

const invalidDates = ['', 'invalid', '2099-02-30', '2099-02-29T12:00:00Z', '2099-13-01T00:00:00Z',
  '2099-01-01T24:00:00Z', '2099-01-01T00:00:60Z', '2099-01-01T00:00:00',
  '2099-01-01T00:00:00+99:00', 0, false, null, {}, []];

test('task due dates reject invalid/impossible/ambiguous dates and typed values', async () => {
  for (const dueDate of invalidDates) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), dueDate})).status, 400);
  }
  assert.equal(await PrincipalTask.countDocuments(), 0);
});

test('today date-only task due dates are accepted at UTC midnight', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await create({title: 'Due today', assignedTo: String(teacher.id), dueDate: today});
  assert.equal(result.status, 201);
  assert.equal(result.data.data.dueDate, `${today}T00:00:00.000Z`);
  const stored = await PrincipalTask.findById(result.data.data._id);
  assert.equal(stored?.dueDate?.toISOString(), `${today}T00:00:00.000Z`);
});

test('past date-only and timestamp task due dates retain UTC parsing and persist', async () => {
  for (const dueDate of ['2000-01-01', '2000-01-01T05:00:00+05:00']) {
    const result = await create({title: 'Past due', assignedTo: String(teacher.id), dueDate});
    assert.equal(result.status, 201);
    assert.equal(result.data.data.dueDate, '2000-01-01T00:00:00.000Z');
    const stored = await PrincipalTask.findById(result.data.data._id);
    assert.equal(stored?.dueDate?.toISOString(), '2000-01-01T00:00:00.000Z');
  }
});

test('task creation rejects all internal/server fields and non-object bodies', async () => {
  for (const field of ['branchId', 'createdBy', 'actorId', 'status', 'history', 'createdAt', 'updatedAt', 'completedAt', '_id', '__v', 'isActive']) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), [field]: 'forged'})).status, 400);
  }
  for (const body of [null, [], 'text', 123, true]) assert.equal((await create(body)).status, 400);
});

test('valid creation persists trimmed strings and model/server defaults and dates', async () => {
  mock.method(PrincipalTask.collection, 'insertOne', (...args: Parameters<typeof originalInsert>) => {
    // The model's save itself uses insertOne. Check the document received there
    // contains model defaults, proving this is no longer the raw service path.
    const document = args[0] as Record<string, unknown>;
    assert.equal(document.priority, 'normal');
    assert.equal(document.status, 'pending');
    assert.ok(Array.isArray(document.history));
    return originalInsert(...args);
  });
  const date = future();
  const result = await create({title: '  Valid task  ', description: '  Details  ', assignedTo: String(teacher.id), dueDate: date});
  assert.equal(result.status, 201);
  const stored = await PrincipalTask.findById(result.data.data._id);
  assert.ok(stored);
  assert.equal(stored.title, 'Valid task');
  assert.equal(stored.description, 'Details');
  assert.equal(String(stored.branchId), String(branch));
  assert.equal(String(stored.createdBy), String(principal.id));
  assert.equal(stored.dueDate?.toISOString(), date);
  assert.ok(stored.createdAt instanceof Date);
  assert.ok(stored.updatedAt instanceof Date);
  assert.equal(stored.__v, 0);
});

// Capture after module import; reset mocks before every fixture setup.
const originalInsert = PrincipalTask.collection.insertOne.bind(PrincipalTask.collection);

test('future date-only and explicit-offset dates normalize to UTC', async () => {
  const first = await create({title: 'valid', assignedTo: String(peer.id), dueDate: '2099-01-02'});
  assert.equal(first.status, 201);
  assert.equal(first.data.data.dueDate, '2099-01-02T00:00:00.000Z');
  const second = await create({title: 'valid', assignedTo: String(peer.id), dueDate: '2099-01-02T05:00:00+05:00'});
  assert.equal(second.data.data.dueDate, '2099-01-02T00:00:00.000Z');
});

test('direct service calls also validate types and eligibility before writes', async () => {
  const baseInput = {branchId: String(branch), actorId: String(principal.id), title: 'valid', assignedTo: String(teacher.id)};
  await assert.rejects(createPrincipalTask({...baseInput, priority: 'invalid'}), {status: 400});
  await assert.rejects(createPrincipalTask({...baseInput, dueDate: new Date(NaN)}), {status: 400});
  await assert.rejects(createPrincipalTask({...baseInput, actorId: String(student.id)}), {status: 403});
  const item = await task();
  await assert.rejects(processPrincipalTaskAction({taskId: String(item._id), branchId: String(branch), actorId: String(teacher.id), action: 'complete'}), {status: 403});
});

test('task actions reject unsupported fields, invalid IDs/actions, and non-object bodies', async () => {
  const item = await task();
  for (const body of [[], {}, {action: 1}, {action: 'unknown'}, {action: 'complete', status: 'pending'},
    {action: 'complete', branchId: String(otherBranch)}, {action: 'complete', createdBy: String(peer.id)},
    {action: 'complete', history: []}, {action: 'complete', dueDate: future()}]) {
    assert.equal((await taskAction(item._id, body)).status, 400);
  }
  assert.equal((await taskAction('invalid')).status, 400);
});

test('task transitions preserve previous semantics but stale/final actions conflict', async () => {
  const item = await task();
  assert.equal((await taskAction(item._id, {action: 'start'})).status, 200);
  assert.equal((await taskAction(item._id, {action: 'start'})).status, 409);
  assert.equal((await taskAction(item._id)).status, 200);
  for (const action of ['start', 'complete', 'cancel']) assert.equal((await taskAction(item._id, {action})).status, 409);
  const stored = await PrincipalTask.findById(item._id);
  assert.equal(stored?.history.length, 2);
  assert.equal(String(stored?.history[1].performedBy), String(principal.id));
  assert.ok(stored?.completedAt instanceof Date);
  const cancelled = await task();
  assert.equal((await taskAction(cancelled._id, {action: 'cancel'})).status, 200);
  assert.equal((await taskAction(cancelled._id, {action: 'cancel'})).status, 409);
});

test('task action conceals cross-branch objects and enforces creator/assignee ownership', async () => {
  const outside = await task({branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  assert.equal((await taskAction(outside._id)).status, 404);
  const item = await task();
  assert.equal((await taskAction(item._id, {action: 'complete'}, peer)).status, 403);
});

test('completion replaces a stale completion timestamp with server time', async () => {
  const item = await task({completedAt: new Date('2000-01-01T00:00:00Z')});
  const beforeCompletion = Date.now();
  const result = await taskAction(item._id, {action: 'complete'});
  const afterCompletion = Date.now();
  assert.equal(result.status, 200);
  assert.equal(result.data.data.status, 'completed');
  const stored = await PrincipalTask.findById(item._id);
  assert.ok(stored?.completedAt instanceof Date);
  assert.ok(stored.completedAt.getTime() >= beforeCompletion && stored.completedAt.getTime() <= afterCompletion);
  assert.equal(result.data.data.completedAt, stored.completedAt.toISOString());
});

test('cancellation explicitly clears stale completion timestamps from both active states', async () => {
  for (const status of ['pending', 'in_progress']) {
    const item = await task({status, completedAt: new Date('2000-01-01T00:00:00Z')});
    const result = await taskAction(item._id, {action: 'cancel'});
    assert.equal(result.status, 200);
    assert.equal(result.data.data.status, 'cancelled');
    assert.equal(result.data.data.completedAt, null);
    const stored = await PrincipalTask.collection.findOne({_id: item._id});
    assert.equal(stored?.completedAt, null);
    const detail = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.data.completedAt, null);
    assert.equal((await taskAction(item._id, {action: 'cancel'})).status, 409);
  }
});

test('task list preserves its envelope, newest-first ordering and assigned branch scope', async () => {
  const older = await task({title: 'Older task', createdAt: new Date('2000-01-01T00:00:00Z')});
  const newer = await task({title: 'Newer task', createdAt: new Date('2000-01-02T00:00:00Z')});
  await task({title: 'Foreign private task', branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  const result = await http('/principal/tasks', 'GET', undefined);
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.message, 'Principal tasks fetched successfully');
  assert.deepEqual(result.data.data.map((entry: {_id: string}) => entry._id), [String(newer._id), String(older._id)]);
  assert.ok(result.data.data.every((entry: {branchId: string}) => entry.branchId === String(branch)));
  assert.equal(result.raw.includes('Foreign private task'), false);
});

test('task detail returns the scoped task and conceals foreign tasks like missing tasks', async () => {
  const item = await task({title: 'Scoped task', description: 'Scoped details'});
  const outside = await task({title: 'Foreign private task', branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  const result = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.message, 'Principal task fetched successfully');
  assert.equal(result.data.data._id, String(item._id));
  assert.equal(result.data.data.branchId, String(branch));
  assert.equal(result.data.data.title, 'Scoped task');
  assert.equal(result.data.data.description, 'Scoped details');
  const foreignResult = await http(`/principal/tasks/${outside._id}`, 'GET', undefined);
  const missingResult = await http(`/principal/tasks/${new mongoose.Types.ObjectId()}`, 'GET', undefined);
  assert.equal(foreignResult.status, 404);
  assert.equal(missingResult.status, 404);
  assert.deepEqual(foreignResult.data, missingResult.data);
  assert.equal(foreignResult.raw.includes('Foreign private task'), false);
});

test('legacy task list and detail safely hydrate missing defaults without rewriting records', async () => {
  const legacy = {
    _id: new mongoose.Types.ObjectId(), branchId: branch, createdBy: principal.id, assignedTo: teacher.id,
    title: 'Legacy readable task', createdAt: new Date(), updatedAt: new Date(),
  };
  await PrincipalTask.collection.insertOne(legacy);
  const list = await http('/principal/tasks', 'GET', undefined);
  const detail = await http(`/principal/tasks/${legacy._id}`, 'GET', undefined);
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
  assert.equal(list.data.data.length, 1);
  assert.deepEqual(list.data.data[0], detail.data.data);
  assert.equal(detail.data.data._id, String(legacy._id));
  assert.equal(detail.data.data.branchId, String(branch));
  assert.equal(detail.data.data.priority, 'normal');
  assert.equal(detail.data.data.status, 'pending');
  assert.deepEqual(detail.data.data.history, []);
  for (const field of ['description', 'dueDate', 'completedAt', '__v']) {
    assert.equal(Object.hasOwn(detail.data.data, field), false);
  }
  assert.deepEqual(await PrincipalTask.collection.findOne({_id: legacy._id}), legacy);
});

test('task create and action database failures are sanitized', async () => {
  const item = await task();
  mock.method(PrincipalTask.prototype, 'save', async () => {throw new Error('private-database-internals');});
  assert.equal((await create()).status, 500);
  mock.restoreAll();
  mock.method(PrincipalTask, 'findOneAndUpdate', () => {throw new Error('private-database-internals');});
  assert.equal((await taskAction(item._id)).status, 500);
});

test('safety bodies reject invalid actions, unknown fields, and unsupported reason/evidence', async () => {
  const item = await alert();
  for (const body of [[], {}, {action: 'unknown'}, {action: false}, {action: 'resolve', assignedTo: String(peer.id)},
    {action: 'resolve', reason: 'x'.repeat(501)}, {action: 'resolve', evidence: {}},
    {action: 'escalate', reason: 1}, {action: 'escalate', evidence: 'x'.repeat(2000)},
    {action: 'resolve', branchId: String(otherBranch)}, {action: 'resolve', type: 'incident'},
    {action: 'resolve', performedBy: String(peer.id)}, {action: 'resolve', history: []}]) {
    assert.equal((await safetyAction(item._id, body)).status, 400);
  }
  assert.equal((await safetyAction('invalid')).status, 400);
});

test('safety assignment validates IDs, branch, active state, and eligible role', async () => {
  const item = await alert();
  for (const assignedTo of [undefined, 'invalid', 123, {}]) {
    assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo})).status, 400);
  }
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(foreign.id)})).status, 404);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(student.id)})).status, 403);
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 403);
});

test('safety actions persist validated state, timestamps and authenticated audit metadata', async () => {
  const item = await alert();
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 200);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 409);
  assert.equal((await safetyAction(item._id, {action: 'escalate'})).status, 200);
  assert.equal((await safetyAction(item._id, {action: 'escalate'})).status, 409);
  assert.equal((await safetyAction(item._id)).status, 200);
  assert.equal((await safetyAction(item._id)).status, 409);
  const stored = await SafetyAlert.findById(item._id);
  assert.equal(stored?.status, 'resolved');
  assert.equal(stored?.severity, 'critical');
  assert.equal(stored?.history.length, 3);
  assert.equal(String(stored?.history[0].assignedTo), String(teacher.id));
  assert.ok(stored?.history.every(entry => String(entry.performedBy) === String(principal.id) && entry.createdAt instanceof Date));
  assert.ok(stored?.resolvedAt instanceof Date);
});

test('cross-branch safety mutations are concealed and direct calls require Principal actor', async () => {
  const outside = await alert({branchId: otherBranch});
  assert.equal((await safetyAction(outside._id)).status, 404);
  const item = await alert();
  await assert.rejects(processSafetyAlertAction({alertId: String(item._id), actorId: String(teacher.id), branchId: String(branch), action: 'resolve'}), {status: 403});
});

test('safety database failures are sanitized', async () => {
  const item = await alert();
  mock.method(SafetyAlert, 'findOneAndUpdate', () => {throw new Error('private-database-internals');});
  assert.equal((await safetyAction(item._id)).status, 500);
});

test('all Principal writes require authentication and existing role/permission', async () => {
  const item = await task(), incident = await alert();
  for (const person of [teacher, student, admin]) {
    assert.equal((await http('/principal/tasks', 'POST', {title: 'valid', assignedTo: String(peer.id)}, person)).status, 403);
    assert.equal((await taskAction(item._id, {action: 'complete'}, person)).status, 403);
    assert.equal((await safetyAction(incident._id, {action: 'resolve'}, person)).status, 403);
  }
  for (const [path, method, body] of [
    ['/principal/tasks', 'POST', {title: 'valid', assignedTo: String(peer.id)}],
    [`/principal/tasks/${item._id}`, 'PATCH', {action: 'complete'}],
    [`/principal/safety-alerts/${incident._id}`, 'PATCH', {action: 'resolve'}],
  ] as const) {
    // An omitted argument would select the helper's default Principal.
    const response = await fetch(`${base}${path}`, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal(response.status, 401);
  }
  const permissions = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = permissions.filter(permission => permission !== PERMISSIONS.PRINCIPAL_TASKS_MANAGE);
    assert.equal((await create()).status, 403);
    assert.equal((await taskAction(item._id)).status, 403);
    assert.equal((await safetyAction(incident._id)).status, 200);
    ROLE_PERMISSIONS.principal = permissions.filter(permission => permission !== PERMISSIONS.PRINCIPAL_SAFETY_MANAGE);
    assert.equal((await safetyAction(incident._id)).status, 403);
  } finally {ROLE_PERMISSIONS.principal = permissions;}
});

test('concurrent task finalization and safety resolution each allow one atomic transition', async () => {
  const item = await task(), incident = await alert();
  const tasks = await Promise.all([taskAction(item._id), taskAction(item._id)]);
  const alerts = await Promise.all([safetyAction(incident._id), safetyAction(incident._id)]);
  assert.deepEqual(tasks.map(result => result.status).sort(), [200, 409]);
  assert.deepEqual(alerts.map(result => result.status).sort(), [200, 409]);
  assert.equal((await PrincipalTask.findById(item._id))?.history.length, 1);
  assert.equal((await SafetyAlert.findById(incident._id))?.history.length, 1);
});

test('approval dates reject normalization, local timestamps, wrong types and unknown fields', async () => {
  const item = await new ApprovalRequest({branchId: branch, requesterId: teacher.id, entityType: 'user', entityId: teacher.id, approvalType: 'leave', reason: 'test'}).save();
  for (const delegationExpiresAt of [...invalidDates, '2099-01-02', '2000-01-01T00:00:00Z']) {
    assert.equal((await http(`/approval-requests/${item._id}`, 'PATCH', {action: 'delegated', delegatedTo: String(peer.id), delegationExpiresAt})).status, 400);
  }
  assert.equal((await http(`/approval-requests/${item._id}`, 'PATCH', {action: 'approved', amount: 0})).status, 400);
  assert.equal((await http(`/approval-requests/${item._id}`, 'PATCH', {action: 'approved'})).status, 200);
});

test('malformed/primitive/oversized Principal JSON never echoes input or parser stacks', async () => {
  for (const path of ['/principal/tasks', '/principal/tasks/invalid', '/principal/safety-alerts/invalid', '/approval-requests/invalid']) {
    const response = await fetch(`${base}${path}`, {
      method: path === '/principal/tasks' ? 'POST' : 'PATCH',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${principal.token}`},
      body: '{"private-payload-marker":',
    });
    assert.equal(response.status, 400);
    const raw = await response.text();
    assert.equal(raw.includes('private-payload-marker'), false);
    assert.deepEqual(JSON.parse(raw), {success: false, message: 'Invalid Principal request body'});
  }
  const large = await create({title: 'x'.repeat(110000)});
  assert.equal(large.status, 400);
});

test('shared validation rejects non-plain objects and impossible calendar dates', () => {
  assert.throws(() => objectBody(new Date(), []), {status: 400});
  assert.throws(() => objectBody(Object.create({action: 'complete'}), ['action']), {status: 400});
  assert.throws(() => dateField('2100-02-29T00:00:00Z', 'date'), {status: 400});
  assert.equal(dateField('2096-02-29T00:00:00Z', 'date').toISOString(), '2096-02-29T00:00:00.000Z');
});

test('legacy raw tasks get missing priority defaults and a first guarded versioned update', async () => {
  const id = new mongoose.Types.ObjectId();
  await PrincipalTask.collection.insertOne({
    _id: id, branchId: branch, createdBy: principal.id, assignedTo: principal.id,
    title: 'Legacy task', status: 'pending', createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal((await taskAction(id)).status, 200);
  const stored = await PrincipalTask.findById(id);
  assert.equal(stored?.history.length, 1);
  assert.equal(stored?.__v, 1);
  assert.equal(stored?.priority, 'normal');
});

test('intervening task reassignment and safety state changes produce stale-write conflicts', async () => {
  const item = await task(), incident = await alert();
  const originalTask = PrincipalTask.findOneAndUpdate.bind(PrincipalTask);
  mock.method(PrincipalTask, 'findOneAndUpdate', (...args: Parameters<typeof originalTask>) => (async () => {
    await PrincipalTask.collection.updateOne({_id: item._id}, {$set: {assignedTo: peer.id}});
    return originalTask(...args);
  })());
  assert.equal((await taskAction(item._id)).status, 409);
  assert.equal((await PrincipalTask.findById(item._id))?.history.length, 0);
  const originalAlert = SafetyAlert.findOneAndUpdate.bind(SafetyAlert);
  mock.method(SafetyAlert, 'findOneAndUpdate', (...args: Parameters<typeof originalAlert>) => (async () => {
    await SafetyAlert.collection.updateOne({_id: incident._id}, {$set: {severity: 'high'}});
    return originalAlert(...args);
  })());
  assert.equal((await safetyAction(incident._id)).status, 409);
  assert.equal((await SafetyAlert.findById(incident._id))?.history.length, 0);
});

test('task creation retries still create duplicates without an idempotency identity', async () => {
  assert.equal((await create()).status, 201);
  assert.equal((await create()).status, 201);
  assert.equal(await PrincipalTask.countDocuments(), 2);
});

test('safety overview covers all stored categories with branch scope and strict filters', async () => {
  const types = ['missing_attendance', 'substitute_gap', 'bus_exception', 'gate_exception', 'incident', 'helpdesk', 'backup_failure'];
  for (const type of types) await alert({type, severity: 'high'});
  const resolved = await alert({status: 'resolved'});
  const outside = await alert({branchId: otherBranch, title: 'Foreign private safety'});
  const result = await http(`/principal/safety-alerts?branchId=${otherBranch}`, 'GET', undefined);
  assert.equal(result.status, 200);
  assert.equal(result.data.data.length, 7);
  assert.deepEqual(result.data.data.map((entry: {type: string}) => entry.type).sort(), [...types].sort());
  assert.equal(result.raw.includes(String(resolved._id)), false);
  assert.equal(result.raw.includes(String(outside._id)), false);
  assert.equal((await http('/principal/safety-alerts?status=resolved', 'GET', undefined)).data.data[0].id, String(resolved._id));
  assert.equal((await http('/principal/safety-alerts?type=helpdesk&severity=high&status=open', 'GET', undefined)).data.data.length, 1);
  for (const query of ['status=invalid', 'severity=urgent', 'type=student', 'status=open&status=resolved', 'actorId=other', 'search=.*']) {
    assert.equal((await http(`/principal/safety-alerts?${query}`, 'GET', undefined)).status, 400);
  }
});

test('safety officers expose only eligible same-branch public identities', async () => {
  const item = await alert();
  const inactive = await actor('inactive-officer', 'teacher', branch);
  await User.updateOne({_id: inactive.id}, {$set: {isActive: false}});
  const result = await http(`/principal/safety-alerts/${item._id}/eligible-officers`, 'GET', undefined);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.data.map((user: {_id: string}) => user._id).sort(), [principal, peer, teacher].map(user => String(user.id)).sort());
  for (const user of result.data.data) assert.deepEqual(Object.keys(user).sort(), ['_id', 'fullName', 'role']);
  for (const excluded of [inactive, student, admin, foreign]) assert.equal(result.raw.includes(String(excluded.id)), false);
  for (const field of ['email', 'password', 'phone', 'permissions', 'branchId', 'sessions']) assert.equal(result.raw.includes(`"${field}"`), false);
  const assigned = await safetyAction(item._id, {action: 'assign', assignedTo: result.data.data.find((user: {_id: string}) => user._id === String(teacher.id))._id});
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.data, null); // Existing mutation envelope remains compatible.
  assert.equal(assigned.data.alert.assignedTo.id, String(teacher.id));
  assert.equal(assigned.data.alert.status, 'in_progress');
  const next = await http(`/principal/safety-alerts/${item._id}/eligible-officers`, 'GET', undefined);
  assert.equal(next.raw.includes(String(teacher.id)), false); // Repeating assignment would be 409.
});

test('officer candidates cannot authorize a selection that becomes invalid before PATCH', async () => {
  const item = await alert();
  const path = `/principal/safety-alerts/${item._id}/eligible-officers`;
  assert.equal((await http(path, 'GET', undefined)).raw.includes(String(teacher.id)), true);
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 403);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(foreign.id)})).status, 404);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(student.id)})).status, 403);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(admin.id)})).status, 404);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(peer.id), branchId: String(otherBranch)})).status, 400);
});

test('safety detail and candidates conceal foreign IDs and reject spoofed context', async () => {
  const own = await alert(), outside = await alert({branchId: otherBranch});
  for (const suffix of ['', '/eligible-officers']) {
    assert.equal((await http(`/principal/safety-alerts/${outside._id}${suffix}`, 'GET', undefined)).status, 404);
    for (const query of ['branchId', 'actorId', 'role', 'severity']) {
      assert.equal((await http(`/principal/safety-alerts/${own._id}${suffix}?${query}=spoof`, 'GET', undefined)).status, 400);
    }
  }
  await safetyAction(own._id);
  assert.equal((await http(`/principal/safety-alerts/${own._id}/eligible-officers`, 'GET', undefined)).status, 409);
});

test('safety detail/history whitelist display fields and conceal foreign, missing and student identities', async () => {
  const missing = new mongoose.Types.ObjectId();
  const item = await alert({assignedTo: foreign.id, description: 'Operational detail', history: [
    {action: 'assign', performedBy: principal.id, assignedTo: teacher.id, createdAt: new Date()},
    ...[foreign.id, missing, student.id].map(id => ({action: 'escalate', performedBy: id, createdAt: new Date()})),
  ]});
  const detail = await http(`/principal/safety-alerts/${item._id}`, 'GET', undefined);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.data.assignedTo, null);
  assert.equal(detail.data.data.description, 'Operational detail');
  assert.equal(detail.data.data.history.length, 4);
  assert.deepEqual(detail.data.data.history.map((entry: {_id: string}) => entry._id), item.toObject().history.map((entry: {_id?: unknown}) => String(entry._id)));
  assert.deepEqual(Object.keys(detail.data.data.history[0].performer).sort(), ['fullName', 'id', 'role']);
  assert.deepEqual(Object.keys(detail.data.data.history[0].assignedOfficer).sort(), ['fullName', 'id', 'role']);
  assert.ok(detail.data.data.history.slice(1).every((entry: {performer: unknown}) => entry.performer === null));
  for (const field of ['email', 'password', 'phone', 'permissions', 'branchId', 'sessions', 'performedBy', '__v']) assert.equal(detail.raw.includes(`"${field}"`), false);
  for (const id of [foreign.id, student.id, missing]) assert.equal(detail.raw.includes(String(id)), false);
  const updated = await safetyAction(item._id, {action: 'escalate'});
  assert.equal(updated.data.alert.history.length, 5);
  assert.equal(updated.data.alert.history[0]._id, detail.data.data.history[0]._id);
  assert.ok(updated.data.alert.history[4]._id);
});

test('safety-view alone allows scoped list/detail and cannot look up officers or mutate alerts', async () => {
  const item = await alert({description: 'Sensitive support detail', history: [{action: 'escalate', performedBy: principal.id, createdAt: new Date()}]});
  const original = ROLE_PERMISSIONS.principal;
  ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_SAFETY_VIEW];
  try {
    const list = await http('/principal/safety-alerts', 'GET', undefined);
    assert.equal(list.status, 200);
    assert.equal(list.raw.includes('Sensitive support detail'), true);
    assert.deepEqual(list.data.data[0].capabilities, {allowedActions: [], canViewDetail: true});
    const detail = await http(`/principal/safety-alerts/${item._id}`, 'GET', undefined);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.data.description, 'Sensitive support detail');
    assert.equal(detail.data.data.history.length, 1);
    const outside = await alert({branchId: otherBranch});
    assert.equal((await http(`/principal/safety-alerts/${outside._id}`, 'GET', undefined)).status, 404);
    assert.equal((await http(`/principal/safety-alerts/${item._id}/eligible-officers`, 'GET', undefined)).status, 403);
    for (const body of [{action: 'assign', assignedTo: String(teacher.id)}, {action: 'resolve'}, {action: 'escalate'}]) {
      assert.equal((await safetyAction(item._id, body)).status, 403);
    }
    assert.equal((await SafetyAlert.findById(item._id))?.history.length, 1);
  } finally {ROLE_PERMISSIONS.principal = original;}
});

test('safety action response confirms exact transitions and terminal capabilities', async () => {
  const item = await alert();
  const escalated = await safetyAction(item._id, {action: 'escalate'});
  assert.equal(escalated.data.alert.severity, 'critical');
  assert.equal(escalated.data.alert.status, 'in_progress');
  assert.deepEqual(escalated.data.alert.capabilities.allowedActions, ['assign', 'resolve']);
  assert.equal((await safetyAction(item._id, {action: 'escalate'})).status, 409);
  const beforeResolve = Date.now();
  const resolved = await safetyAction(item._id);
  assert.equal(resolved.data.alert.status, 'resolved');
  assert.ok(new Date(resolved.data.alert.resolvedAt).getTime() >= beforeResolve);
  assert.deepEqual(resolved.data.alert.capabilities.allowedActions, []);
  for (const body of [{action: 'resolve'}, {action: 'escalate'}, {action: 'assign', assignedTo: String(peer.id)}]) assert.equal((await safetyAction(item._id, body)).status, 409);
});

test('dashboard and task permissions do not grant safety access while dashboard aggregates and task actions remain available', async () => {
  const item = await alert({description: 'Private support text'});
  const original = ROLE_PERMISSIONS.principal;
  ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW, PERMISSIONS.PRINCIPAL_TASKS_MANAGE];
  try {
    const dashboard = await http('/principal/dashboard', 'GET', undefined);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.data.safetyAlerts.total, 1);
    assert.equal(dashboard.raw.includes('Private support text'), false);
    for (const path of ['/principal/safety-alerts', `/principal/safety-alerts/${item._id}`, `/principal/safety-alerts/${item._id}/eligible-officers`]) {
      assert.equal((await http(path, 'GET', undefined)).status, 403);
    }
    for (const body of [{action: 'assign', assignedTo: String(teacher.id)}, {action: 'resolve'}, {action: 'escalate'}]) {
      assert.equal((await safetyAction(item._id, body)).status, 403);
    }
    const created = await create({title: 'Task permission still works', assignedTo: String(principal.id)});
    assert.equal(created.status, 201);
    assert.equal((await http(`/principal/tasks/${created.data.data._id}`, 'GET', undefined)).status, 200);
    assert.equal((await taskAction(created.data.data._id, {action: 'start'})).status, 200);
  } finally {ROLE_PERMISSIONS.principal = original;}
});

test('dedicated safety-manage permits officer lookup and all safety actions without task grants', async () => {
  const item = await alert(), outside = await alert({branchId: otherBranch});
  const original = ROLE_PERMISSIONS.principal;
  ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_SAFETY_MANAGE];
  try {
    assert.equal((await http('/principal/safety-alerts', 'GET', undefined)).status, 403);
    assert.equal((await http(`/principal/safety-alerts/${item._id}`, 'GET', undefined)).status, 403);
    assert.equal((await http(`/principal/safety-alerts/${item._id}/eligible-officers`, 'GET', undefined)).status, 200);
    assert.equal((await http(`/principal/safety-alerts/${outside._id}/eligible-officers`, 'GET', undefined)).status, 404);
    assert.equal((await safetyAction(outside._id)).status, 404);
    assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 200);
    assert.equal((await safetyAction(item._id, {action: 'escalate'})).status, 200);
    assert.equal((await safetyAction(item._id)).status, 200);
    assert.equal((await create()).status, 403);
  } finally {ROLE_PERMISSIONS.principal = original;}
});

test('Principal safety defaults do not broaden other role permission sets', () => {
  for (const permission of [PERMISSIONS.PRINCIPAL_SAFETY_VIEW, PERMISSIONS.PRINCIPAL_SAFETY_MANAGE]) {
    assert.ok(ROLE_PERMISSIONS.principal.includes(permission));
    for (const role of ['teacher', 'student', 'super_admin'] as const) assert.equal(ROLE_PERMISSIONS[role].includes(permission), false);
  }
  assert.deepEqual(ROLE_PERMISSIONS.super_admin, Object.values(PERMISSIONS).filter(permission =>
    !permission.startsWith('liveLesson.') &&
    !permission.startsWith('staff.') &&
    !permission.startsWith('teacher.academic.') && !permission.startsWith('teacher.lessons.') &&
    !permission.startsWith('teacher.assessments.') &&
    !permission.startsWith('teacher.notices.') && !permission.startsWith('teacher.work.') &&
    permission !== PERMISSIONS.PRINCIPAL_SAFETY_VIEW && permission !== PERMISSIONS.PRINCIPAL_SAFETY_MANAGE &&
    permission !== PERMISSIONS.TEACHER_CLASSES_VIEW && permission !== PERMISSIONS.TEACHER_TIMETABLE_VIEW &&
    permission !== PERMISSIONS.TEACHER_ATTENDANCE_VIEW && permission !== PERMISSIONS.TEACHER_ATTENDANCE_MANAGE &&
    permission !== PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE && permission !== PERMISSIONS.TEACHER_TIMETABLE_ISSUE));
  // These operate in the authenticated Teacher's academic/live context; global
  // administration must not inherit them just because a new constant exists.
  for (const permission of [PERMISSIONS.TEACHER_ASSESSMENTS_VIEW, PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE,
    PERMISSIONS.LIVE_LESSON_START, PERMISSIONS.LIVE_LESSON_END]) {
    assert.equal(ROLE_PERMISSIONS.teacher.includes(permission), true);
    for (const role of ['principal', 'super_admin', 'student'] as const) assert.equal(ROLE_PERMISSIONS[role].includes(permission), false);
  }
});

for (const action of ['assign', 'resolve', 'escalate'] as const) test(`Safety ${action} returns committed safe DTO matching persisted state`, async () => {
  const item = await alert({description: 'Operational detail'});
  const result = await safetyAction(item._id, {action, ...(action === 'assign' ? {assignedTo: String(teacher.id)} : {})});
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.data, null); // Preserve the legacy action envelope.
  const state = await SafetyAlert.findById(item._id).lean();
  assert.ok(state);
  const dto = result.data.alert;
  assert.equal(dto.id, String(state._id));
  assert.equal(dto.status, state.status);
  assert.equal(dto.severity, state.severity);
  assert.equal(dto.updatedAt, state.updatedAt.toISOString());
  assert.equal(dto.resolvedAt, state.resolvedAt?.toISOString());
  assert.equal(dto.history.length, 1);
  assert.equal(state.history.length, 1);
  assert.equal(dto.history[0].action, action);
  assert.equal(dto.history[0].createdAt, state.history[0].createdAt.toISOString());
  assert.equal(dto.history[0].performer.id, String(principal.id));
  if (action === 'assign') {
    assert.equal(dto.assignedTo.id, String(state.assignedTo));
    assert.equal(dto.history[0].assignedOfficer.id, String(teacher.id));
  }
  const detail = await http(`/principal/safety-alerts/${item._id}`, 'GET', undefined);
  assert.equal(detail.status, 200);
  assert.deepEqual(dto, detail.data.data);
  for (const field of ['token', 'password', 'email', 'branchId', 'performedBy', '__v', '$__', '_doc']) {
    assert.equal(result.raw.includes(`"${field}"`), false);
  }
  const retry = await safetyAction(item._id, {action, ...(action === 'assign' ? {assignedTo: String(teacher.id)} : {})});
  assert.equal(retry.status, 409);
  assert.deepEqual(await SafetyAlert.findById(item._id).lean(), state);
});

test('Safety DTO lookup failure rolls back provisional mutation and history', async () => {
  const item = await alert();
  const beforeState = await SafetyAlert.findById(item._id).lean();
  // Actor/assignee resolution uses findById; this failure is specifically the
  // DTO identity projection that used to run after the mutation committed.
  mock.method(User, 'find', () => {throw new Error('private-database-internals');});
  const result = await safetyAction(item._id);
  assert.equal(result.status, 500);
  assert.equal(result.data.message, 'Principal write operation failed');
  assert.deepEqual(await SafetyAlert.findById(item._id).lean(), beforeState);
});
