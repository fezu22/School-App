import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, {UserRole} from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import PrincipalTask from '../src/staff/src/models/principalTask';
import SafetyAlert from '../src/staff/src/models/safetyAlert';
import SchoolNotice from '../src/staff/src/models/schoolNotice';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import Student from '../src/staff/src/models/student';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Attendance from '../src/staff/src/models/attendance';
import Fee from '../src/staff/src/models/fee';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {PERMISSIONS, Permission} from '../src/staff/src/constants/permissions';

// Never load dotenv or a configured DB URI. Only this suite's temporary MongoDB.
let database: MongoMemoryReplSet, server: Server, base: string;
const jwtSecret = 'isolated-principal-authorization-test-secret';
const savedEnv = {jwt: process.env.JWT_SECRET, authority: process.env.PRINCIPAL_APPROVAL_AUTHORITY};
type Actor = {id: mongoose.Types.ObjectId; token: string};
type Route = {method: string; path: string; permission?: Permission; body?: unknown};
let principal: Actor, peer: Actor, teacher: Actor, student: Actor, foreign: Actor, admin: Actor;
let branchA: mongoose.Types.ObjectId, branchB: mongoose.Types.ObjectId;
let taskA: mongoose.Types.ObjectId, taskB: mongoose.Types.ObjectId;
let alertA: mongoose.Types.ObjectId, alertB: mongoose.Types.ObjectId;
let noticeA: mongoose.Types.ObjectId, noticeB: mongoose.Types.ObjectId;
let approvalA: mongoose.Types.ObjectId, approvalB: mongoose.Types.ObjectId;
let feeA: mongoose.Types.ObjectId, studentA: mongoose.Types.ObjectId;

