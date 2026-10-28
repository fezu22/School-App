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
import { writeSetup } from '../src/staff/src/services/academic-setup.service';
import { writeClassSubject } from '../src/staff/src/services/class-subject.service';
import { mutateEnrollment } from '../src/staff/src/services/student-enrollment.service';
import { provisionTeacher } from '../src/staff/src/services/teacher-provisioning.service';
import { getTeacherScope } from '../src/staff/src/services/teacher-scope.service';
import { Syllabus } from '../src/staff/src/models/syllabus';
import { manageSyllabus } from '../src/staff/src/services/syllabus.service';
import { AssignedWork } from '../src/staff/src/models/assignedWork';
import { manageAssignedWork } from '../src/staff/src/services/teacher-work.service';
import {createHash} from 'node:crypto';
import {opaqueAuthContext, type SessionAuthority} from '../src/staff/src/services/authenticated-session.service';
import {
  schoolBranchFilter,
  schoolUserFilter,
} from '../src/staff/src/services/school-authority.service';

// Both drivers connect ONLY to this suite's owned replica set. The integrated
// HTTP path uses real native login/session validation, not a fake req.user.
const native = require('../src/database');
const { hashPassword } = require('../src/auth');
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
  jwt: SessionAuthority;
const password = 'isolated-school-password-123';
const credentials = hashPassword(password);
const identity = () => ({ userId: admin, role: 'super_admin' as const });
const previousIntegration = process.env.INTEGRATED_STAFF_ENABLED;
const previousSecret = process.env.JWT_SECRET;

test('INT-01: unresolved integrated actors cannot produce global filters', () => {
  const actor = { _id: admin, role: 'super_admin', isActive: true };
  for (const filter of [schoolBranchFilter, schoolUserFilter]) {
    assert.throws(
      () => filter(actor),
      (error: any) => error.status === 403,
    );
  }
});

test('INT-01: branchless Teacher search conceals foreign names, IDs, and counts', async () => {
  const result = await http('/teacher-assignments/options?search=FOREIGN');
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.json).includes(other.teacherId), false);
  assert.equal(JSON.stringify(result.json).includes('FOREIGN'), false);
  assert.equal(result.json.data.teachers.total, 0);
});

before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri(), {
    dbName: 'int01_school_isolation',
    autoIndex: false,
  });
  await native.connectDatabase({
    MONGODB_URI: database.getUri(),
    MONGODB_DB: 'int01_school_isolation',
  });
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  process.env.JWT_SECRET = 'isolated-int01-jwt-fixture';
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
  // INT-02: these INT-01 positive service fixtures now use the same native
  // session as integrated HTTP, rather than the retired JWT workaround.
  jwt = await opaqueAuthContext(identity(), await mongoose.connection.collection('refreshTokens').findOne({tokenHash: createHash('sha256').update(token).digest('hex'), type: 'access'}));
});

