import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import Room from '../src/staff/src/models/room';
import Student from '../src/staff/src/models/student';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import { AcademicPeriod } from '../src/staff/src/models/academicPeriod';
import { ClassSubject } from '../src/staff/src/models/classSubject';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
} from '../src/staff/src/models/timetable';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { writeSetup } from '../src/staff/src/services/academic-setup.service';

import { createHash } from 'node:crypto';
import PrincipalTask from '../src/staff/src/models/principalTask';
import {
  TeacherNotice,
  NoticeOperation,
  NoticeDelivery,
} from '../src/staff/src/models/teacherNotice';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import {
  opaqueAuthContext,
  revalidateAuthenticatedSession,
  sessionIdentity,
  jwtAuthContext,
  authenticatedTransaction,
} from '../src/staff/src/services/authenticated-session.service';

// Both drivers connect ONLY to this suite's owned replica set. The integrated
// HTTP path uses real native login/session validation, not a fake req.user.
const native = require('../src/database');
const { hashPassword, logout: nativeLogout } = require('../src/auth');
let database: MongoMemoryReplSet, server: Server, base: string;
let schoolA: mongoose.Types.ObjectId, schoolB: mongoose.Types.ObjectId;
let branchA: string, sibling: string, foreign: string, admin: string;
let token: string;
type Catalog = {
  period: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  roomId: string;
  teacherId: string;
  studentId: string;
  assignmentId: string;
};
let own: Catalog,
  other: Catalog,
  principal: string,
  teacherToken: string,
  principalToken: string,
  jwt: string;
const password = 'isolated-school-password-123';
const credentials = hashPassword(password);
const identity = () => ({ userId: admin, role: 'super_admin' as const });
const previousIntegration = process.env.INTEGRATED_STAFF_ENABLED;
const previousSecret = process.env.JWT_SECRET;
const principalPermissions = [...ROLE_PERMISSIONS.principal];
const teacherPermissions = [...ROLE_PERMISSIONS.teacher];

before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri(), {
    dbName: 'int02_session_contract',
    autoIndex: false,
  });
  await native.connectDatabase({
    MONGODB_URI: database.getUri(),
    MONGODB_DB: 'int02_session_contract',
  });
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  process.env.JWT_SECRET = 'isolated-int02-jwt-fixture';
  for (const model of [
    User,
    Branch,
    AcademicPeriod,
    SchoolClass,
    Section,
    Subject,
    Room,
    Student,
    TeacherAssignment,
    ClassSubject,
    TimetableVersion,
    TimetablePeriod,
    SubstituteAssignment,
  ])
    await model.createIndexes();
  // tsx prefers the same-name legacy server.ts even for a .js specifier.
  // Compile the actual CJS entry source without starting either server entry.
  const Module = require('node:module');
  const serverFile = require('node:path').resolve(
    __dirname,
    '../src/server.js',
  );
  const compiled = new Module(serverFile, module);
  compiled.filename = serverFile;
  compiled.paths = Module._nodeModulePaths(
    require('node:path').dirname(serverFile),
  );
  compiled._compile(
    require('node:fs').readFileSync(serverFile, 'utf8'),
    serverFile,
  );
  const { createApplication } = compiled.exports;
  server = createApplication({ staff: () => app }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

beforeEach(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = [...principalPermissions];
  ROLE_PERMISSIONS.teacher = [...teacherPermissions];
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
  schoolA = new mongoose.Types.ObjectId();
  schoolB = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('schools').insertMany([
    { _id: schoolA, name: 'Owned school', isActive: true },
    { _id: schoolB, name: 'Foreign school', isActive: true },
  ]);
  const branches = await Branch.create([
    {
      schoolId: schoolA,
      name: 'Own campus',
      code: 'OWN',
      address: 'Fixture',
      city: 'Fixture',
    },
    {
      schoolId: schoolA,
      name: 'Sibling campus',
      code: 'SIB',
      address: 'Fixture',
      city: 'Fixture',
    },
    {
      schoolId: schoolB,
      name: 'Foreign campus',
      code: 'FOREIGN',
      address: 'Fixture',
      city: 'Fixture',
    },
  ]);
  [branchA, sibling, foreign] = branches.map(row => String(row._id));
  const account = await new User({
    fullName: 'School Administrator',
    email: 'school-admin@test.invalid',
    password: 'fixture-hash',
    role: 'super_admin',
  }).save();
  admin = String(account._id);
  await User.collection.updateOne(
    { _id: account._id },
    { $set: { schoolId: schoolA, ...credentials } },
  );
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password }),
  });
  assert.equal(login.status, 200);
  token = (await login.json()).data.token;
  own = await catalog(branchA, schoolA, 'OWN');
  other = await catalog(foreign, schoolB, 'FOREIGN');
  const p = await new User({
    schoolId: schoolA,
    branchId: branchA,
    role: 'principal',
    fullName: 'Own Principal',
    email: 'principal@test.invalid',
    password: 'fixture-hash',
  }).save();
  principal = String(p._id);
  await User.collection.updateOne({ _id: p._id }, { $set: credentials });
  teacherToken = await nativeLogin(own.teacherId);
  principalToken = await nativeLogin(principal);
  jwt = generateAccessToken(admin, 'super_admin');
  await registerSession(admin, jwt, 'super_admin');
});