before(async () => {
  database = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(database.getUri(), {dbName: 'principal_authorization_tests', autoIndex: false});
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
const configure = () => {
  // Monetary ceiling is a test fixture, not a proposed business default.
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(Object.fromEntries(
    [[principal, branchA], [peer, branchA], [foreign, branchB]].map(([person, branch]) => [
      String((person as Actor).id), {branchId: String(branch), types: ['leave', 'refund'], limits: {refund: 100}},
    ]),
  ));
};
const approval = (extra: Record<string, unknown> = {}) => new ApprovalRequest({
  branchId: branchA, requesterId: teacher.id, entityType: 'user', entityId: teacher.id,
  approvalType: 'leave', reason: 'Own request', ...extra,
}).save();
const notice = (extra: Record<string, unknown> = {}) => new SchoolNotice({
  branchId: branchA, title: 'Own notice', message: 'Own content', status: 'published', createdBy: principal.id, ...extra,
}).save();

beforeEach(async () => {
  mock.restoreAll();
  process.env.JWT_SECRET = jwtSecret;
  for (const model of [PrincipalTask, SafetyAlert, SchoolNotice, ApprovalRequest, Attendance, Fee, Student, Section, SchoolClass, Session, User, Branch]) {
    await model.collection.deleteMany({});
  }
  branchA = (await Branch.create({name: 'Own branch', code: 'AA', address: 'A', city: 'A'}))._id;
  branchB = (await Branch.create({name: 'FOREIGN PRIVATE branch', code: 'BB', address: 'B', city: 'B'}))._id;
  principal = await actor('principal', 'principal', branchA);
  peer = await actor('peer', 'principal', branchA);
  teacher = await actor('teacher', 'teacher', branchA);
  student = await actor('student', 'student', branchA);
  foreign = await actor('foreign-private-user', 'principal', branchB);
  admin = await actor('admin', 'super_admin');
  configure();
  taskA = (await PrincipalTask.create({branchId: branchA, title: 'Own task', assignedTo: teacher.id, createdBy: principal.id}))._id;
  taskB = (await PrincipalTask.create({branchId: branchB, title: 'FOREIGN PRIVATE task', assignedTo: foreign.id, createdBy: foreign.id}))._id;
  alertA = (await SafetyAlert.create({branchId: branchA, type: 'incident', title: 'Own alert'}))._id;
  alertB = (await SafetyAlert.create({branchId: branchB, type: 'incident', title: 'FOREIGN PRIVATE alert', severity: 'critical'}))._id;
  noticeA = (await notice())._id;
  noticeB = (await notice({branchId: branchB, title: 'FOREIGN PRIVATE notice', createdBy: foreign.id}))._id;
  approvalA = (await approval())._id;
  approvalB = (await approval({branchId: branchB, requesterId: foreign.id, entityId: foreign.id, reason: 'FOREIGN PRIVATE approval'}))._id;
  for (const [branchId, userId, code] of [[branchA, student.id, 'A'], [branchB, foreign.id, 'B']] as const) {
    const schoolClass = await SchoolClass.create({branchId, name: code, code, academicYear: 'test'});
    const section = await Section.create({branchId, classId: schoolClass._id, name: code, code});
    const record = await Student.create({branchId, userId, classId: schoolClass._id, sectionId: section._id, admissionNumber: code});
    const invoice = await Fee.create({branchId, studentId: record._id, academicYear: 'test', invoiceNumber: code,
      amount: code === 'A' ? 25 : 900, paidAmount: code === 'A' ? 5 : 0, dueDate: new Date()});
    await Attendance.create({branchId, studentId: record._id, classId: schoolClass._id, sectionId: section._id,
      date: new Date(), status: code === 'A' ? 'present' : 'absent', markedBy: userId});
    if (code === 'A') {feeA = invoice._id; studentA = record._id;}
  }
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (savedEnv.jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedEnv.jwt;
  if (savedEnv.authority === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = savedEnv.authority;
});

const http = async (route: Route, token: string | undefined) => {
  const response = await fetch(`${base}${route.path}`, {
    method: route.method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    ...(route.body === undefined ? {} : {body: JSON.stringify(route.body)}),
  });
  const raw = await response.text();
  const data = JSON.parse(raw);
  if (response.status >= 400) {
    for (const marker of ['FOREIGN PRIVATE', 'foreign-private-user', 'private-db-marker', jwtSecret, 'JsonWebTokenError', 'TokenExpiredError', ' at ']) {
      assert.equal(raw.includes(marker), false, `${route.method} ${route.path} leaked ${marker}`);
    }
    if (token) assert.equal(raw.includes(token), false);
  }
  return {status: response.status, data, raw};
};
const get = (path: string): Route => ({method: 'GET', path});
const principalRoutes = (): Route[] => [
  ...['/principal/dashboard', '/principal/notices', `/principal/notices/${noticeA}`,
    '/principal/tasks', `/principal/tasks/${taskA}`].map(path => ({...get(path), permission: PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW})),
  {...get('/principal/task-assignees'), permission: PERMISSIONS.PRINCIPAL_TASKS_MANAGE},
  {...get('/principal/safety-alerts'), permission: PERMISSIONS.PRINCIPAL_SAFETY_VIEW},
  {...get(`/principal/safety-alerts/${alertA}`), permission: PERMISSIONS.PRINCIPAL_SAFETY_VIEW},
  {...get(`/principal/safety-alerts/${alertA}/eligible-officers`), permission: PERMISSIONS.PRINCIPAL_SAFETY_MANAGE},
  {method: 'POST', path: '/principal/tasks', permission: PERMISSIONS.PRINCIPAL_TASKS_MANAGE, body: {title: 'Valid task', assignedTo: String(teacher.id)}},
  {method: 'PATCH', path: `/principal/tasks/${taskA}`, permission: PERMISSIONS.PRINCIPAL_TASKS_MANAGE, body: {action: 'start'}},
  {method: 'PATCH', path: `/principal/safety-alerts/${alertA}`, permission: PERMISSIONS.PRINCIPAL_SAFETY_MANAGE, body: {action: 'escalate'}},
  ...['/approval-requests/pending', `/approval-requests/${approvalA}`].map(path => ({...get(path), permission: PERMISSIONS.PRINCIPAL_APPROVALS_VIEW})),
  {...get(`/approval-requests/${approvalA}/eligible-delegates`), permission: PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE},
  {method: 'PATCH', path: `/approval-requests/${approvalA}`, permission: PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE, body: {action: 'approved'}},
];
const identityRoutes = () => [...principalRoutes(), get('/branches/my-branch')];
const denyEvery = async (token: string | undefined, status: number) => {
  for (const route of identityRoutes()) assert.equal((await http(route, token)).status, status, `${route.method} ${route.path}`);
};

for (const kind of ['missing', 'malformed', 'expired', 'missing session', 'revoked session'] as const) {
  test(`${kind} token/session is denied on every Principal endpoint and my-branch`, async () => {
    let token: string | undefined = principal.token;
    if (kind === 'missing') token = undefined;
    if (kind === 'malformed') token = 'not.a.jwt';
    if (kind === 'expired') {
      token = jwt.sign({userId: String(principal.id), role: 'principal'}, jwtSecret, {expiresIn: -1});
      await registerSession(String(principal.id), token, 'principal');
    }
    if (kind === 'missing session') await Session.deleteOne({token});
    if (kind === 'revoked session') await Session.updateOne({token}, {$set: {isRevoked: true}});
    await denyEvery(token, 401);
  });
}
for (const kind of ['deleted', 'inactive', 'role changed'] as const) {
  test(`${kind} DB identity invalidates an issued token on every Principal endpoint`, async () => {
    if (kind === 'deleted') await User.deleteOne({_id: principal.id});
    if (kind === 'inactive') await User.updateOne({_id: principal.id}, {$set: {isActive: false}});
    if (kind === 'role changed') await User.updateOne({_id: principal.id}, {$set: {role: 'teacher'}});
    await denyEvery(principal.token, 401);
  });
}
test('students, teachers and Super Admins cannot use Principal-only endpoints', async () => {
  for (const person of [student, teacher, admin]) {
    for (const route of principalRoutes()) assert.equal((await http(route, person.token)).status, 403, route.path);
  }
  for (const person of [student, teacher]) assert.equal((await http(get('/branches/my-branch'), person.token)).status, 200);
});
for (const permission of [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW, PERMISSIONS.PRINCIPAL_TASKS_MANAGE,
  PERMISSIONS.PRINCIPAL_SAFETY_VIEW, PERMISSIONS.PRINCIPAL_SAFETY_MANAGE,
  PERMISSIONS.PRINCIPAL_APPROVALS_VIEW, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE]) {
  test(`role alone cannot bypass removed permission ${permission}`, async () => {
    const original = ROLE_PERMISSIONS.principal;
    try {
      ROLE_PERMISSIONS.principal = original.filter(value => value !== permission);
      for (const route of principalRoutes().filter(value => value.permission === permission)) {
        assert.equal((await http(route, principal.token)).status, 403, route.path);
      }
    } finally {ROLE_PERMISSIONS.principal = original;}
  });
}
test('missing branch assignment fails closed on every Principal endpoint', async () => {
  await User.updateOne({_id: principal.id}, {$unset: {branchId: 1}});
  await denyEvery(principal.token, 403);
});

test('foreign branch query cannot widen any read family', async () => {
  for (const path of ['/principal/dashboard', '/principal/tasks', `/principal/tasks/${taskA}`, '/principal/safety-alerts',
    '/principal/task-assignees', '/principal/notices', `/principal/notices/${noticeA}`, '/approval-requests/pending', `/approval-requests/${approvalA}`, `/approval-requests/${approvalA}/eligible-delegates`, '/branches/my-branch']) {
    const result = await http(get(`${path}?branchId=${branchB}`), principal.token);
    assert.equal(result.status, 200, path);
    assert.equal(result.raw.includes('FOREIGN PRIVATE'), false, path);
    assert.equal(result.raw.includes(String(branchB)), false, path);
  }
});
test('mutation body scope/actor overrides are rejected without state changes', async () => {
  for (const route of principalRoutes().filter(value => value.method !== 'GET')) {
    const body = route.body as Record<string, unknown>;
    for (const field of ['branchId', 'actorId', 'createdBy']) {
      assert.equal((await http({...route, body: {...body, [field]: String(branchB)}}, principal.token)).status, 400);
    }
  }
  assert.equal((await PrincipalTask.findById(taskA))?.status, 'pending');
  assert.equal((await SafetyAlert.findById(alertA))?.status, 'open');
  assert.equal((await ApprovalRequest.findById(approvalA))?.status, 'pending');
});
test('foreign branch query cannot redirect valid task, safety or approval writes', async () => {
  for (const route of principalRoutes().filter(value => value.method !== 'GET')) {
    const result = await http({...route, path: `${route.path}?branchId=${branchB}`}, principal.token);
    assert.equal(result.status, route.method === 'POST' ? 201 : 200, route.path);
    if (route.method === 'POST') assert.equal(result.data.data.branchId, String(branchA));
  }
  assert.equal((await PrincipalTask.findById(taskA))?.status, 'in_progress');
  assert.equal((await SafetyAlert.findById(alertA))?.severity, 'critical');
  assert.equal((await ApprovalRequest.findById(approvalA))?.status, 'approved');
  assert.equal((await PrincipalTask.findById(taskB))?.status, 'pending');
  assert.equal((await SafetyAlert.findById(alertB))?.status, 'open');
  assert.equal((await ApprovalRequest.findById(approvalB))?.status, 'pending');
});
test('all object IDOR lookups/mutations conceal foreign records like missing records', async () => {
  const absent = new mongoose.Types.ObjectId();
  for (const [prefix, id, method, body] of [
    ['/principal/tasks', taskB, 'GET', undefined], ['/principal/tasks', taskB, 'PATCH', {action: 'complete'}],
    ['/principal/safety-alerts', alertB, 'PATCH', {action: 'resolve'}], ['/principal/notices', noticeB, 'GET', undefined],
    ['/approval-requests', approvalB, 'GET', undefined], ['/approval-requests', approvalB, 'PATCH', {action: 'approved'}],
  ] as const) {
    const result = await http({method, path: `${prefix}/${id}?branchId=${branchB}`, body}, principal.token);
    const missing = await http({method, path: `${prefix}/${absent}`, body}, principal.token);
    assert.equal(result.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(result.data, missing.data);
    assert.equal(result.raw.includes(String(id)), false);
  }
});
test('invalid object IDs fail with sanitized 400 responses', async () => {
  for (const path of ['/principal/tasks/invalid', '/principal/notices/invalid', '/approval-requests/invalid']) {
    assert.equal((await http(get(path), principal.token)).status, 400);
  }
  for (const path of ['/principal/tasks/invalid', '/principal/safety-alerts/invalid', '/approval-requests/invalid']) {
    const action = path.includes('tasks') ? 'complete' : path.includes('safety') ? 'resolve' : 'approved';
    assert.equal((await http({method: 'PATCH', path, body: {action}}, principal.token)).status, 400);
  }
});

test('dashboard isolates all aggregate families and ignores a spoofed GET JSON body', async () => {
  // HTTP fetch forbids GET bodies: use node:http to exercise Express's actual body parsing.
  const {request} = await import('node:http');
  const body = JSON.stringify({branchId: String(branchB)});
  const spoofed = await new Promise<{status: number; raw: string}>((resolve, reject) => {
    const req = request(`${base}/principal/dashboard?branchId=${branchB}`, {method: 'GET', headers: {
      Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    }}, res => {
      let raw = '';
      res.on('error', reject);
      res.on('data', chunk => {raw += chunk;});
      res.on('end', () => resolve({status: res.statusCode!, raw}));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(spoofed.status, 200);
  const data = JSON.parse(spoofed.raw).data;
  assert.equal(data.branch.id, String(branchA));
  assert.deepEqual(data.students, {total: 1, active: 1});
  assert.deepEqual(data.classes, {total: 1, active: 1});
  assert.deepEqual(data.sections, {total: 1, active: 1});
  assert.equal(data.attendance.totalMarked, 1);
  assert.equal(data.attendance.present, 1);
  assert.equal(data.attendance.absent, 0);
  assert.equal(data.feeSummary.totalAmount, 25);
  assert.equal(data.feeSummary.paidAmount, 5);
  assert.equal(data.feeSummary.outstandingAmount, 20);
  assert.equal(data.safetyAlerts.total, 1);
  assert.equal(data.safetyAlerts.critical, 0);
  assert.equal(data.pendingApprovals.total, 1);
  assert.deepEqual(data.tasks.map((value: {_id: string}) => value._id), [String(taskA)]);
  assert.deepEqual(data.notices.map((value: {_id: string}) => value._id), [String(noticeA)]);
  assert.equal(spoofed.raw.includes('FOREIGN PRIVATE'), false);
});
const assertApprovalParity = async (person: Actor, expected: number, byType: Record<string, number>) => {
  const dashboard = await http(get('/principal/dashboard'), person.token);
  const inbox = await http(get('/approval-requests/pending'), person.token);
  assert.equal(dashboard.status, 200);
  assert.equal(inbox.status, 200);
  const counts = dashboard.data.data.pendingApprovals;
  assert.equal(counts.total, expected);
  assert.equal(counts.total, inbox.data.data.total);
  assert.equal(counts.total, inbox.data.data.requests.length);
  for (const [type, count] of Object.entries(counts.byType)) {
    assert.equal(count, byType[type] ?? 0, type);
    assert.equal(count, inbox.data.data.requests.filter((item: {approvalType: string}) => item.approvalType === type).length);
  }
  assert.deepEqual(Object.keys(counts).sort(), ['byType', 'total']);
  return dashboard;
};

test('dashboard counts same-branch pending approvals inside authority and matches inbox', async () => {
  await assertApprovalParity(principal, 1, {leave: 1});
});

const assertNonDisclosingApprovals = (dashboard: Awaited<ReturnType<typeof http>>) => {
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.data.data.pendingApprovals, {total: 0, byType: {
    lesson_plan: 0, attendance_correction: 0, leave: 0, refund: 0, discount: 0, result: 0, paper: 0, purchase: 0, payroll: 0, certificate: 0,
  }});
  // Other existing dashboard cards remain available under dashboard permission.
  assert.equal(dashboard.data.data.branch.id, String(branchA));
  assert.equal(dashboard.data.data.attendance.totalMarked, 1);
  assert.equal(dashboard.data.data.feeSummary.totalAmount, 25);
  assert.equal(dashboard.data.data.safetyAlerts.total, 1);
  assert.equal(dashboard.data.data.notices.length, 1);
};

test('dashboard-view plus approval-view exposes permitted counts without requiring approval-manage', async () => {
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW, PERMISSIONS.PRINCIPAL_APPROVALS_VIEW];
    await assertApprovalParity(principal, 1, {leave: 1});
  } finally {ROLE_PERMISSIONS.principal = original;}
});

for (const manage of [false, true]) {
  test(`dashboard without approval-view returns zero and skips approval reads (manage=${manage})`, async () => {
    const original = ROLE_PERMISSIONS.principal;
    try {
      ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW,
        ...(manage ? [PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE] : [])];
      const reads = mock.method(ApprovalRequest, 'find', () => {throw new Error('Unexpected approval query');});
      assertNonDisclosingApprovals(await http(get('/principal/dashboard'), principal.token));
      assert.equal((await http(get('/approval-requests/pending'), principal.token)).status, 403);
      assert.equal(reads.mock.callCount(), 0);
    } finally {ROLE_PERMISSIONS.principal = original;}
  });
}

test('approval-view without dashboard-view permits inbox but cannot access dashboard', async () => {
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_APPROVALS_VIEW];
    assert.equal((await http(get('/principal/dashboard'), principal.token)).status, 403);
    const inbox = await http(get('/approval-requests/pending'), principal.token);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.data.data.requests.length, 1);
  } finally {ROLE_PERMISSIONS.principal = original;}
});

test('approval count permission gating never grants Principal dashboard access to other roles', async () => {
  for (const person of [admin, teacher, student]) {
    assert.equal((await http(get('/principal/dashboard'), person.token)).status, 403);
  }
});

test('query and GET body permission claims cannot disclose dashboard approval counts', async () => {
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW];
    assertNonDisclosingApprovals(await http(get(`/principal/dashboard?permissions=${PERMISSIONS.PRINCIPAL_APPROVALS_VIEW}&canViewApprovals=true&role=super_admin`), principal.token));
    const {request} = await import('node:http');
    const body = JSON.stringify({permissions: [PERMISSIONS.PRINCIPAL_APPROVALS_VIEW], canViewApprovals: true,
      role: 'super_admin', actorId: String(peer.id), branchId: String(branchB)});
    const result = await new Promise<{status: number; data: unknown}>((resolve, reject) => {
      const req = request(`${base}/principal/dashboard`, {method: 'GET', headers: {
        Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      }}, res => {
        let raw = '';
        res.on('error', reject);
        res.on('data', chunk => {raw += chunk;});
        res.on('end', () => resolve({status: res.statusCode!, data: JSON.parse(raw)}));
      });
      req.on('error', reject);
      req.end(body);
    });
    assertNonDisclosingApprovals({...result, raw: ''});
  } finally {ROLE_PERMISSIONS.principal = original;}
});