after(async () => {
  mock.restoreAll();
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

test('INT-01: integrated opaque login branchless academic selector returns only its persisted school', async () => {
  const response = await http('/academic-setup/branches');
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.json.data.items.map((row: { id: string }) => row.id).sort(),
    [branchA, sibling].sort(),
  );
  assert.ok(!JSON.stringify(response.json).includes(foreign));
  assert.ok(!JSON.stringify(response.json).includes('Foreign campus'));
});

for (const path of [
  '/teacher-assignments/options',
  '/timetables/options',
  '/admin/teachers/branches',
  '/branches',
]) {
  test('INT-01: branchless selector is school-bounded: ' + path, async () => {
    const response = await http(path);
    assert.equal(response.status, 200);
    assert.ok(JSON.stringify(response.json).includes(branchA));
    assert.ok(!JSON.stringify(response.json).includes(foreign));
    assert.ok(!JSON.stringify(response.json).includes('Foreign campus'));
  });
}

for (const kind of [
  'periods',
  'classes',
  'sections',
  'subjects',
  'rooms',
] as const) {
  test(
    'INT-01: own ' + kind + ' reads and valid foreign ObjectId IDOR denial',
    async () => {
      const field = {
        periods: 'period',
        classes: 'classId',
        sections: 'sectionId',
        subjects: 'subjectId',
        rooms: 'roomId',
      }[kind] as keyof Catalog;
      const suffix = kind === 'sections' ? '&classId=' + own.classId : '';
      assert.equal(
        (await http(`/academic-setup/${kind}?branchId=${branchA}${suffix}`))
          .status,
        200,
      );
      const response = await http(
        `/academic-setup/${kind}/${other[field]}?branchId=${branchA}${suffix}`,
      );
      assert.equal(response.status, 404);
      assert.ok(!JSON.stringify(response.json).includes('FOREIGN'));
      assert.equal(
        (await http(`/academic-setup/${kind}?branchId=${foreign}`)).status,
        404,
      );
    },
  );
}

for (const path of [
  '/teacher-assignments/options',
  '/timetables/options',
  '/timetables/versions',
  '/staff-students',
  '/staff-students/enrollment-options',
]) {
  test(
    'INT-01: copied valid foreign Branch ID is rejected: ' + path,
    async () => {
      const response = await http(`${path}?branchId=${foreign}`);
      assert.equal(response.status, 404);
      assert.ok(!JSON.stringify(response.json).includes('FOREIGN'));
    },
  );
}

test('INT-01: foreign Teacher selector, history, assignment and ClassSubject IDs are concealed', async () => {
  for (const path of [
    `/teacher-assignments/options?teacherId=${other.teacherId}`,
    `/teacher-assignments/teachers/${other.teacherId}`,
    `/academic-setup/classes/${other.classId}/subjects?branchId=${branchA}`,
  ]) {
    assert.equal((await http(path)).status, 404);
  }
  assert.equal(
    (
      await http(`/teacher-assignments/${other.assignmentId}/revoke`, {
        method: 'PATCH',
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (await TeacherAssignment.findById(other.assignmentId))!.isActive,
    true,
  );
});

for (const state of [
  'missing',
  'invalid',
  'unresolved',
  'inactive',
  'suspended',
] as const) {
  test('INT-01: school authority fails closed: ' + state, async () => {
    if (state === 'missing')
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(admin) },
        { $unset: { schoolId: '' } },
      );
    if (state === 'invalid')
      await mongoose.connection
        .collection('users')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(admin) },
          { $set: { schoolId: 'not-a-school-id' } },
        );
    if (state === 'unresolved')
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(admin) },
        { $set: { schoolId: new mongoose.Types.ObjectId() } },
      );
    if (state === 'inactive')
      await mongoose.connection
        .collection('schools')
        .updateOne({ _id: schoolA }, { $set: { isActive: false } });
    if (state === 'suspended')
      await mongoose.connection
        .collection('schools')
        .updateOne({ _id: schoolA }, { $set: { status: 'suspended' } });
    const response = await http('/academic-setup/branches');
    assert.ok([403, 503].includes(response.status));
    assert.ok(!JSON.stringify(response.json).includes(branchA));
    assert.ok(!JSON.stringify(response.json).includes(foreign));
  });
}