after(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = principalPermissions;
  ROLE_PERMISSIONS.teacher = teacherPermissions;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await native.closeDatabase();
  await mongoose.disconnect();
  if (database) await database.stop();
  if (previousIntegration === undefined)
    delete process.env.INTEGRATED_STAFF_ENABLED;
  else process.env.INTEGRATED_STAFF_ENABLED = previousIntegration;
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function nativeLogin(id: string) {
  const user = await User.findById(id).lean();
  const response = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user!.email, password }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).data.token as string;
}
async function catalog(
  branchId: string,
  schoolId: mongoose.Types.ObjectId,
  prefix: string,
): Promise<Catalog> {
  const common = { branchId, createdBy: admin, updatedBy: admin };
  const period = await AcademicPeriod.create({
    ...common,
    name: prefix + ' year',
    code: 'YEAR',
    startDate: '2020-01-01',
    endDate: '2030-12-31',
    status: 'active',
  });
  const cls = await new SchoolClass({
    branchId,
    academicPeriodId: period._id,
    name: prefix + ' class',
    code: 'CLASS',
    academicYear: 'YEAR',
  }).save();
  const section = await new Section({
    branchId,
    classId: cls._id,
    name: prefix + ' section',
    code: 'A',
  }).save();
  const subject = await Subject.create({ branchId, name: prefix + ' subject' });
  const room = await Room.create({
    ...common,
    name: prefix + ' room',
    code: 'ROOM',
    category: 'classroom',
  });
  await ClassSubject.create({
    ...common,
    academicPeriodId: period._id,
    classId: cls._id,
    subjectId: subject._id,
  });
  const teacher = await new User({
    schoolId,
    branchId,
    fullName: prefix + ' teacher',
    email: prefix.toLowerCase() + '-teacher@test.invalid',
    role: 'teacher',
    password: 'fixture-hash',
  }).save();
  await User.collection.updateOne({ _id: teacher._id }, { $set: credentials });
  const learner = await new User({
    schoolId,
    branchId,
    fullName: prefix + ' student',
    email: prefix.toLowerCase() + '-student@test.invalid',
    role: 'student',
    password: 'fixture-hash',
  }).save();
  const student = await new Student({
    branchId,
    userId: learner._id,
    classId: cls._id,
    sectionId: section._id,
    admissionNumber: prefix,
  }).save();
  const assignment = await TeacherAssignment.create({
    ...common,
    teacherId: teacher._id,
    classId: cls._id,
    sectionId: section._id,
    subjectId: subject._id,
    validFrom: '2020-01-01',
  });
  return {
    period: String(period._id),
    classId: String(cls._id),
    sectionId: String(section._id),
    subjectId: String(subject._id),
    roomId: String(room._id),
    teacherId: String(teacher._id),
    studentId: String(student._id),
    assignmentId: String(assignment._id),
  };
}