test('removing and restoring approval-view changes counts immediately with current authority', async () => {
  const original = ROLE_PERMISSIONS.principal;
  try {
    await assertApprovalParity(principal, 1, {leave: 1});
    ROLE_PERMISSIONS.principal = original.filter(permission => permission !== PERMISSIONS.PRINCIPAL_APPROVALS_VIEW);
    assertNonDisclosingApprovals(await http(get('/principal/dashboard'), principal.token));
    assert.equal((await http(get('/approval-requests/pending'), principal.token)).status, 403);
    // Restoration must not revive stale authority or an old aggregate.
    const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
    policy[String(principal.id)].types = [];
    process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
    ROLE_PERMISSIONS.principal = original;
    await assertApprovalParity(principal, 0, {});
    configure();
    await assertApprovalParity(principal, 1, {leave: 1});
  } finally {ROLE_PERMISSIONS.principal = original;}
});

test('dashboard excludes categories outside the Principal grant', async () => {
  await approval({approvalType: 'payroll', amount: 10});
  await assertApprovalParity(principal, 1, {leave: 1});
});

test('dashboard excludes financial requests above the stored authority ceiling', async () => {
  await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 101});
  await assertApprovalParity(principal, 1, {leave: 1});
});

test('dashboard counts financial requests within and exactly at the authority ceiling', async () => {
  await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 25});
  await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 100});
  await assertApprovalParity(principal, 3, {leave: 1, refund: 2});
});