test('INT-01: Principal retains own-Branch scope, not sibling or foreign-school scope', async () => {
  const response = await http('/academic-setup/branches', {
    token: principalToken,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.json.data.items.map((row: { id: string }) => row.id),
    [branchA],
  );
  for (const branch of [sibling, foreign])
    assert.equal(
      (
        await http(`/academic-setup/classes?branchId=${branch}`, {
          token: principalToken,
        })
      ).status,
      404,
    );
});

test('INT-01: Teacher keeps exact own assignment and forged foreign tuples confer no scope', async () => {
  assert.equal(
    (await getTeacherScope({ userId: own.teacherId, role: 'teacher' })).tuples
      .length,
    1,
  );
  await TeacherAssignment.collection.insertOne({
    teacherId: new mongoose.Types.ObjectId(own.teacherId),
    branchId: new mongoose.Types.ObjectId(branchA),
    classId: new mongoose.Types.ObjectId(other.classId),
    sectionId: new mongoose.Types.ObjectId(other.sectionId),
    subjectId: new mongoose.Types.ObjectId(other.subjectId),
    isActive: true,
    validFrom: new Date('2020-01-01'),
  });
  const scope = await getTeacherScope({
    userId: own.teacherId,
    role: 'teacher',
  });
  assert.equal(scope.tuples.length, 1);
  assert.equal(scope.tuples[0].classId, own.classId);
  assert.equal(
    (
      await http(
        `/teacher/classes/${other.classId}/sections/${other.sectionId}/subjects/${other.subjectId}`,
        { token: teacherToken },
      )
    ).status,
    404,
  );
});

test('INT-01: legacy Branch ownership can derive staff school; missing/inconsistent ownership cannot', async () => {
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(own.teacherId) },
    { $unset: { schoolId: '' } },
  );
  assert.equal(
    (await getTeacherScope({ userId: own.teacherId, role: 'teacher' })).tuples
      .length,
    1,
  );
  await Branch.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(branchA) },
    { $unset: { schoolId: '' } },
  );
  await assert.rejects(
    getTeacherScope({ userId: own.teacherId, role: 'teacher' }),
    (error: any) => error.status === 403,
  );
  await Branch.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(branchA) },
    { $set: { schoolId: schoolB } },
  );
  await assert.rejects(
    getTeacherScope({ userId: principal, role: 'principal' }),
    (error: any) => error.status === 403,
  );
});