const http = async (
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
) => {
  const response = await fetch(base + path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token ?? token}`,
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, json: await response.json() };
};

test('INT-02: real native opaque login reaches a transactional staff write', async () => {
  assert.equal(token.includes('.'), false);
  assert.equal((await http('/academic-setup/branches')).status, 200);
  const response = await http('/academic-setup/subjects?branchId=' + branchA, {
    method: 'POST',
    body: { name: 'Opaque session subject' },
  });
  assert.equal(response.status, 201);
  assert.equal(
    await Subject.countDocuments({
      branchId: branchA,
      name: 'Opaque session subject',
    }),
    1,
  );
});

const sessionQuery = (bearer: string) => ({
  tokenHash: createHash('sha256').update(bearer).digest('hex'),
  type: 'access',
});
const sessions = () => mongoose.connection.collection('refreshTokens');
const taskBody = () => ({
  title: 'Session protected task',
  assignedTo: own.teacherId,
});
const noticeBody = () => ({
  classId: own.classId,
  sectionId: own.sectionId,
  subjectId: own.subjectId,
  audienceType: 'class_students',
  title: 'Session protected notice',
  body: 'Read the assigned lesson',
  language: 'en',
});
const taskWrite = () =>
  http('/principal/tasks', {
    token: principalToken,
    method: 'POST',
    body: taskBody(),
  });
const noticeWrite = () =>
  http('/teacher/notices', {
    token: teacherToken,
    method: 'POST',
    body: noticeBody(),
  });
async function contextFor(
  id: string,
  bearer: string,
  role: 'super_admin' | 'principal' | 'teacher',
) {
  return opaqueAuthContext(
    { userId: id, role },
    await sessions().findOne(sessionQuery(bearer)),
  );
}
async function noSideEffects() {
  for (const Model of [
    PrincipalTask,
    TeacherNotice,
    NoticeOperation,
    NoticeDelivery,
  ])
    assert.equal(await Model.collection.countDocuments({}), 0);
}

test('INT-02: opaque Principal and Teacher HTTP writes persist without typed Session rows', async () => {
  assert.equal(
    await mongoose.connection
      .collection('sessions')
      .countDocuments({ userId: new mongoose.Types.ObjectId(principal) }),
    0,
  );
  assert.equal((await taskWrite()).status, 201);
  assert.equal((await noticeWrite()).status, 200);
  assert.equal(
    await PrincipalTask.collection.countDocuments({
      branchId: new mongoose.Types.ObjectId(branchA),
    }),
    1,
  );
  assert.equal(
    await TeacherNotice.collection.countDocuments({
      branchId: new mongoose.Types.ObjectId(branchA),
    }),
    1,
  );
});

test('INT-02: opaque writes for all staff roles do not depend on JWT configuration or typed Sessions', async () => {
  const secret = process.env.JWT_SECRET;
  await mongoose.connection.collection('sessions').deleteMany({});
  delete process.env.JWT_SECRET;
  try {
    assert.equal(
      (
        await http('/academic-setup/subjects?branchId=' + branchA, {
          method: 'POST',
          body: { name: 'Opaque-only subject' },
        })
      ).status,
      201,
    );
    assert.equal((await taskWrite()).status, 201);
    assert.equal((await noticeWrite()).status, 200);
    assert.equal(
      await mongoose.connection.collection('sessions').countDocuments({}),
      0,
    );
  } finally {
    process.env.JWT_SECRET = secret;
  }
});

test('INT-02: Teacher provisioning accepts opaque session and retains trusted school', async () => {
  const result = await http('/admin/teachers', {
    method: 'POST',
    body: {
      fullName: 'Opaque Teacher',
      email: 'opaque-teacher@test.invalid',
      password: 'fixture-teacher-password',
      branchId: branchA,
    },
  });
  assert.equal(result.status, 201);
  assert.equal(
    String(
      (await User.findOne({ email: 'opaque-teacher@test.invalid' }))!.schoolId,
    ),
    String(schoolA),
  );
});

test('INT-02: logout revokes exact native row; protected reads/writes fail afterwards', async () => {
  assert.equal(
    (await http('/auth/logout', { method: 'POST', body: {} })).status,
    200,
  );
  assert.ok((await sessions().findOne(sessionQuery(token)))!.revokedAt);
  assert.equal((await http('/academic-setup/branches')).status, 401);
  assert.equal(
    (
      await http('/academic-setup/subjects?branchId=' + branchA, {
        method: 'POST',
        body: { name: 'Denied' },
      })
    ).status,
    401,
  );
  assert.equal(await Subject.countDocuments({ name: 'Denied' }), 0);
});

test('INT-02: native expiry and deletion are authoritative', async () => {
  assert.equal((await http('/academic-setup/branches')).status, 200);
  await sessions().updateOne(sessionQuery(token), {
    $set: { expiresAt: new Date(0) },
  });
  assert.equal((await http('/academic-setup/branches')).status, 401);
  const fresh = await nativeLogin(admin);
  await sessions().deleteOne(sessionQuery(fresh));
  assert.equal(
    (await http('/academic-setup/branches', { token: fresh })).status,
    401,
  );
});

test('INT-02: two sessions remain independent; disable and role change deny both', async () => {
  const second = await nativeLogin(admin);
  for (const bearer of [token, second])
    assert.equal(
      (await http('/academic-setup/branches', { token: bearer })).status,
      200,
    );
  await http('/auth/logout', { method: 'POST', token, body: {} });
  assert.equal((await http('/academic-setup/branches')).status, 401);
  assert.equal(
    (await http('/academic-setup/branches', { token: second })).status,
    200,
  );
  const third = await nativeLogin(admin);
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(admin) },
    { $set: { isActive: false } },
  );
  for (const bearer of [second, third])
    assert.equal(
      (await http('/academic-setup/branches', { token: bearer })).status,
      401,
    );
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(admin) },
    { $set: { isActive: true, role: 'teacher' } },
  );
  for (const bearer of [second, third])
    assert.equal(
      (await http('/academic-setup/branches', { token: bearer })).status,
      403,
    );
});

test('INT-02: native Teacher session inventory and per-device revoke use native authority without secret DTOs', async () => {
  const second = await nativeLogin(own.teacherId);
  const list = await http('/teacher/device-sessions', { token: teacherToken });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.total, 2);
  assert.equal(
    list.json.data.items.filter((row: any) => row.current).length,
    1,
  );
  const serialized = JSON.stringify(list.json);
  for (const secret of [teacherToken, second, 'tokenHash', 'authMode'])
    assert.equal(serialized.includes(secret), false);
  const otherSession = list.json.data.items.find((row: any) => !row.current);
  assert.equal(
    (
      await http(
        '/teacher/device-sessions/' + otherSession.sessionId + '/revoke',
        { token: teacherToken, method: 'POST', body: {} },
      )
    ).status,
    200,
  );
  assert.equal(
    (await http('/teacher/device-sessions', { token: second })).status,
    401,
  );
  assert.equal(
    (await http('/teacher/device-sessions', { token: teacherToken })).status,
    200,
  );
  const current = list.json.data.items.find((row: any) => row.current);
  assert.equal(
    (
      await http('/teacher/device-sessions/' + current.sessionId + '/revoke', {
        token: teacherToken,
        method: 'POST',
        body: {},
      })
    ).status,
    409,
  );
});

for (const change of [
  'revoke',
  'delete',
  'expiry',
  'disable',
  'role',
  'permission',
  'school',
  'branch',
] as const) {
  test(
    'INT-02: Principal staged domain/history rolls back after ' + change,
    async () => {
      const insert = PrincipalTask.collection.insertOne.bind(
        PrincipalTask.collection,
      );
      let staged = false;
      mock.method(
        PrincipalTask.collection,
        'insertOne',
        async (...args: any[]) => {
          const result = await (insert as any)(...args);
          staged = true;
          if (change === 'revoke') await nativeLogout(principalToken);
          if (change === 'delete')
            await sessions().deleteOne(sessionQuery(principalToken));
          if (change === 'expiry')
            await sessions().updateOne(sessionQuery(principalToken), {
              $set: { expiresAt: new Date(0) },
            });
          if (change === 'disable')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(principal) },
              { $set: { isActive: false } },
            );
          if (change === 'role')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(principal) },
              { $set: { role: 'teacher' } },
            );
          if (change === 'permission')
            ROLE_PERMISSIONS.principal = ROLE_PERMISSIONS.principal.filter(
              p => p !== PERMISSIONS.PRINCIPAL_TASKS_MANAGE,
            );
          if (change === 'school')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(principal) },
              { $set: { schoolId: schoolB } },
            );
          if (change === 'branch')
            await Branch.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(branchA) },
              { $set: { isActive: false } },
            );
          return result;
        },
      );
      const response = await taskWrite();
      assert.equal(staged, true);
      assert.equal(
        response.status,
        ['revoke', 'delete', 'expiry'].includes(change) ? 401 : 403,
      );
      await noSideEffects();
    },
  );
}

for (const change of [
  'revoke',
  'expiry',
  'disable',
  'role',
  'permission',
  'school',
  'branch',
] as const) {
  test(
    'INT-02: Teacher authority changed after HTTP authentication denies write: ' +
      change,
    async () => {
      const start = mongoose.startSession.bind(mongoose);
      let changed = false;
      mock.method(mongoose, 'startSession', async (...args: any[]) => {
        if (!changed) {
          changed = true;
          if (change === 'revoke') await nativeLogout(teacherToken);
          if (change === 'expiry')
            await sessions().updateOne(sessionQuery(teacherToken), {
              $set: { expiresAt: new Date(0) },
            });
          if (change === 'disable')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(own.teacherId) },
              { $set: { isActive: false } },
            );
          if (change === 'role')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(own.teacherId) },
              { $set: { role: 'student' } },
            );
          if (change === 'permission')
            ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
              p => p !== PERMISSIONS.TEACHER_NOTICES_MANAGE,
            );
          if (change === 'school')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(own.teacherId) },
              { $set: { schoolId: schoolB } },
            );
          if (change === 'branch')
            await Branch.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(branchA) },
              { $set: { isActive: false } },
            );
        }
        return (start as any)(...args);
      });
      assert.equal(
        (await noticeWrite()).status,
        ['revoke', 'expiry', 'disable', 'role'].includes(change) ? 401 : 403,
      );
      assert.equal(changed, true);
      await noSideEffects();
    },
  );
}

for (const change of ['permission', 'wall-clock-expiry'] as const) {
  test(
    'INT-02: Teacher final fence rolls back staged notice/history after ' +
      change,
    async () => {
      if (change === 'wall-clock-expiry')
        await sessions().updateOne(sessionQuery(teacherToken), {
          $set: { expiresAt: new Date(Date.now() + 1000) },
        });
      const insert = TeacherNotice.collection.insertOne.bind(
        TeacherNotice.collection,
      );
      let staged = false;
      mock.method(
        TeacherNotice.collection,
        'insertOne',
        async (...args: any[]) => {
          const result = await (insert as any)(...args);
          staged = true;
          if (change === 'permission')
            ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
              p => p !== PERMISSIONS.TEACHER_NOTICES_MANAGE,
            );
          else await new Promise(resolve => setTimeout(resolve, 1100));
          return result;
        },
      );
      assert.equal(
        (await noticeWrite()).status,
        change === 'permission' ? 403 : 401,
      );
      assert.equal(staged, true);
      await noSideEffects();
    },
  );
}

test('INT-02: exact accepted native row cannot be replaced by a same-hash second row', async () => {
  const context = await contextFor(admin, token, 'super_admin');
  const row = await sessions().findOne(sessionQuery(token));
  await nativeLogout(token);
  await sessions().insertOne({
    ...row!,
    _id: new mongoose.Types.ObjectId(),
    revokedAt: null,
  });
  await assert.rejects(
    revalidateAuthenticatedSession(context, identity()),
    (error: any) => error.status === 401,
  );
});

test('INT-02: forged context, actor substitution and raw integrated tokens fail closed', async () => {
  const context = await contextFor(admin, token, 'super_admin');
  for (const forged of [
    token,
    jwt,
    JSON.parse(JSON.stringify(context)),
    { ...context, userId: principal },
  ]) {
    await assert.rejects(
      revalidateAuthenticatedSession(forged, identity()),
      (error: any) => error.status === 401,
    );
  }
  await assert.rejects(
    revalidateAuthenticatedSession(context, {
      userId: principal,
      role: 'principal',
    }),
    (error: any) => error.status === 401,
  );
  assert.equal(
    (await http('/academic-setup/branches', { token: jwt })).status,
    401,
  );
});

test('INT-02: standalone JWT remains registered, revocable and isolated from opaque mode', async () => {
  const context = await contextFor(admin, token, 'super_admin');
  process.env.INTEGRATED_STAFF_ENABLED = 'false';
  try {
    const jwtContext = await jwtAuthContext(identity(), jwt);
    await writeSetup(
      identity(),
      jwtContext,
      'subjects',
      branchA,
      'create',
      undefined,
      { name: 'JWT owned subject' },
    );
    assert.equal(
      await Subject.countDocuments({ name: 'JWT owned subject' }),
      1,
    );
    assert.throws(
      () => sessionIdentity(context),
      (error: any) => error.status === 401,
    );
    assert.throws(
      () => sessionIdentity(token),
      (error: any) => error.status === 401,
    );
    await mongoose.connection
      .collection('sessions')
      .updateOne({ token: jwt }, { $set: { isRevoked: true } });
    await assert.rejects(
      writeSetup(
        identity(),
        jwtContext,
        'subjects',
        branchA,
        'create',
        undefined,
        { name: 'Denied JWT' },
      ),
      (error: any) => error.status === 401,
    );
    assert.equal(await Subject.countDocuments({ name: 'Denied JWT' }), 0);
  } finally {
    process.env.INTEGRATED_STAFF_ENABLED = 'true';
  }
});

test('INT-02: opaque reconciliation preserves foreign-ID concealment and Principal own Branch', async () => {
  assert.equal(
    (await http('/teacher-assignments/options?teacherId=' + other.teacherId))
      .status,
    404,
  );
  for (const id of [sibling, foreign])
    assert.equal(
      (
        await http('/academic-setup/classes?branchId=' + id, {
          token: principalToken,
        })
      ).status,
      404,
    );
});

test('INT-02: a valid actor transfer cannot repurpose an already accepted session context', async () => {
  const context = await contextFor(principal, principalToken, 'principal');
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(principal) },
    {
      $set: {
        schoolId: schoolB,
        branchId: new mongoose.Types.ObjectId(foreign),
      },
    },
  );
  const tx = await mongoose.startSession();
  try {
    await assert.rejects(
      authenticatedTransaction(tx, async () =>
        revalidateAuthenticatedSession(context, context, tx),
      ),
      (error: any) => error.status === 403,
    );
  } finally {
    await tx.endSession();
  }
});

test('INT-02: newly ambiguous legacy/public identity invalidates the accepted context', async () => {
  const context = await contextFor(admin, token, 'super_admin');
  await mongoose.connection.collection('users').insertOne({
    _id: new mongoose.Types.ObjectId(),
    id: admin,
    fullName: 'Ambiguous alias',
    email: 'ambiguous@test.invalid',
    role: 'teacher',
    isActive: true,
    schoolId: schoolA,
    branchId: new mongoose.Types.ObjectId(branchA),
  });
  await assert.rejects(
    revalidateAuthenticatedSession(context, identity()),
    (error: any) => error.status === 401,
  );
});

test('INT-02: standalone compatibility keeps exact Session identity across transaction retries', async () => {
  process.env.INTEGRATED_STAFF_ENABLED = 'false';
  const tx = await mongoose.startSession();
  const original = await mongoose.connection
    .collection('sessions')
    .findOne({ token: jwt });
  const abort = tx.abortTransaction.bind(tx);
  let replaced = false,
    attempts = 0;
  mock.method(tx, 'abortTransaction', async () => {
    await abort();
    if (!replaced) {
      replaced = true;
      await mongoose.connection
        .collection('sessions')
        .deleteOne({ _id: original!._id });
      await registerSession(admin, jwt, 'super_admin');
    }
  });
  try {
    await assert.rejects(
      authenticatedTransaction(tx, async () => {
        attempts++;
        await revalidateAuthenticatedSession(jwt, identity(), tx);
        if (attempts === 1) {
          const retry = new mongoose.mongo.MongoServerError({
            message: 'Owned retry fixture',
          });
          retry.addErrorLabel('TransientTransactionError');
          throw retry;
        }
        await Subject.create(
          [{ branchId: branchA, name: 'Must not replace accepted session' }],
          { session: tx },
        );
      }),
      (error: any) => error.status === 401,
    );
    assert.equal(replaced, true);
    assert.equal(attempts, 2);
    assert.equal(
      await Subject.countDocuments({
        name: 'Must not replace accepted session',
      }),
      0,
    );
  } finally {
    await tx.endSession();
    process.env.INTEGRATED_STAFF_ENABLED = 'true';
  }
});