test('dashboard excludes missing/foreign sources, requesters and broken nested fee references', async () => {
  await approval({entityId: new mongoose.Types.ObjectId()});
  await approval({entityId: foreign.id});
  await approval({requesterId: foreign.id});
  await approval({entityType: 'unsupported'});
  await approval({entityId: undefined});
  const foreignFee = await Fee.findOne().where('branchId').equals(branchB).select('_id');
  assert.ok(foreignFee, 'Foreign fee fixture must exist');
  await approval({approvalType: 'refund', entityType: 'fee', entityId: foreignFee._id, amount: 25});
  await assertApprovalParity(principal, 1, {leave: 1});
  // A previously valid fee reference must stop being counted when its linked
  // student no longer belongs to the reviewer's current branch.
  await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 25});
  await Student.updateOne({_id: studentA}, {$set: {branchId: branchB}});
  await assertApprovalParity(principal, 1, {leave: 1});
});

test('dashboard and inbox use each authenticated Principal current policy without exposing approval payloads', async () => {
  await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 50,
    reason: 'PRIVATE approval reason', supportingFileUrl: 'https://private.invalid/attachment',
    beforeData: {secret: 'PRIVATE before'}, afterData: {secret: 'PRIVATE after'}});
  await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 75});
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[String(peer.id)] = {branchId: String(branchA), types: ['refund'], limits: {refund: 50}};
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  const dashboard = await assertApprovalParity(principal, 3, {leave: 1, refund: 2});
  await assertApprovalParity(peer, 1, {refund: 1});
  for (const marker of ['PRIVATE approval reason', 'private.invalid', 'PRIVATE before', 'PRIVATE after',
    'supportingFileUrl', 'beforeData', 'afterData', String(approvalA), String(approvalB)]) {
    assert.equal(dashboard.raw.includes(marker), false, marker);
  }
  // The policy is evaluated afresh, not cached per user or branch.
  policy[String(principal.id)].types = [];
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  await assertApprovalParity(principal, 0, {});
});