test('INT-01: supplied school fields cannot forge selector or catalog authority', async () => {
  assert.equal(
    (await http(`/academic-setup/branches?schoolId=${schoolB}`)).status,
    400,
  );
  assert.equal(
    (
      await http(
        `/academic-setup/subjects?branchId=${branchA}&schoolId=${schoolB}`,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await http(`/academic-setup/subjects?branchId=${branchA}`, {
        method: 'POST',
        body: { name: 'Forged', schoolId: schoolB },
      })
    ).status,
    400,
  );
});

test('INT-01: own assignment creation succeeds; mixed-school Teacher/Class/Section/Subject writes fail', async () => {
  const body = {
    teacherId: own.teacherId,
    classId: own.classId,
    sectionId: own.sectionId,
    subjectId: own.subjectId,
    validFrom: '2020-01-01T00:00:00.000Z',
  };
  for (const field of [
    'teacherId',
    'classId',
    'sectionId',
    'subjectId',
  ] as const)
    assert.equal(
      (
        await http('/teacher-assignments', {
          method: 'POST',
          body: { ...body, [field]: other[field] },
        })
      ).status,
      404,
    );
  await TeacherAssignment.deleteOne({ _id: own.assignmentId });
  assert.equal(
    (await http('/teacher-assignments', { method: 'POST', body })).status,
    201,
  );
});

test('INT-01: Teacher and Principal provisioning cannot target a foreign Branch', async () => {
  const body = {
    fullName: 'New Staff',
    email: 'new-staff@test.invalid',
    password,
    branchId: foreign,
  };
  for (const path of ['/admin/teachers', '/admin/principals'])
    assert.equal((await http(path, { method: 'POST', body })).status, 404);
  assert.equal(await User.countDocuments({ email: body.email }), 0);
  assert.equal(
    (
      await http('/admin/principals', {
        method: 'POST',
        body: { ...body, branchId: branchA },
      })
    ).status,
    201,
  );
});

test('INT-01: own catalog writes use existing JWT fence; foreign Branch/references roll back', async () => {
  // Positive service writes deliberately retain the EXISTING JWT/Session fence.
  // Real integrated opaque writes still have INT-02; this test never bypasses it.
  const result = await writeSetup(
    identity(),
    jwt,
    'subjects',
    branchA,
    'create',
    undefined,
    { name: 'New owned subject' },
  );
  assert.ok(result);
  await assert.rejects(
    writeSetup(identity(), jwt, 'subjects', foreign, 'create', undefined, {
      name: 'Forbidden',
    }),
    (error: any) => error.status === 404,
  );
  await assert.rejects(
    writeSetup(identity(), jwt, 'sections', branchA, 'create', undefined, {
      name: 'Forbidden',
      code: 'BAD',
      classId: other.classId,
    }),
    (error: any) => error.status === 404,
  );
  await assert.rejects(
    writeSetup(identity(), jwt, 'classes', branchA, 'create', undefined, {
      name: 'Forbidden',
      code: 'BAD',
      academicPeriodId: other.period,
    }),
    (error: any) => error.status === 404,
  );
  await assert.rejects(
    writeClassSubject(
      identity(),
      jwt,
      own.classId,
      { branchId: branchA },
      'create',
      undefined,
      { subjectId: other.subjectId },
    ),
    (error: any) => error.status === 404,
  );
  assert.equal(await Section.countDocuments({ name: 'Forbidden' }), 0);
});

test('INT-01: own Teacher provisioning preserves school and foreign provisioning fails at scope', async () => {
  const body = {
    fullName: 'Provisioned Teacher',
    email: 'created-teacher@test.invalid',
    password,
    branchId: branchA,
  };
  const result = await provisionTeacher(admin, jwt, body);
  assert.equal(
    (await User.findById(result.id))!.schoolId?.toString(),
    String(schoolA),
  );
  await assert.rejects(
    provisionTeacher(admin, jwt, {
      ...body,
      email: 'foreign-created@test.invalid',
      branchId: foreign,
    }),
    (error: any) => error.status === 404,
  );
});

test('INT-01: timetable creation rejects foreign Teacher/Class/Room while own scope succeeds', async () => {
  const slot = {
    teacherId: own.teacherId,
    classId: own.classId,
    sectionId: own.sectionId,
    subjectId: own.subjectId,
    roomId: own.roomId,
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
  };
  const body = {
    branchId: branchA,
    versionNumber: 1,
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-12-01',
    periods: [slot],
  };
  for (const field of [
    'teacherId',
    'classId',
    'sectionId',
    'subjectId',
    'roomId',
  ] as const) {
    const response = await http('/timetables/versions', {
      method: 'POST',
      body: { ...body, periods: [{ ...slot, [field]: other[field] }] },
    });
    assert.equal(response.status, 404);
  }
  assert.equal(
    (await http('/timetables/versions', { method: 'POST', body })).status,
    201,
  );
});

test('INT-01: enrollment mutation rejects foreign Branch and mixed Class/Section, allows own enrollment', async () => {
  const body = {
    academicPeriodId: own.period,
    classId: own.classId,
    sectionId: own.sectionId,
    operationId: 'int01_enrollment_operation_01',
    reason: 'Owned enrollment fixture',
  };
  for (const field of ['academicPeriodId', 'classId', 'sectionId'] as const) {
    const target = field === 'academicPeriodId' ? other.period : other[field];
    await assert.rejects(
      mutateEnrollment(
        identity(),
        jwt,
        own.studentId,
        undefined,
        'enroll',
        { branchId: branchA },
        { ...body, [field]: target },
      ),
      (error: any) => error.status === 404,
    );
  }
  await assert.rejects(
    mutateEnrollment(
      identity(),
      jwt,
      own.studentId,
      undefined,
      'enroll',
      { branchId: foreign },
      body,
    ),
    (error: any) => error.status === 404,
  );
  assert.ok(
    await mutateEnrollment(
      identity(),
      jwt,
      own.studentId,
      undefined,
      'enroll',
      { branchId: branchA },
      body,
    ),
  );
});

for (const change of [
  'actor-school',
  'school-active',
  'branch-school',
] as const) {
  test(
    'INT-01: stale initial authority cannot commit after ' +
      change +
      ' changes',
    async () => {
      const original = mongoose.startSession.bind(mongoose);
      let changed = false;
      mock.method(mongoose, 'startSession', async (...args: any[]) => {
        if (!changed) {
          changed = true;
          if (change === 'actor-school')
            await User.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(admin) },
              { $set: { schoolId: schoolB } },
            );
          if (change === 'school-active')
            await mongoose.connection
              .collection('schools')
              .updateOne({ _id: schoolA }, { $set: { isActive: false } });
          if (change === 'branch-school')
            await Branch.collection.updateOne(
              { _id: new mongoose.Types.ObjectId(branchA) },
              { $set: { schoolId: schoolB } },
            );
        }
        return original(...args);
      });
      await assert.rejects(
        writeSetup(identity(), jwt, 'subjects', branchA, 'create', undefined, {
          name: 'Must roll back',
        }),
        (error: any) => [403, 404].includes(error.status),
      );
      assert.equal(await Subject.countDocuments({ name: 'Must roll back' }), 0);
    },
  );
}

