import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, {UserRole} from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Student from '../src/staff/src/models/student';
import Fee from '../src/staff/src/models/fee';
import Session from '../src/staff/src/models/session';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import PrivilegedRequest from '../src/staff/src/models/privilegedRequest';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {PERMISSIONS} from '../src/staff/src/constants/permissions';

/* eslint-disable no-script-url -- Deliberate malicious URL fixtures verify response filtering. */

// No dotenv or configured database URI: only this suite's ephemeral DB is used.
const originalPolicy = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
const originalJwt = process.env.JWT_SECRET;
let db: MongoMemoryReplSet;
let server: Server;
let base: string;
let branchA: mongoose.Types.ObjectId;
let branchB: mongoose.Types.ObjectId;
type Actor = {id: mongoose.Types.ObjectId; token: string};
let principal: Actor;
let peer: Actor;
let foreign: Actor;
let teacher: Actor;
let admin: Actor;
let studentA: mongoose.Types.ObjectId;
let studentB: mongoose.Types.ObjectId;
let fee: mongoose.Types.ObjectId;

before(async () => {
  db = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(db.getUri(), {dbName: 'approval_authority_tests', autoIndex: false});
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

const actor = async (name: string, role: UserRole, branchId?: mongoose.Types.ObjectId): Promise<Actor> => {
  const user = await new User({fullName: name, email: `${name}@test.invalid`, password: 'fixture-hash', role, branchId}).save();
  const token = generateAccessToken(user._id.toString(), role);
  await registerSession(user._id.toString(), token, role);
  return {id: user._id, token};
};
const configure = () => {
  // 100 is solely a test fixture, never a production/business default.
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(Object.fromEntries(
    [[principal, branchA], [peer, branchA], [foreign, branchB]].map(([person, branch]) => {
      const reviewer = person as Actor;
      return [reviewer.id.toString(), {branchId: String(branch), types: ['leave', 'refund', 'discount', 'payroll', 'certificate'], limits: {refund: 100, discount: 100, payroll: 100}}];
    }),
  ));
};

beforeEach(async () => {
  mock.restoreAll();
  process.env.JWT_SECRET = 'isolated-test-jwt-secret';
  for (const model of [ApprovalRequest, PrivilegedRequest, Session, Fee, Student, User, Branch]) await model.collection.deleteMany({});
  branchA = (await Branch.create({name: 'Branch A', code: 'AA', address: 'A', city: 'A'}))._id;
  branchB = (await Branch.create({name: 'Branch B', code: 'BB', address: 'B', city: 'B'}))._id;
  principal = await actor('principal', 'principal', branchA);
  peer = await actor('peer', 'principal', branchA);
  foreign = await actor('foreign-sensitive-name', 'principal', branchB);
  teacher = await actor('teacher', 'teacher', branchA);
  admin = await actor('admin', 'super_admin');
  const studentUserA = await actor('studentA', 'student', branchA);
  const studentUserB = await actor('studentB', 'student', branchB);
  studentA = (await new Student({userId: studentUserA.id, branchId: branchA, classId: new mongoose.Types.ObjectId(), sectionId: new mongoose.Types.ObjectId(), admissionNumber: 'A'}).save())._id;
  studentB = (await new Student({userId: studentUserB.id, branchId: branchB, classId: new mongoose.Types.ObjectId(), sectionId: new mongoose.Types.ObjectId(), admissionNumber: 'B'}).save())._id;
  fee = (await new Fee({branchId: branchA, studentId: studentA, academicYear: 'test', invoiceNumber: 'A', amount: 200, dueDate: new Date()}).save())._id;
  configure();
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (originalPolicy === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = originalPolicy;
  if (originalJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwt;
});

const request = (extra: Record<string, unknown> = {}) => new ApprovalRequest({
  branchId: branchA, requesterId: teacher.id, entityType: 'student', entityId: studentA,
  approvalType: 'leave', reason: 'Scoped test request', ...extra,
}).save();
const http = async (path: string, person?: Actor, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {'Content-Type': 'application/json', ...(person ? {Authorization: `Bearer ${person.token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const raw = await response.text();
  return {status: response.status, raw, data: raw.startsWith('{') ? JSON.parse(raw) : undefined};
};
const detail = (id: unknown, person = principal) => http(`/approval-requests/${String(id)}`, person);
const decide = (id: unknown, person = principal, body: unknown = {action: 'approved'}) => http(`/approval-requests/${String(id)}`, person, body);
const delegate = (id: unknown, person = peer) => decide(id, principal, {
  action: 'delegated', delegatedTo: person.id.toString(), delegationExpiresAt: new Date(Date.now() + 60000).toISOString(),
});

const candidates = (id: unknown, person?: Actor) => http(`/approval-requests/${String(id)}/eligible-delegates`, person);

test('eligible candidates require authentication, role and manage permission', async () => {
  const item = await request();
  assert.equal((await candidates(item._id)).status, 401);
  const student = await actor('wrongRoleStudent', 'student', branchA);
  for (const person of [teacher, admin, student]) assert.equal((await candidates(item._id, person)).status, 403);
  const permissions = ROLE_PERMISSIONS.principal;
  const index = permissions.indexOf(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  permissions.splice(index, 1);
  try {
    assert.equal((await candidates(item._id, principal)).status, 403);
    assert.deepEqual((await detail(item._id)).data.data.capabilities, {canReview: false, canDelegate: false});
  } finally {
    permissions.splice(index, 0, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  }
});

test('eligible candidates contain only same-branch active authorized Principals with minimal fields', async () => {
  const inactive = await actor('inactive', 'principal', branchA);
  const unconfigured = await actor('unconfigured', 'principal', branchA);
  const wrongCategory = await actor('wrongCategory', 'principal', branchA);
  await User.updateOne({_id: inactive.id}, {$set: {isActive: false}});
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[String(inactive.id)] = policy[String(peer.id)];
  policy[String(wrongCategory.id)] = {branchId: String(branchA), types: ['certificate']};
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  const item = await request();
  const result = await candidates(item._id, principal);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.data, [{_id: String(peer.id), fullName: 'peer'}]);
  assert.deepEqual(Object.keys(result.data.data[0]).sort(), ['_id', 'fullName']);
  for (const excluded of [inactive, unconfigured, wrongCategory, foreign, teacher, admin, principal]) {
    assert.ok(!result.raw.includes(String(excluded.id)));
    assert.equal((await delegate(item._id, excluded)).status, 403);
  }
});

test('eligible candidates exclude a Principal requester and direct forcing still fails', async () => {
  const item = await request({requesterId: peer.id});
  assert.deepEqual((await candidates(item._id, principal)).data.data, []);
  assert.equal((await delegate(item._id)).status, 403);
  assert.equal((await candidates(item._id, peer)).status, 403);
});

test('eligible candidates enforce financial ceilings and category grants', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 100});
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[String(peer.id)].limits.refund = 99;
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  assert.deepEqual((await candidates(item._id, principal)).data.data, []);
  assert.equal((await delegate(item._id)).status, 403);
  policy[String(peer.id)].limits.refund = 100;
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  assert.deepEqual((await candidates(item._id, principal)).data.data.map((user: {_id: string}) => user._id), [String(peer.id)]);
});

test('eligible candidates conceal foreign requests and reject missing authority and unsupported entities', async () => {
  const foreignItem = await request({branchId: branchB, requesterId: foreign.id, entityId: studentB});
  assert.equal((await candidates(foreignItem._id, principal)).status, 404);
  const unsupported = await request({entityType: 'arbitrary'});
  assert.equal((await candidates(unsupported._id, principal)).status, 403);
  const unsupportedCategory = await request({approvalType: 'paper'});
  assert.equal((await candidates(unsupportedCategory._id, principal)).status, 403);
  const item = await request();
  delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  assert.equal((await candidates(item._id, principal)).status, 403);
});

test('eligible candidate successfully delegates and capabilities prohibit repeated delegation', async () => {
  const item = await request();
  assert.deepEqual((await detail(item._id)).data.data.capabilities, {canReview: true, canDelegate: true});
  const list = await candidates(item._id, principal);
  const result = await decide(item._id, principal, {action: 'delegated', delegatedTo: list.data.data[0]._id, delegationExpiresAt: new Date(Date.now() + 60000).toISOString()});
  assert.equal(result.status, 200);
  assert.equal(result.data.data.request.delegatedTo._id, String(peer.id));
  assert.equal(result.data.data.request.history[0].action, 'delegated');
  assert.equal((await candidates(item._id, principal)).status, 409);
  assert.equal((await candidates(item._id, peer)).status, 403);
  assert.deepEqual((await detail(item._id, peer)).data.data.capabilities, {canReview: true, canDelegate: false});
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegationExpiresAt: new Date(Date.now() - 1000)}});
  assert.deepEqual((await detail(item._id, peer)).data.data.capabilities, {canReview: false, canDelegate: false});
});

test('eligible candidates reject finalized requests and revalidate a candidate that becomes inactive', async () => {
  const item = await request();
  assert.equal((await candidates(item._id, principal)).status, 200);
  await User.updateOne({_id: peer.id}, {$set: {isActive: false}});
  assert.equal((await delegate(item._id)).status, 403);
  assert.deepEqual((await candidates(item._id, principal)).data.data, []);
  await decide(item._id);
  assert.equal((await candidates(item._id, principal)).status, 409);
  assert.deepEqual((await detail(item._id)).data.data.capabilities, {canReview: false, canDelegate: false});
});

test('list, detail and mutation require authentication and Principal role', async () => {
  const item = await request();
  for (const person of [undefined, teacher, admin]) {
    const expected = person ? 403 : 401;
    assert.equal((await http('/approval-requests/pending', person)).status, expected);
    assert.equal((await http(`/approval-requests/${item._id}`, person)).status, expected);
    assert.equal((await http(`/approval-requests/${item._id}`, person, {action: 'approved'})).status, expected);
  }
});

test('own-branch permitted list/detail and direct decision work', async () => {
  const item = await request();
  const list = await http(`/approval-requests/pending?branchId=${branchB}`, principal);
  assert.equal(list.status, 200);
  assert.equal(list.data.data.total, 1);
  assert.equal((await detail(item._id)).status, 200);
  const result = await decide(item._id);
  assert.equal(result.status, 200);
  assert.equal(result.data.data.request.history[0].authority, 'direct');
});

test('cross-branch detail/mutation are concealed with 404 and query cannot widen scope', async () => {
  const item = await request({branchId: branchB, requesterId: foreign.id, entityId: studentB});
  assert.equal((await detail(item._id)).status, 404);
  assert.equal((await decide(item._id)).status, 404);
  assert.equal((await http(`/approval-requests/pending?branchId=${branchB}`, principal)).data.data.total, 0);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'pending');
});

test('absent/malformed grants, wrong grant branch and unsupported categories fail closed', async () => {
  const item = await request();
  for (const policy of [undefined, '{bad', '{}', JSON.stringify({[principal.id.toString()]: {branchId: branchB.toString(), types: ['leave']}})]) {
    if (policy === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
    else process.env.PRINCIPAL_APPROVAL_AUTHORITY = policy;
    assert.equal((await decide(item._id)).status, 403);
    assert.equal((await detail(item._id)).status, 403);
    assert.equal((await http('/approval-requests/pending', principal)).data.data.total, 0);
  }
  configure();
  const paper = await request({approvalType: 'paper'});
  assert.equal((await decide(paper._id)).status, 403);
});

test('financial ceiling is enforced and within-limit financial approval succeeds', async () => {
  const over = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 101});
  assert.equal((await decide(over._id)).status, 403);
  const allowed = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 100});
  assert.equal((await decide(allowed._id)).status, 200);
  assert.equal((await ApprovalRequest.findById(over._id))?.status, 'pending');
});

test('missing, invalid or unconfigured financial limits fail closed', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 1});
  for (const limits of [undefined, {}, {refund: -1}, {refund: '100'}, {refund: null}]) {
    process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[principal.id.toString()]: {branchId: branchA.toString(), types: ['refund'], limits}});
    assert.equal((await decide(item._id)).status, 403);
  }
});

test('invalid stored amounts and monetary amounts disguised as leave are rejected', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee});
  assert.equal((await decide(item._id)).status, 400);
  for (const amount of [-1, Infinity, NaN]) {
    await ApprovalRequest.collection.updateOne({_id: item._id}, {$set: {amount}});
    assert.equal((await decide(item._id)).status, 400);
  }
  const disguised = await request({amount: 1});
  assert.equal((await decide(disguised._id)).status, 400);
  await assert.rejects(request({amount: Infinity}));
});

test('unknown body fields and invalid action/reason/IDs cannot bypass stored authority', async () => {
  const item = await request();
  for (const body of [[], {}, {action: 'unknown'}, {action: 'rejected'}, {action: 'approved', reason: 123},
    {action: 'approved', amount: 0}, {action: 'approved', branchId: String(branchB)},
    {action: 'approved', afterData: {amount: 0}}, {action: 'approved', permissions: ['*']},
    {action: 'approved', delegatedTo: String(peer.id)}]) {
    assert.equal((await decide(item._id, principal, body)).status, 400);
  }
  assert.equal((await detail('invalid-id')).status, 400);
  assert.equal((await decide('invalid-id')).status, 400);
  assert.equal((await ApprovalRequest.findById(item._id))?.history.length, 0);
});

test('requester cannot approve or delegate their own request', async () => {
  const item = await request({requesterId: principal.id});
  assert.equal((await decide(item._id)).status, 403);
  assert.equal((await delegate(item._id)).status, 403);
});

test('delegation rejects cross-branch, ineligible, self, requester and unconfigured delegates', async () => {
  const item = await request();
  for (const person of [foreign, teacher, principal]) assert.equal((await delegate(item._id, person)).status, 403);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[principal.id.toString()]: {branchId: String(branchA), types: ['leave']}});
  assert.equal((await delegate(item._id)).status, 403);
  configure();
  const requester = await request({requesterId: peer.id});
  assert.equal((await delegate(requester._id)).status, 403);
  // ObjectId hex casing must not defeat self/requester comparisons.
  for (const id of [principal.id, peer.id]) {
    assert.equal((await decide(requester._id, principal, {action: 'delegated', delegatedTo: id.toString().toUpperCase(), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()})).status, 403);
  }
});

test('valid delegated decision records distinct authority and delegator', async () => {
  const item = await request();
  assert.equal((await delegate(item._id)).status, 200);
  const result = await decide(item._id, peer);
  assert.equal(result.status, 200);
  const history = result.data.data.request.history;
  assert.equal(history[0].authority, 'direct');
  assert.equal(history[1].authority, 'delegated');
  assert.equal(history[1].delegatedBy._id, principal.id.toString());
});

test('expired and legacy delegation cannot process, and delegates cannot redelegate', async () => {
  const item = await request();
  assert.equal((await delegate(item._id)).status, 200);
  assert.equal((await decide(item._id, peer, {action: 'delegated', delegatedTo: String(principal.id), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()})).status, 403);
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegationExpiresAt: new Date(Date.now() - 1000)}});
  assert.equal((await decide(item._id, peer)).status, 403);
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegationExpiresAt: new Date(Date.now() + 60000)}, $unset: {delegatedBy: ''}});
  assert.equal((await decide(item._id, peer)).status, 403);
});

test('delegate must retain authority and delegator must remain eligible with authority', async () => {
  const item = await request();
  await delegate(item._id);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[peer.id.toString()]: {branchId: String(branchA), types: ['leave']}});
  assert.equal((await decide(item._id, peer)).status, 403);
  configure();
  await User.updateOne({_id: principal.id}, {$set: {isActive: false}});
  assert.equal((await decide(item._id, peer)).status, 403);
});

test('forged delegation cannot grant cross-branch or wrong-role processing', async () => {
  const item = await request({delegatedTo: foreign.id, delegatedBy: principal.id, delegationExpiresAt: new Date(Date.now() + 60000)});
  assert.equal((await decide(item._id, foreign)).status, 404);
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegatedTo: teacher.id}});
  assert.equal((await decide(item._id, teacher)).status, 403);
});

test('invalid delegation expiry is rejected without history or state changes', async () => {
  const item = await request();
  for (const expiry of ['invalid', new Date(Date.now() - 1000).toISOString()]) {
    assert.equal((await decide(item._id, principal, {action: 'delegated', delegatedTo: String(peer.id), delegationExpiresAt: expiry})).status, 400);
  }
  assert.equal((await ApprovalRequest.findById(item._id))?.history.length, 0);
});

test('foreign requester/entity and nested fee student references cannot be read or processed', async () => {
  for (const extra of [{requesterId: foreign.id}, {entityId: studentB}]) {
    const item = await request(extra);
    assert.equal((await detail(item._id)).status, 404);
    assert.equal((await decide(item._id)).status, 404);
  }
  await Fee.updateOne({_id: fee}, {$set: {studentId: studentB}});
  const item = await request({approvalType: 'refund', amount: 1, entityType: 'fee', entityId: fee});
  assert.equal((await detail(item._id)).status, 404);
  assert.equal((await decide(item._id)).status, 404);
  assert.equal((await http('/approval-requests/pending', principal)).data.data.total, 0);
});

test('unknown model names and missing entities are denied instead of dynamically resolved', async () => {
  for (const extra of [{entityType: 'User'}, {entityType: 'session'}, {entityId: undefined}]) {
    const item = await request(extra);
    assert.equal((await detail(item._id)).status, 403);
    assert.equal((await decide(item._id)).status, 403);
  }
});

test('foreign historical reviewers and delegates are redacted rather than populated', async () => {
  const item = await request({reviewedBy: foreign.id, delegatedTo: foreign.id, delegatedBy: foreign.id,
    history: [{action: 'delegated', performedBy: foreign.id, delegatedBy: foreign.id}]});
  const result = await detail(item._id);
  assert.equal(result.status, 200);
  assert.equal(result.raw.includes('foreign-sensitive-name'), false);
  assert.equal(result.raw.includes(foreign.id.toString()), false);
  assert.equal(result.data.data.reviewedBy, 'Unavailable reviewer');
  assert.equal(result.data.data.history[0].performedBy, 'Unavailable reviewer');
});

test('raw attachments and untyped data are withheld from every approval response', async () => {
  const item = await request({supportingFileUrl: 'file:///private/other-branch', beforeData: {secret: 'cross-branch'}, afterData: {url: 'javascript:alert(1)'}});
  for (const result of [await http('/approval-requests/pending', principal), await detail(item._id), await decide(item._id)]) {
    assert.equal(result.status, 200);
    for (const text of ['supportingFileUrl', 'beforeData', 'afterData', 'file://', 'javascript:', 'cross-branch']) assert.equal(result.raw.includes(text), false);
  }
});

test('simultaneous final decisions allow exactly one final transition and history entry', {timeout: 10000}, async () => {
  const item = await request();
  // Both callers must reach the atomic write after authorizing the same pending
  // snapshot. This tests the database guard, not accidental HTTP serialization.
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  let arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>(resolve => {release = resolve;});
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => {
    return (async () => {
      if (++arrived === 2) release();
      await barrier;
      return original(...args);
    })();
  });
  const results = await Promise.all([decide(item._id), decide(item._id, peer, {action: 'rejected', reason: 'test'})]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const stored = await ApprovalRequest.findById(item._id);
  assert.equal(stored?.history.length, 1);
  assert.ok(['approved', 'rejected'].includes(stored!.status));
  assert.equal((await decide(item._id)).status, 409);
});

test('intervening stored amount changes cannot use an earlier authority check', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 1});
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => {
    return (async () => {
      await ApprovalRequest.collection.updateOne({_id: item._id}, {$set: {amount: 101}});
      return original(...args);
    })();
  });
  assert.equal((await decide(item._id)).status, 409);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'pending');
});

test('delegation expiring while the write is queued cannot finalize at MongoDB', async () => {
  const item = await request({delegatedTo: peer.id, delegatedBy: principal.id, delegationExpiresAt: new Date(Date.now() + 2000)});
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => {
    return (async () => {
      // Deliberately let the stored expiry pass after the service's precheck.
      await new Promise(resolve => setTimeout(resolve, 2100));
      return original(...args);
    })();
  });
  assert.equal((await decide(item._id, peer)).status, 409);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'pending');
});

test('database failures have sanitized 500 responses', async () => {
  const item = await request();
  mock.method(ApprovalRequest, 'findOne', () => {throw new Error('private-database-details');});
  const result = await detail(item._id);
  assert.equal(result.status, 500);
  assert.equal(result.raw.includes('private-database-details'), false);
});

test('Principal dangerous permissions are removed, supporting reads and Super Admin permissions remain', () => {
  for (const permission of [PERMISSIONS.STUDENTS_DELETE, PERMISSIONS.TEACHERS_DELETE, PERMISSIONS.RESULTS_MANAGE, PERMISSIONS.FINANCE_MANAGE]) {
    assert.equal(ROLE_PERMISSIONS.principal.includes(permission), false);
    assert.equal(ROLE_PERMISSIONS.super_admin.includes(permission), true);
  }
  for (const permission of [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE, PERMISSIONS.PRINCIPAL_TASKS_MANAGE, PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.FINANCE_VIEW, PERMISSIONS.RESULTS_VIEW]) {
    assert.equal(ROLE_PERMISSIONS.principal.includes(permission), true);
  }
  // Role-specific safety/class reads must not broaden Super Admin; trusted
  // Teacher assignment management is an intentional administrative grant.
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
});

test('approval routes enforce permission middleware in addition to role and grant', async () => {
  const item = await request();
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = original.filter(permission => ![
      PERMISSIONS.PRINCIPAL_APPROVALS_VIEW, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
    ].includes(permission as typeof PERMISSIONS.PRINCIPAL_APPROVALS_VIEW));
    assert.equal((await detail(item._id)).status, 403);
    assert.equal((await decide(item._id)).status, 403);
    assert.equal((await http('/approval-requests/pending', principal)).status, 403);
  } finally {
    ROLE_PERMISSIONS.principal = original;
  }
});

test('existing Super Admin privileged review works and Principals cannot use it', async () => {
  const item = await new PrivilegedRequest({requesterId: teacher.id, branchId: branchA, requestType: 'test', reason: 'test'}).save();
  assert.equal((await http('/privileged-requests/pending', admin)).status, 200);
  assert.equal((await http('/privileged-requests/pending', principal)).status, 403);
  assert.equal((await http(`/privileged-requests/${item._id}/review`, principal, {status: 'approved'})).status, 403);
  assert.equal((await http(`/privileged-requests/${item._id}/review`, admin, {status: 'approved'})).status, 200);
  assert.equal((await PrivilegedRequest.findById(item._id))?.status, 'approved');
});

const correction = (id: unknown, person = teacher) => http(`/approval-requests/${String(id)}/resubmission`, person);
const resubmit = async (id: unknown, person: Actor | undefined = teacher, reason: unknown = 'Corrected reason', revision = 1, extra: Record<string, unknown> = {}) => {
  const response = await fetch(`${base}/approval-requests/${String(id)}/resubmit`, {
    method: 'PATCH', headers: {'Content-Type': 'application/json', 'If-Match': `"${revision}"`, ...(person ? {Authorization: `Bearer ${person.token}`} : {})},
    body: JSON.stringify({reason, ...extra}),
  });
  return {status: response.status, data: JSON.parse(await response.text()), etag: response.headers.get('etag')};
};
const requestChanges = (id: unknown, person = principal) => decide(id, person, {action: 'changes_requested', reason: 'Explain the dates'});

test('request changes requires reason, records decision identity and invalidates delegation without losing history IDs', async () => {
  const item = await request();
  for (const reason of [undefined, '', '   ']) assert.equal((await decide(item._id, principal, {action: 'changes_requested', reason})).status, 400);
  assert.equal((await delegate(item._id)).status, 200);
  const delegated = await ApprovalRequest.findById(item._id);
  const result = await requestChanges(item._id, peer);
  assert.equal(result.status, 200);
  const value = result.data.data.request;
  assert.equal(value.status, 'changes_requested');
  assert.equal(value.history[0]._id, String(delegated!.history[0]._id));
  assert.equal(value.history[1].performedBy._id, String(peer.id));
  assert.equal(value.history[1].reason, 'Explain the dates');
  assert.equal(value.history[1].authority, 'delegated');
  assert.equal(value.history[1].delegatedBy._id, String(principal.id));
  assert.ok(value.history[1]._id && value.history[1].createdAt);
  for (const field of ['delegatedTo', 'delegatedBy', 'delegationExpiresAt']) assert.equal(value[field], undefined);
  const detailResult = await detail(item._id);
  assert.deepEqual(detailResult.data.data.capabilities, {canReview: false, canDelegate: false});
  assert.equal((await requestChanges(item._id)).status, 409);
  assert.equal((await ApprovalRequest.findById(item._id))?.__v, 2);
});

test('original requester resubmits the same request with immutable business fields and preserved history', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 50});
  const beforeFee = await Fee.findById(fee).lean();
  assert.equal((await requestChanges(item._id)).status, 200);
  const snapshotBefore = await ApprovalRequest.findById(item._id);
  const info = await correction(item._id);
  assert.equal(info.status, 200);
  assert.deepEqual(Object.keys(info.data.data).sort(), ['_id', 'canResubmit', 'changeReason', 'reason', 'revision', 'status']);
  assert.equal(info.data.data.revision, 1);
  assert.equal(info.data.data.changeReason, 'Explain the dates');
  assert.equal(info.raw.includes('email'), false);
  const result = await resubmit(item._id, teacher, '  Clarified request  ', info.data.data.revision);
  assert.equal(result.status, 200);
  assert.equal(result.etag, '"2"');
  assert.equal(result.data.data._id, String(item._id));
  assert.equal(result.data.data.status, 'pending');
  assert.equal(result.data.data.reason, 'Clarified request');
  const snapshotAfter = await ApprovalRequest.findById(item._id);
  assert.equal(snapshotAfter!.amount, 50);
  assert.equal(snapshotAfter!.approvalType, 'refund');
  assert.equal(String(snapshotAfter!.entityId), String(fee));
  assert.equal(snapshotAfter!.history[0]._id?.toString(), snapshotBefore!.history[0]._id?.toString());
  assert.equal(snapshotAfter!.history[1].action, 'resubmitted');
  assert.equal(String(snapshotAfter!.history[1].performedBy), String(teacher.id));
  assert.equal(snapshotAfter!.history[1].reason, 'Clarified request');
  assert.ok(snapshotAfter!.history[1]._id && snapshotAfter!.history[1].createdAt);
  for (const field of ['reviewedBy', 'reviewedAt', 'delegatedTo', 'delegatedBy', 'delegationExpiresAt'] as const) assert.equal(snapshotAfter![field], undefined);
  assert.deepEqual(await Fee.findById(fee).lean(), beforeFee);
  assert.equal((await resubmit(item._id, teacher, 'Again', 2)).status, 409);
  assert.equal((await detail(item._id)).data.data.capabilities.canReview, true);
});

test('resubmission authenticates current identity, confines branch and requires original ownership', async () => {
  const item = await request({status: 'changes_requested'});
  for (const suffix of ['resubmission', 'resubmit']) {
    const anonymous = await fetch(`${base}/approval-requests/${item._id}/${suffix}`, {method: suffix === 'resubmit' ? 'PATCH' : 'GET'});
    assert.equal(anonymous.status, 401);
  }
  for (const person of [principal, peer]) {
    assert.equal((await correction(item._id, person)).status, 403);
    assert.equal((await resubmit(item._id, person, 'Correction', 0)).status, 403);
  }
  assert.equal((await correction(item._id, foreign)).status, 404);
  assert.equal((await resubmit(item._id, foreign, 'Correction', 0)).status, 404);
  assert.equal((await correction(item._id, admin)).status, 403);
  assert.equal((await resubmit(item._id, admin, 'Correction', 0)).status, 403);
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  assert.equal((await correction(item._id)).status, 401);
  assert.equal((await resubmit(item._id, teacher, 'Correction', 0)).status, 401);
});

test('Student and Principal original requesters can resubmit but Principal still cannot self-review', async () => {
  const student = await actor('requester-student', 'student', branchA);
  for (const person of [student, principal]) {
    const item = await request({requesterId: person.id});
    assert.equal((await requestChanges(item._id, peer)).status, 200);
    assert.equal((await correction(item._id, person)).status, 200);
    assert.equal((await resubmit(item._id, person)).status, 200);
    if (person === principal) assert.equal((await decide(item._id, principal)).status, 403);
  }
});

test('resubmission whitelist rejects all server, financial, source, category and untyped fields', async () => {
  const item = await request({status: 'changes_requested'});
  const snapshotBefore = await ApprovalRequest.findById(item._id).lean();
  for (const field of ['branchId', 'requesterId', 'requester', 'reviewedBy', 'reviewedAt', 'delegatedTo', 'delegatedBy', 'delegationExpiresAt', 'history', 'status', '__v', 'version', 'revision', 'createdAt', 'updatedAt', 'authority', 'amount', 'approvalType', 'entityType', 'entityId', 'beforeData', 'afterData', 'supportingFileUrl', 'execution', 'executionStatus']) {
    assert.equal((await resubmit(item._id, teacher, 'Reason', 0, {[field]: 'spoof'})).status, 400, field);
  }
  for (const reason of [undefined, '', ' ', 123, null, {}, 'x'.repeat(501)]) assert.equal((await resubmit(item._id, teacher, 'Ignored fallback', 0, {reason})).status, 400);
  assert.deepEqual(await ApprovalRequest.findById(item._id).lean(), snapshotBefore);
});

test('resubmission requires a valid quoted revision and rejects query scope overrides', async () => {
  const item = await request({status: 'changes_requested'});
  for (const revision of [undefined, '0', '*', '"-1"', 'W/"0"', '"0", "1"', '"9007199254740992"']) {
    const response = await fetch(`${base}/approval-requests/${item._id}/resubmit`, {
      method: 'PATCH', headers: {Authorization: `Bearer ${teacher.token}`, 'Content-Type': 'application/json', ...(revision ? {'If-Match': revision} : {})}, body: JSON.stringify({reason: 'Correction'}),
    });
    assert.equal(response.status, 400);
  }
  for (const suffix of ['resubmission', 'resubmit']) {
    const result = await http(`/approval-requests/${item._id}/${suffix}?branchId=${branchB}`, teacher, suffix === 'resubmit' ? {reason: 'Correction'} : undefined);
    assert.equal(result.status, 400);
  }
  assert.equal((await correction('invalid')).status, 400);
});

test('pending, approved and rejected requests cannot be resubmitted; source branch changes remain concealed', async () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    const item = await request({status});
    assert.equal((await resubmit(item._id, teacher, 'Correction', 0)).status, 409);
  }
  const item = await request({status: 'changes_requested'});
  await Student.updateOne({_id: studentA}, {$set: {branchId: branchB}});
  assert.equal((await resubmit(item._id, teacher, 'Correction', 0)).status, 404);
});

test('new cycles reject old resubmission revisions and fresh review recalculates authority and delegation', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 50});
  assert.equal((await delegate(item._id)).status, 200);
  assert.equal((await requestChanges(item._id, peer)).status, 200);
  assert.equal((await resubmit(item._id, teacher, 'Correction', 2)).status, 200);
  const fresh = await detail(item._id, peer);
  assert.equal(fresh.data.data.capabilities.canDelegate, true);
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[principal.id.toString()].limits.refund = 49;
  delete policy[peer.id.toString()];
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  assert.equal((await decide(item._id, principal)).status, 403);
  assert.equal((await decide(item._id, peer)).status, 403);
  configure();
  assert.equal((await requestChanges(item._id)).status, 200);
  assert.equal((await resubmit(item._id, teacher, 'Stale correction', 2)).status, 409);
  assert.equal((await resubmit(item._id, teacher, 'Fresh correction', 4)).status, 200);
  assert.equal((await decide(item._id)).status, 200);
});

test('concurrent resubmits reach the same atomic snapshot and append exactly one entry', {timeout: 10000}, async () => {
  const item = await request({status: 'changes_requested'});
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  let arrived = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => {release = resolve;});
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => (async () => {
    if (++arrived === 2) release();
    await barrier; return original(...args);
  })());
  const results = await Promise.all([resubmit(item._id, teacher, 'First correction', 0), resubmit(item._id, teacher, 'Second correction', 0)]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 409]);
  const stored = await ApprovalRequest.findById(item._id);
  assert.equal(stored!.history.length, 1);
  assert.equal(stored!.__v, 1);
});

test('intervening snapshot changes reject resubmission without losing new state', async () => {
  const item = await request({status: 'changes_requested'});
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => (async () => {
    await ApprovalRequest.collection.updateOne({_id: item._id}, {$set: {reason: 'New server state'}, $inc: {__v: 1}});
    return original(...args);
  })());
  assert.equal((await resubmit(item._id, teacher, 'Correction', 0)).status, 409);
  const stored = await ApprovalRequest.findById(item._id);
  assert.equal(stored!.reason, 'New server state');
  assert.equal(stored!.status, 'changes_requested');
  assert.equal(stored!.history.length, 0);
});

test('a Principal write queued across request-changes and resubmission cannot overwrite the fresh cycle', async () => {
  const item = await request();
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  let arrived!: () => void, release!: () => void;
  const blocked = new Promise<void>(resolve => {arrived = resolve;});
  const barrier = new Promise<void>(resolve => {release = resolve;});
  let held = false;
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => (async () => {
    if (!held) {held = true; arrived(); await barrier;}
    return original(...args);
  })());
  const pendingDecision = decide(item._id);
  await blocked;
  try {
    assert.equal((await requestChanges(item._id, peer)).status, 200);
    assert.equal((await resubmit(item._id)).status, 200);
  } finally {release();}
  assert.equal((await pendingDecision).status, 409);
  assert.equal((await ApprovalRequest.findById(item._id))!.status, 'pending');
});

test('legacy change-requested records gain a guarded revision without removing old delegation history', async () => {
  const item = await request({status: 'changes_requested', delegatedTo: peer.id, delegatedBy: principal.id, delegationExpiresAt: new Date(Date.now() + 60000),
    history: [{action: 'delegated', performedBy: principal.id}]});
  await ApprovalRequest.collection.updateOne({_id: item._id}, {$unset: {__v: 1}});
  const snapshotBefore = await ApprovalRequest.findById(item._id);
  assert.equal((await correction(item._id)).data.data.revision, 0);
  assert.equal((await resubmit(item._id, teacher, 'Legacy correction', 0)).status, 200);
  const stored = await ApprovalRequest.findById(item._id);
  assert.equal(stored!.__v, 1);
  assert.equal(stored!.history[0]._id?.toString(), snapshotBefore!.history[0]._id?.toString());
  assert.equal(stored!.delegatedTo, undefined);
});

test('resubmission write failure is sanitized and leaves request unchanged', async () => {
  const item = await request({status: 'changes_requested'});
  const snapshotBefore = await ApprovalRequest.findById(item._id).lean();
  mock.method(ApprovalRequest, 'findOneAndUpdate', () => {throw new Error('private-resubmission-database');});
  const result = await resubmit(item._id, teacher, 'Correction', 0);
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.data).includes('private-resubmission-database'), false);
  assert.deepEqual(await ApprovalRequest.findById(item._id).lean(), snapshotBefore);
});

test('requester branch reassignment and session revocation after correction GET are revalidated on resubmit', async () => {
  const item = await request({status: 'changes_requested'});
  assert.equal((await correction(item._id)).status, 200);
  await User.updateOne({_id: teacher.id}, {$set: {branchId: branchB}});
  assert.equal((await resubmit(item._id, teacher, 'Correction', 0)).status, 404);
  await User.updateOne({_id: teacher.id}, {$set: {branchId: branchA}});
  await Session.updateOne({token: teacher.token}, {$set: {isRevoked: true}});
  assert.equal((await resubmit(item._id, teacher, 'Correction', 0)).status, 401);
  assert.equal((await correction(item._id)).status, 401);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'changes_requested');
});