test('dashboard and inbox exclude self-review and expired delegated review without relaxing decision guards', async () => {
  await approval({requesterId: principal.id});
  await approval({delegatedTo: principal.id, delegatedBy: peer.id, delegationExpiresAt: new Date('2000-01-01')});
  await assertApprovalParity(principal, 1, {leave: 1});
});

test('dashboard and inbox preserve PR-5 active delegation, no expired fallback and other direct reviewers', async () => {
  const independent = await actor('independent-reviewer', 'principal', branchA);
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[String(independent.id)] = {branchId: String(branchA), types: ['leave']};
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  const delegated = await approval({delegatedTo: principal.id, delegatedBy: peer.id,
    delegationExpiresAt: new Date(Date.now() + 60000)});
  await assertApprovalParity(principal, 2, {leave: 2});
  const detail = await http(get(`/approval-requests/${delegated._id}`), principal.token);
  assert.equal(detail.data.data.capabilities.canReview, true);
  assert.equal(detail.data.data.capabilities.canDelegate, false);
  assert.equal((await http({method: 'PATCH', path: `/approval-requests/${delegated._id}`, body: {
    action: 'delegated', delegatedTo: String(independent.id), delegationExpiresAt: new Date(Date.now() + 60000).toISOString(),
  }}, principal.token)).status, 403);
  await ApprovalRequest.updateOne({_id: delegated._id}, {$set: {delegationExpiresAt: new Date('2000-01-01')}});
  // Assigned delegate still has its independent grant, but PR-5 forbids fallback.
  await assertApprovalParity(principal, 1, {leave: 1});
  assert.equal((await http({method: 'PATCH', path: `/approval-requests/${delegated._id}`, body: {action: 'approved'}}, principal.token)).status, 403);
  await assertApprovalParity(peer, 2, {leave: 2});
  await assertApprovalParity(independent, 2, {leave: 2});
  assert.equal((await http(get(`/approval-requests/${delegated._id}`), peer.token)).data.data.capabilities.canReview, true);
  assert.equal((await http(get(`/approval-requests/${delegated._id}`), independent.token)).data.data.capabilities.canReview, true);
});