test('INT-01: Branch selector index uses the existing ownership chain', async () => {
  const plan = await Branch.collection.find({ schoolId: schoolA, isActive: true })
    .sort({ name: 1, _id: 1 })
    .hint('school_active_branch_options')
    .explain('executionStats');
  assert.equal(plan.executionStats.nReturned, 2);
  assert.equal(plan.executionStats.totalDocsExamined, 2);
});

for (const kind of [
  'periods',
  'classes',
  'sections',
  'subjects',
  'rooms',
] as const) {
  test(
    'INT-01: ' + kind + ' creation is allowed only in the authorized Branch',
    async () => {
      const body =
        kind === 'periods'
          ? {
              name: 'Next year',
              code: 'NEXT',
              startDate: '2031-01-01',
              endDate: '2032-01-01',
            }
          : kind === 'classes'
          ? {
              name: 'Owned new class',
              code: 'NEW',
              academicPeriodId: own.period,
            }
          : kind === 'sections'
          ? { name: 'Owned new section', code: 'NEW', classId: own.classId }
          : kind === 'rooms'
          ? { name: 'Owned new room', code: 'NEW', category: 'classroom' }
          : { name: 'Owned new subject' };
      assert.ok(
        await writeSetup(
          identity(),
          jwt,
          kind,
          branchA,
          'create',
          undefined,
          body,
        ),
      );
      await assert.rejects(
        writeSetup(identity(), jwt, kind, foreign, 'create', undefined, body),
        (error: any) => error.status === 404,
      );
    },
  );
}

test('INT-01: catalog updates cannot move ownership or modify foreign valid IDs', async () => {
  assert.equal(
    (
      await http(
        `/academic-setup/subjects/${own.subjectId}?branchId=${branchA}`,
        {
          method: 'PATCH',
          body: { name: 'Moved', revision: 1, branchId: foreign },
        },
      )
    ).status,
    400,
  );
  await assert.rejects(
    writeSetup(identity(), jwt, 'subjects', foreign, 'update', own.subjectId, {
      name: 'Moved',
      revision: 1,
    }),
    (error: any) => error.status === 404,
  );
  await assert.rejects(
    writeSetup(
      identity(),
      jwt,
      'subjects',
      branchA,
      'update',
      other.subjectId,
      { name: 'Moved', revision: 1 },
    ),
    (error: any) => error.status === 404,
  );
  await writeSetup(
    identity(),
    jwt,
    'subjects',
    branchA,
    'update',
    own.subjectId,
    { name: 'Updated own subject', revision: 1 },
  );
  assert.equal(
    (await Subject.findById(other.subjectId))!.name,
    'FOREIGN subject',
  );
});