test('dashboard approval count ignores query/body actor, branch, category and amount overrides', async () => {
  const expected = (await assertApprovalParity(principal, 1, {leave: 1})).data.data.pendingApprovals;
  const queried = await http(get(`/principal/dashboard?branchId=${branchB}&actorId=${foreign.id}&approvalType=refund&amount=0`), principal.token);
  assert.deepEqual(queried.data.data.pendingApprovals, expected);
  // node:http is required because fetch forbids GET bodies.
  const {request} = await import('node:http');
  const body = JSON.stringify({branchId: String(branchB), actorId: String(foreign.id),
    requesterId: String(foreign.id), approvalType: 'refund', amount: 0});
  const result = await new Promise<{status: number; raw: string}>((resolve, reject) => {
    const req = request(`${base}/principal/dashboard?branchId=${branchB}`, {method: 'GET', headers: {
      Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    }}, res => {
      let raw = '';
      res.on('error', reject);
      res.on('data', chunk => {raw += chunk;});
      res.on('end', () => resolve({status: res.statusCode!, raw}));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.raw).data.pendingApprovals, expected);
});

test('branch reassignment after login uses DB scope on every read and write family', async () => {
  await User.updateOne({_id: principal.id}, {$set: {branchId: branchB}});
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[String(principal.id)]: {branchId: String(branchB), types: ['leave']}});
  const dashboard = await http(get('/principal/dashboard'), principal.token);
  assert.equal(dashboard.data.data.branch.id, String(branchB));
  assert.equal(dashboard.data.data.feeSummary.totalAmount, 900);
  assert.equal((await http(get('/branches/my-branch'), principal.token)).data.branch._id, String(branchB));
  for (const path of ['/principal/tasks', '/principal/notices', '/principal/safety-alerts', '/approval-requests/pending']) {
    const result = await http(get(`${path}?branchId=${branchA}`), principal.token);
    assert.equal(result.status, 200);
    assert.equal(result.raw.includes(String(taskA)), false);
    assert.equal(result.raw.includes(String(noticeA)), false);
    assert.equal(result.raw.includes(String(alertA)), false);
    assert.equal(result.raw.includes(String(approvalA)), false);
  }
  for (const [prefix, oldId, newId] of [['/principal/tasks', taskA, taskB], ['/principal/notices', noticeA, noticeB], ['/approval-requests', approvalA, approvalB]] as const) {
    assert.equal((await http(get(`${prefix}/${oldId}`), principal.token)).status, 404);
    assert.equal((await http(get(`${prefix}/${newId}`), principal.token)).status, 200);
  }
  for (const [path, action] of [[`/principal/tasks/${taskA}`, 'complete'], [`/principal/safety-alerts/${alertA}`, 'resolve'], [`/approval-requests/${approvalA}`, 'approved']]) {
    assert.equal((await http({method: 'PATCH', path, body: {action}}, principal.token)).status, 404);
  }
  const created = await http({method: 'POST', path: '/principal/tasks', body: {title: 'New branch task', assignedTo: String(foreign.id)}}, principal.token);
  assert.equal(created.status, 201);
  assert.equal(created.data.data.branchId, String(branchB));
  assert.equal((await http({method: 'PATCH', path: `/principal/tasks/${created.data.data._id}`, body: {action: 'complete'}}, principal.token)).status, 200);
  assert.equal((await http({method: 'PATCH', path: `/principal/safety-alerts/${alertB}`, body: {action: 'resolve'}}, principal.token)).status, 200);
  assert.equal((await http({method: 'PATCH', path: `/approval-requests/${approvalB}`, body: {action: 'approved'}}, principal.token)).status, 200);
});

test('notice list publication/expiry filtering and scoped detail preserve current behavior', async () => {
  const draft = await notice({status: 'draft'});
  const archived = await notice({status: 'archived'});
  const expired = await notice({expiresAt: new Date('2000-01-01T00:00:00Z')});
  const live = await notice({expiresAt: new Date('2099-01-01T00:00:00Z')});
  const list = await http(get('/principal/notices'), principal.token);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.data.map((value: {_id: string}) => value._id).sort(), [String(noticeA), String(live._id)].sort());
  // Detail has no publication/expiry gate today; do not invent one in this PR.
  for (const id of [noticeA, draft._id, archived._id, expired._id]) {
    assert.equal((await http(get(`/principal/notices/${id}`), principal.token)).status, 200);
  }
});
test('task and safety assignments deny foreign, inactive and non-staff users', async () => {
  await User.updateOne({_id: peer.id}, {$set: {isActive: false}});
  for (const [person, expected] of [[foreign, 404], [peer, 403], [student, 403]] as const) {
    for (const route of [
      {method: 'POST', path: '/principal/tasks', body: {title: 'Task', assignedTo: String(person.id)}},
      {method: 'PATCH', path: `/principal/safety-alerts/${alertA}`, body: {action: 'assign', assignedTo: String(person.id)}},
    ]) assert.equal((await http(route, principal.token)).status, expected);
  }
});
test('task creator/assignee restrictions and final-state guards survive valid requests', async () => {
  const action: Route = {method: 'PATCH', path: `/principal/tasks/${taskA}`, body: {action: 'complete'}};
  assert.equal((await http(action, peer.token)).status, 403);
  const own = await http({method: 'POST', path: '/principal/tasks', body: {title: 'Peer task', assignedTo: String(peer.id)}}, principal.token);
  assert.equal(own.status, 201);
  const peerAction = {...action, path: `/principal/tasks/${own.data.data._id}`};
  assert.equal((await http(peerAction, peer.token)).status, 200);
  assert.equal((await http(peerAction, peer.token)).status, 409);
  assert.equal((await http(action, principal.token)).status, 200);
  assert.equal((await http(action, principal.token)).status, 409);
});
test('safety valid action and repeated final action retain atomic conflict semantics', async () => {
  const route: Route = {method: 'PATCH', path: `/principal/safety-alerts/${alertA}`, body: {action: 'resolve'}};
  assert.equal((await http(route, principal.token)).status, 200);
  assert.equal((await http(route, principal.token)).status, 409);
});

test('legacy safety assignee references cannot populate foreign user identity', async () => {
  await SafetyAlert.updateOne({_id: alertA}, {$set: {assignedTo: foreign.id}});
  const result = await http(get('/principal/safety-alerts'), principal.token);
  assert.equal(result.status, 200);
  assert.equal(result.data.data.length, 1);
  assert.equal(result.data.data[0].assignedTo, null);
  for (const marker of ['foreign-private-user', String(foreign.id), 'FOREIGN PRIVATE']) {
    assert.equal(result.raw.includes(marker), false);
  }
});