test('INT-01: own ClassSubject writes and Principal own-Branch mutations remain valid', async () => {
  const subject = await Subject.create({
    branchId: branchA,
    name: 'New curriculum subject',
  });
  assert.ok(
    await writeClassSubject(
      identity(),
      jwt,
      own.classId,
      { branchId: branchA },
      'create',
      undefined,
      { subjectId: String(subject._id) },
    ),
  );
  const actor = { userId: principal, role: 'principal' as const };
  const principalJwt = await opaqueAuthContext(actor, await mongoose.connection.collection('refreshTokens').findOne({tokenHash: createHash('sha256').update(principalToken).digest('hex'), type: 'access'}));
  assert.ok(
    await writeSetup(
      actor,
      principalJwt,
      'subjects',
      branchA,
      'create',
      undefined,
      { name: 'Principal owned subject' },
    ),
  );
  for (const branch of [sibling, foreign])
    await assert.rejects(
      writeSetup(actor, principalJwt, 'subjects', branch, 'create', undefined, {
        name: 'Forbidden Principal subject',
      }),
      (error: any) => error.status === 404,
    );
});

test('INT-01: valid foreign timetable version and substitute IDs cannot be approved or retired', async () => {
  const version = await TimetableVersion.create({
    branchId: foreign,
    versionNumber: 1,
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-12-01',
    periodCount: 1,
    createdBy: admin,
  });
  const period = await TimetablePeriod.create({
    branchId: foreign,
    timetableVersionId: version._id,
    teacherId: other.teacherId,
    classId: other.classId,
    sectionId: other.sectionId,
    subjectId: other.subjectId,
    roomId: other.roomId,
    room: 'Foreign room',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
  });
  const substitute = await SubstituteAssignment.create({
    branchId: foreign,
    periodId: period._id,
    originalTeacherId: other.teacherId,
    substituteTeacherId: other.teacherId,
    date: '2026-10-26',
    startTime: '09:00',
    endTime: '10:00',
    room: 'Foreign room',
    roomId: other.roomId,
    createdBy: admin,
  });
  for (const action of ['approve', 'retire']) {
    assert.equal(
      (
        await http(`/timetables/versions/${version._id}/${action}`, {
          method: 'POST',
          body: {},
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await http(`/timetables/substitutes/${substitute._id}/${action}`, {
          method: 'POST',
          body: {},
        })
      ).status,
      404,
    );
  }
  assert.equal((await TimetableVersion.findById(version._id))!.status, 'draft');
});

test('INT-01: foreign student IDs and foreign academic-period/Class selectors are concealed', async () => {
  for (const path of [
    `/staff-students/${other.studentId}/enrollments?branchId=${branchA}`,
    `/academic-setup/classes?branchId=${branchA}&academicPeriodId=${other.period}`,
    `/academic-setup/sections?branchId=${branchA}&classId=${other.classId}`,
    `/teacher-assignments/options?branchId=${branchA}&classId=${other.classId}`,
  ])
    assert.equal((await http(path)).status, 404);
});

test('INT-01: inactive/missing-owned Branches and inconsistent Teacher ownership fail closed', async () => {
  await Branch.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(branchA) },
    { $set: { isActive: false } },
  );
  assert.equal(
    (await http(`/academic-setup/classes?branchId=${branchA}`)).status,
    404,
  );
  await Branch.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(branchA) },
    { $set: { isActive: true } },
  );
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(own.teacherId) },
    { $set: { schoolId: schoolB } },
  );
  assert.equal(
    (await http(`/teacher-assignments/options?teacherId=${own.teacherId}`))
      .status,
    404,
  );
  await assert.rejects(
    getTeacherScope({ userId: own.teacherId, role: 'teacher' }),
    (error: any) => error.status === 403,
  );
});

test('INT-01: role or cached identity cannot confer platform-wide school authority', async () => {
  await mongoose.connection
    .collection('users')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(admin) },
      { $set: { role: 'ultra_admin' } },
    );
  assert.equal((await http('/academic-setup/branches')).status, 403);
});

test('INT-01: direct syllabus IDs are school-bounded, including legacy global admin paths', async () => {
  const row = await Syllabus.create({
    branchId: foreign,
    classId: other.classId,
    subjectId: other.subjectId,
    academicYear: 'YEAR',
    title: 'Foreign private syllabus',
    version: 1,
    units: [],
    createdBy: admin,
    updatedBy: admin,
  });
  const response = await http(`/syllabuses/${row._id}`);
  assert.equal(response.status, 404);
  assert.ok(!JSON.stringify(response.json).includes(row.title));
  const body = {
    classId: other.classId,
    subjectId: other.subjectId,
    version: 2,
    title: 'Unauthorized',
    units: [{ title: 'Unit', topics: [{ title: 'Topic', outcomes: [] }] }],
  };
  assert.equal(
    (await http('/syllabuses', { method: 'POST', body })).status,
    404,
  );
});

test('INT-01: assigned academic work cannot be created for another school Teacher', async () => {
  await assert.rejects(
    manageAssignedWork(identity(), jwt, {
      assigneeUserId: other.teacherId,
      sourceType: 'coordinator_follow_up',
      title: 'Foreign task',
      summary: 'Not authorized',
    }),
    (error: any) => error.status === 404,
  );
});

test('INT-01: own syllabus/work writes remain valid and foreign work cancellation is concealed', async () => {
  const syllabus = await manageSyllabus(identity(), jwt, 'create', undefined, {
    classId: own.classId,
    subjectId: own.subjectId,
    version: 1,
    title: 'Owned syllabus',
    units: [
      { title: 'Owned unit', topics: [{ title: 'Owned topic', outcomes: [] }] },
    ],
  });
  assert.equal((await http(`/syllabuses/${syllabus.syllabusId}`)).status, 200);
  assert.ok(
    await manageAssignedWork(identity(), jwt, {
      assigneeUserId: own.teacherId,
      sourceType: 'coordinator_follow_up',
      title: 'Owned task',
      summary: 'Authorized school task',
    }),
  );
  const foreignWork = await AssignedWork.create({
    branchId: foreign,
    assigneeUserId: other.teacherId,
    sourceType: 'coordinator_follow_up',
    title: 'Foreign task',
    summary: 'Other school',
    assignedBy: admin,
  });
  await assert.rejects(
    manageAssignedWork(identity(), jwt, {}, String(foreignWork._id)),
    (error: any) => error.status === 404,
  );
  assert.equal(
    (
      await http(`/assigned-work/${foreignWork._id}/cancel`, {
        method: 'POST',
        body: {},
      })
    ).status,
    404,
  );
  assert.equal((await AssignedWork.findById(foreignWork._id))!.status, 'open');
});

test('INT-01: inconsistent Student school mapping is excluded from enrollment administration', async () => {
  const student = await Student.findById(own.studentId);
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(student!.userId)) },
    { $set: { schoolId: schoolB } },
  );
  const list = await http(`/staff-students?branchId=${branchA}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.data.total, 0);
  assert.equal(
    (
      await http(
        `/staff-students/${own.studentId}/enrollments?branchId=${branchA}`,
      )
    ).status,
    404,
  );
});

test('INT-01: substitute Teacher with inconsistent school ownership cannot be scheduled', async () => {
  const version = await TimetableVersion.create({
    branchId: branchA,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-12-01',
    periodCount: 1,
    createdBy: admin,
  });
  const period = await TimetablePeriod.create({
    branchId: branchA,
    timetableVersionId: version._id,
    teacherId: own.teacherId,
    classId: own.classId,
    sectionId: own.sectionId,
    subjectId: own.subjectId,
    roomId: own.roomId,
    room: 'Own room',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
  });
  await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(other.teacherId) },
    { $set: { branchId: new mongoose.Types.ObjectId(branchA) } },
  );
  const result = await http('/timetables/substitutes', {
    method: 'POST',
    body: {
      periodId: String(period._id),
      substituteTeacherId: other.teacherId,
      date: '2026-10-26',
      startTime: '09:00',
      endTime: '10:00',
      roomId: own.roomId,
    },
  });
  assert.equal(result.status, 404);
  assert.equal(await SubstituteAssignment.countDocuments({}), 0);
});