test('approval category, stored financial limits and requester separation fail closed', async () => {
  const unsupported = await approval({approvalType: 'paper'});
  const self = await approval({requesterId: principal.id});
  const over = await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 101});
  const within = await approval({approvalType: 'refund', entityType: 'fee', entityId: feeA, amount: 100});
  for (const id of [unsupported._id, self._id, over._id]) {
    assert.equal((await http({method: 'PATCH', path: `/approval-requests/${id}`, body: {action: 'approved'}}, principal.token)).status, 403);
  }
  const route: Route = {method: 'PATCH', path: `/approval-requests/${within._id}`, body: {action: 'approved'}};
  assert.equal((await http(route, principal.token)).status, 200);
  assert.equal((await http(route, principal.token)).status, 409);
  delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  assert.equal((await http(get('/approval-requests/pending'), principal.token)).data.data.total, 0);
  assert.equal((await http(get(`/approval-requests/${approvalA}`), principal.token)).status, 403);
});
test('approval requester/entity references and historical populations cannot leak another branch', async () => {
  for (const extra of [{requesterId: foreign.id}, {entityId: foreign.id}, {entityType: 'student', entityId: studentA, requesterId: foreign.id}]) {
    const item = await approval(extra);
    for (const method of ['GET', 'PATCH']) {
      assert.equal((await http({method, path: `/approval-requests/${item._id}`, ...(method === 'PATCH' ? {body: {action: 'approved'}} : {})}, principal.token)).status, 404);
    }
  }
  const item = await approval({reviewedBy: foreign.id, delegatedTo: foreign.id, delegatedBy: foreign.id,
    supportingFileUrl: 'https://private.invalid/secret', beforeData: {secret: 'private-payload'}, afterData: {secret: 'private-payload'},
    history: [{action: 'delegated', performedBy: foreign.id, delegatedBy: foreign.id, createdAt: new Date()}]});
  const result = await http(get(`/approval-requests/${item._id}`), principal.token);
  assert.equal(result.status, 200);
  for (const marker of ['foreign-private-user', String(foreign.id), 'private-payload', 'supportingFileUrl', 'beforeData', 'afterData']) {
    assert.equal(result.raw.includes(marker), false);
  }
});
test('delegation denies foreign/ineligible delegates and expired grants but permits valid scoped delegation', async () => {
  const route: Route = {method: 'PATCH', path: `/approval-requests/${approvalA}`, body: {action: 'delegated'}};
  for (const person of [foreign, teacher, student]) {
    assert.equal((await http({...route, body: {action: 'delegated', delegatedTo: String(person.id), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()}}, principal.token)).status, 403);
  }
  assert.equal((await http({...route, body: {action: 'delegated', delegatedTo: String(peer.id), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()}}, principal.token)).status, 200);
  await ApprovalRequest.updateOne({_id: approvalA}, {$set: {delegationExpiresAt: new Date('2000-01-01T00:00:00Z')}});
  assert.equal((await http({...route, body: {action: 'approved'}}, peer.token)).status, 403);
  const valid = await approval();
  const validRoute = {...route, path: `/approval-requests/${valid._id}`};
  assert.equal((await http({...validRoute, body: {action: 'delegated', delegatedTo: String(peer.id), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()}}, principal.token)).status, 200);
  assert.equal((await http({...validRoute, body: {action: 'approved'}}, peer.token)).status, 200);
});

const adminRoutes = (): Route[] => [
  ...['/admin/dashboard', '/branches', `/branches/${branchB}`, '/sessions', '/privileged-requests/pending', '/automation', '/backup', '/usage', '/health'].map(get),
  {method: 'POST', path: '/branches', body: {}}, {method: 'POST', path: '/admin/principals', body: {}},
  {method: 'PATCH', path: `/sessions/${new mongoose.Types.ObjectId()}/revoke`, body: {}},
  {method: 'PATCH', path: `/privileged-requests/${new mongoose.Types.ObjectId()}/review`, body: {}},
  {method: 'PATCH', path: '/automation/example/pause', body: {}},
];
test('all Super Admin route families deny Principals, students, teachers and anonymous callers', async () => {
  for (const route of adminRoutes()) {
    for (const person of [principal, student, teacher]) assert.equal((await http(route, person.token)).status, 403, route.path);
    assert.equal((await http(route, undefined)).status, 401, route.path);
  }
});
test('Super Admin retains authenticated access to administrative read routes', async () => {
  for (const route of adminRoutes().filter(value => value.method === 'GET')) {
    const result = await http(route, admin.token);
    assert.equal(result.status, 200, route.path);
    if (route.path === '/sessions') assert.equal(result.raw.includes(principal.token), false);
  }
});
test('unexpected authorization/data failures are sanitized across Principal read families', async () => {
  mock.method(Session, 'findOne', () => {throw new Error('private-db-marker');});
  await denyEvery(principal.token, 401);
  mock.restoreAll();
  mock.method(Branch, 'findById', () => {throw new Error('private-db-marker');});
  assert.equal((await http(get('/principal/dashboard'), principal.token)).status, 500);
  mock.restoreAll();
  mock.method(SchoolNotice.collection, 'findOne', () => {throw new Error('private-db-marker');});
  assert.equal((await http(get(`/principal/notices/${noticeA}`), principal.token)).status, 500);
});
