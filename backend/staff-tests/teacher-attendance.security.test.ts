import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { request as nodeRequest, type Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, { type UserRole } from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Room from '../src/staff/src/models/room';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import Session from '../src/staff/src/models/session';
import Student from '../src/staff/src/models/student';
import LegacyAttendance from '../src/staff/src/models/attendance';
import { getBranchAttendanceSummary } from '../src/staff/src/services/attendance.service';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
  AttendanceOperation,
  ensureAttendanceIndexes,
} from '../src/staff/src/models/periodAttendance';
import { createStudent } from '../src/staff/src/services/student.service';
import type { AttendanceDetail } from '../../src/staff/services/teacher/attendanceService';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import type { TeacherAssignmentTuple } from '../src/staff/src/services/teacher-scope.service';
import {
  ensureTimetableIndexes,
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  TimetableIssue,
} from '../src/staff/src/models/timetable';

// Only an owned ephemeral MongoDB is used; never import dotenv/config or read
// MONGODB_URI. Real indexes are enabled and exercised by concurrent HTTP writes.
type Id = mongoose.Types.ObjectId;
type Actor = { id: Id; token: string; role: UserRole };
type Mutation = { assignmentId: string; isActive: boolean };
const secret = 'isolated-teacher-security-test-secret';
const previousSecret = process.env.JWT_SECRET;
const permissionSnapshot = Object.fromEntries(
  Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => [
    role,
    [...permissions],
  ]),
);
let database: MongoMemoryReplSet, server: Server, base: string;
let branchA: Id, branchB: Id;
let ownRoom: string, substituteRoom: string, foreignRoom: string;
let teacherA: Actor, teacherB: Actor, foreignTeacher: Actor, principal: Actor;
let class8: Id, class9: Id, class10: Id, foreignClass: Id;
let section8A: Id,
  section8B: Id,
  section9B: Id,
  section10A: Id,
  foreignSection: Id;
let math: Id, physics: Id, foreignSubject: Id;
const past = () => new Date(Date.now() - 86400000).toISOString();

before(async () => {
  process.env.JWT_SECRET = secret;
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri(), {
    dbName: 'teacher_scope_tests',
    autoIndex: false,
  });
  await Promise.all([
    ensureTimetableIndexes(),
    ensureAttendanceIndexes(),
    Subject.createIndexes(),
    TeacherAssignment.createIndexes(),
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

const actor = async (
  name: string,
  role: UserRole,
  branchId?: Id,
): Promise<Actor> => {
  const user = await new User({
    fullName: name,
    email: `${name}@test.invalid`,
    password: 'private-password-hash',
    role,
    branchId,
  }).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return { id: user._id, token, role };
};

const http = async <T = TeacherAssignmentTuple[]>(
  path: string,
  person: Actor | undefined,
  method = 'GET',
  body?: unknown,
) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{
    status: number;
    data: T;
    message: string;
    raw: string;
    cache: string | string[] | undefined;
  }>((resolve, reject) => {
    const req = nodeRequest(
      `${base}${path}`,
      {
        method,
        headers: {
          ...(person ? { Authorization: `Bearer ${person.token}` } : {}),
          ...(payload === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }),
        },
      },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw) as { data: T; message: string };
            resolve({
              status: res.statusCode!,
              data: parsed.data,
              message: parsed.message,
              raw,
              cache: res.headers['cache-control'],
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
};
const input = (extra: Record<string, unknown> = {}) => ({
  teacherId: String(teacherA.id),
  classId: String(class8),
  sectionId: String(section8A),
  subjectId: String(math),
  validFrom: past(),
  ...extra,
});
const create = (
  extra: Record<string, unknown> = {},
  person: Actor | undefined = principal,
) => http<Mutation>('/teacher-assignments', person, 'POST', input(extra));
const originalTimezone = process.env.SCHOOL_TIMEZONE;
afterEach(() => {
  mock.timers.reset();
  if (originalTimezone === undefined) delete process.env.SCHOOL_TIMEZONE;
  else process.env.SCHOOL_TIMEZONE = originalTimezone;
});
beforeEach(async () => {
  process.env.SCHOOL_TIMEZONE = 'Asia/Karachi';
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T06:00:00Z') });
  mock.restoreAll();
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[])
    ROLE_PERMISSIONS[role] = [...permissionSnapshot[role]];
  for (const model of [
    AttendanceSession,
    PeriodAttendanceRecord,
    AttendanceOperation,
    TimetableIssue,
    SubstituteAssignment,
    TimetablePeriod,
    TimetableVersion,
    Student,
    TeacherAssignment,
    Subject,
    Section,
    SchoolClass,
    Session,
    User,
    Room,
    Branch,
  ])
    await model.collection.deleteMany({});
  branchA = (
    await Branch.create({
      name: 'Branch A',
      code: 'AA',
      address: 'private address',
      city: 'A',
    })
  )._id;
  branchB = (
    await Branch.create({
      name: 'Branch B',
      code: 'BB',
      address: 'foreign private address',
      city: 'B',
    })
  )._id;
  teacherA = await actor('teacher-a', 'teacher', branchA);
  teacherB = await actor('teacher-b', 'teacher', branchA);
  foreignTeacher = await actor('foreign-teacher', 'teacher', branchB);
  principal = await actor('principal', 'principal', branchA);
  ownRoom = String((await Room.create({branchId: branchA, name: 'Room 8', code: 'R8', createdBy: principal.id, updatedBy: principal.id}))._id);
  substituteRoom = String((await Room.create({branchId: branchA, name: 'Approved revised room', code: 'SUB', createdBy: principal.id, updatedBy: principal.id}))._id);
  foreignRoom = String((await Room.create({branchId: branchB, name: 'Room 8', code: 'R8', createdBy: foreignTeacher.id, updatedBy: foreignTeacher.id}))._id);
  const schoolClass = async (name: string, code: string, branchId = branchA) =>
    (
      await new SchoolClass({
        branchId,
        name,
        code,
        academicYear: '2026',
      }).save()
    )._id;
  class8 = await schoolClass('Class 8', '8');
  class9 = await schoolClass('Class 9', '9');
  class10 = await schoolClass('Class 10', '10');
  foreignClass = await schoolClass('Foreign class', 'F', branchB);
  const section = async (classId: Id, name: string, branchId = branchA) =>
    (await new Section({ classId, branchId, name, code: name }).save())._id;
  section8A = await section(class8, 'A');
  section8B = await section(class8, 'B');
  section9B = await section(class9, 'B');
  section10A = await section(class10, 'A');
  foreignSection = await section(foreignClass, 'F', branchB);
  math = (await Subject.create({ branchId: branchA, name: 'Mathematics' }))._id;
  physics = (await Subject.create({ branchId: branchA, name: 'Physics' }))._id;
  foreignSubject = (
    await Subject.create({ branchId: branchB, name: 'Mathematics' })
  )._id;
  await seedCurriculumFixtures();
  const first = await create();
  assert.equal(first.status, 201);
  const second = await create({
    classId: String(class9),
    sectionId: String(section9B),
    subjectId: String(physics),
  });
  assert.equal(second.status, 201);
  assert.equal((await create({ teacherId: String(teacherB.id) })).status, 201); // shared tuple is legitimate
  assert.equal(
    (
      await create({
        teacherId: String(teacherB.id),
        classId: String(class10),
        sectionId: String(section10A),
      })
    ).status,
    201,
  );
});

after(async () => {
  mock.restoreAll();
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[])
    ROLE_PERMISSIONS[role] = [...permissionSnapshot[role]];
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  await mongoose.disconnect();
  if (database) await database.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const nowDate = '2026-10-13';
const slot = (extra: Record<string, unknown> = {}) => ({
  teacherId: String(teacherA.id),
  classId: String(class8),
  sectionId: String(section8A),
  subjectId: String(math),
  dayOfWeek: 2,
  startTime: '09:00',
  endTime: '09:40',
  roomId: String(extra.teacherId) === String(foreignTeacher.id) ? foreignRoom : ownRoom,
  ...extra,
});
type Provision = { versionId: string; status: string };
type SubstituteResult = { substituteId: string; status: string };
const version = (extra: Record<string, unknown> = {}, person = principal) =>
  http<Provision>('/timetables/versions', person, 'POST', {
    versionNumber: 1,
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-11-01',
    periods: [slot()],
    ...extra,
  });
const approve = (id: string, person = principal) =>
  http<Provision>(`/timetables/versions/${id}/approve`, person, 'POST', {});
let versionId: string, periodId: string;
beforeEach(async () => {
  const created = await version();
  assert.equal(created.status, 201);
  versionId = created.data.versionId;
  assert.equal((await approve(versionId)).status, 200);
  const row = await TimetablePeriod.findOne({ timetableVersionId: versionId });
  assert.ok(row);
  periodId = String(row._id);
});
const replacement = async (
  extra: Record<string, unknown> = {},
  approved = true,
) => {
  const created = await http<SubstituteResult>(
    '/timetables/substitutes',
    principal,
    'POST',
    {
      periodId,
      substituteTeacherId: String(teacherB.id),
      date: nowDate,
      startTime: '10:00',
      endTime: '10:45',
      roomId: substituteRoom,
      ...extra,
    },
  );
  assert.equal(created.status, 201);
  if (approved)
    assert.equal(
      (
        await http(
          `/timetables/substitutes/${created.data.substituteId}/approve`,
          principal,
          'POST',
          {},
        )
      ).status,
      200,
    );
  return created.data.substituteId;
};

let learnerIds: string[];
beforeEach(async () => {
  learnerIds = [];
  for (let index = 0; index < 3; index++) {
    const learner = await actor(`learner-${index}`, 'student', branchA);
    const row = await new Student({
      userId: learner.id,
      branchId: branchA,
      classId: class8,
      sectionId: section8A,
      admissionNumber: `A${index}`,
      guardianName: 'PRIVATE GUARDIAN',
      address: 'PRIVATE ADDRESS',
    }).save();
    learnerIds.push(String(row._id));
  }
});
const pending = (person = teacherA, query = '') =>
  http<{ total: number; sessions: unknown[] }>(
    '/teacher/attendance/pending' + query,
    person,
  );
const open = (person = teacherA, id = periodId, date = nowDate) =>
  http<AttendanceDetail>(
    `/teacher/attendance/occurrences/${id}?date=${date}`,
    person,
  );
const sessionDetail = (id: string, person = teacherA) =>
  http<AttendanceDetail>(`/teacher/attendance/sessions/${id}`, person);
const bodyFor = (
  session: AttendanceDetail,
  extra: Record<string, unknown> = {},
) => ({
  revision: session.revision,
  rosterVersion: session.rosterVersion,
  clientOperationId: 'attendance_operation_0001',
  marks: session.students.map(s => ({
    studentId: s.studentId,
    status: 'present',
  })),
  ...extra,
});
const write = (
  session: AttendanceDetail,
  body = bodyFor(session),
  action = 'submit',
  person = teacherA,
) =>
  http<{ revision: number; state: string; replayed: boolean }>(
    `/teacher/attendance/sessions/${session.sessionId}/${action}`,
    person,
    'POST',
    body,
  );
const noWrite = async (id: string) => {
  assert.equal(
    await PeriodAttendanceRecord.countDocuments({ attendanceSessionId: id }),
    0,
  );
  assert.equal(
    await AttendanceOperation.countDocuments({ attendanceSessionId: id }),
    0,
  );
  assert.equal((await AttendanceSession.findById(id))!.revision, 0);
};
test('opening a session creates no marks and returns exact private-safe roster keys', async () => {
  const result = await open();
  assert.equal(result.status, 200, result.message);
  assert.equal(result.cache, 'no-store');
  assert.equal(result.data.state, 'open');
  assert.equal(result.data.students.length, 3);
  for (const row of result.data.students) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['studentId', 'fullName', 'admissionNumber', 'status'].sort(),
    );
    assert.equal(row.status, null);
  }
  for (const privateField of [
    'guardian',
    'password',
    'address',
    '__v',
    'fingerprint',
    'userId',
  ])
    assert.equal(result.raw.includes(privateField), false);
  await noWrite(result.data.sessionId);
});
test('concurrent lazy opening resolves exactly one concrete occurrence session', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => open()));
  results.forEach(r => assert.equal(r.status, 200, r.message));
  assert.equal(new Set(results.map(r => r.data.sessionId)).size, 1);
  assert.equal(await AttendanceSession.countDocuments(), 1);
});
test('same weekly definition on another date has a different session identity', async () => {
  const today = await open();
  const earlier = await open(teacherA, periodId, '2026-10-06');
  assert.equal(earlier.status, 200);
  assert.notEqual(today.data.sessionId, earlier.data.sessionId);
});
test('pending queue is workflow only and performs no attendance writes', async () => {
  assert.equal((await pending()).data.total, 1);
  assert.equal(await AttendanceSession.countDocuments(), 0);
  const session = (await open()).data;
  await write(
    session,
    bodyFor(session, {
      marks: session.students.map(s => ({
        studentId: s.studentId,
        status: 'absent',
      })),
    }),
  );
  assert.equal((await pending()).data.total, 0);
  assert.equal(
    await PeriodAttendanceRecord.countDocuments({ status: 'absent' }),
    3,
  );
});
test('partial draft retains all missing marks as unmarked; retry never manufactures absences', async () => {
  const session = (await open()).data;
  const body = bodyFor(session, {
    marks: session.students.map((s, i) => ({
      studentId: s.studentId,
      status: i === 0 ? 'late' : null,
    })),
  });
  assert.equal((await write(session, body, 'draft')).status, 200);
  assert.equal((await write(session, body, 'draft')).status, 200);
  const latest = await sessionDetail(session.sessionId);
  assert.deepEqual(
    latest.data.students.map(s => s.status),
    ['late', null, null],
  );
  assert.equal(await PeriodAttendanceRecord.countDocuments(), 1);
  assert.equal(
    await PeriodAttendanceRecord.countDocuments({ status: 'absent' }),
    0,
  );
});
test('incomplete submit rejects without records or audit or automatic absences', async () => {
  const session = (await open()).data;
  const result = await write(
    session,
    bodyFor(session, {
      marks: session.students.map(s => ({
        studentId: s.studentId,
        status: null,
      })),
    }),
  );
  assert.equal(result.status, 400);
  await noWrite(session.sessionId);
});
test('draft can explicitly clear a mark; unmarked is represented by no record', async () => {
  const session = (await open()).data;
  assert.equal((await write(session, bodyFor(session), 'draft')).status, 200);
  const latest = (await sessionDetail(session.sessionId)).data;
  const body = bodyFor(latest, {
    clientOperationId: 'clear_operation_0001',
    marks: latest.students.map(s => ({ studentId: s.studentId, status: null })),
  });
  assert.equal((await write(latest, body, 'draft')).status, 200);
  assert.equal(await PeriodAttendanceRecord.countDocuments(), 0);
});
test('complete explicit finalization is immutable and replay-safe', async () => {
  const session = (await open()).data,
    body = bodyFor(session);
  const first = await write(session, body);
  const again = await write(session, body);
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(again.data.replayed, true);
  assert.equal(await AttendanceOperation.countDocuments(), 1);
  assert.equal(await PeriodAttendanceRecord.countDocuments(), 3);
  assert.equal(
    (
      await write(session, {
        ...body,
        clientOperationId: 'second_operation_0001',
      })
    ).status,
    409,
  );
});
test('concurrent same-key submits persist one transition and audit', async () => {
  const session = (await open()).data;
  const results = await Promise.all(
    Array.from({ length: 4 }, () => write(session)),
  );
  results.forEach(r => assert.equal(r.status, 200, r.message));
  assert.equal(await AttendanceOperation.countDocuments(), 1);
  assert.equal(
    (await AttendanceSession.findById(session.sessionId))!.revision,
    1,
  );
});
test('concurrent distinct submissions have one winner and a truthful conflict', async () => {
  const session = (await open()).data;
  const results = await Promise.all([
    write(session),
    write(
      session,
      bodyFor(session, { clientOperationId: 'different_operation_01' }),
    ),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await AttendanceOperation.countDocuments(), 1);
});
test('changed payload under reused operation ID conflicts', async () => {
  const session = (await open()).data;
  await write(session, bodyFor(session), 'draft');
  assert.equal(
    (
      await write(
        session,
        bodyFor(session, {
          marks: session.students.map(s => ({
            studentId: s.studentId,
            status: 'leave',
          })),
        }),
        'draft',
      )
    ).status,
    409,
  );
});
test('later intentional draft uses new revision and operation identity', async () => {
  const session = (await open()).data;
  await write(session, bodyFor(session), 'draft');
  const latest = (await sessionDetail(session.sessionId)).data;
  assert.equal(
    (
      await write(
        latest,
        bodyFor(latest, { clientOperationId: 'new_draft_operation_01' }),
        'draft',
      )
    ).status,
    200,
  );
  assert.equal(await AttendanceOperation.countDocuments(), 2);
});
test('another Teacher in the same assigned tuple cannot access original responsibility', async () => {
  assert.equal((await open(teacherB)).status, 404);
  assert.equal((await pending(teacherB)).data.total, 0);
});
test('foreign Teacher and guessed session IDs are concealed', async () => {
  const session = (await open()).data;
  assert.equal(
    (await sessionDetail(session.sessionId, foreignTeacher)).status,
    404,
  );
  assert.equal(
    (await sessionDetail(String(new mongoose.Types.ObjectId()))).status,
    404,
  );
});
test('existing same-branch other-class and foreign student IDs cannot be injected', async () => {
  const session = (await open()).data;
  for (const foreign of [false, true]) {
    const outside = await actor(
      foreign ? 'foreign-learner' : 'other-class-learner',
      'student',
      foreign ? branchB : branchA,
    );
    const enrolled = await new Student({
      userId: outside.id,
      branchId: foreign ? branchB : branchA,
      classId: foreign ? foreignClass : class9,
      sectionId: foreign ? foreignSection : section9B,
      admissionNumber: 'OUTSIDE',
    }).save();
    const marks = bodyFor(session).marks;
    marks[0].studentId = String(enrolled._id);
    assert.equal(
      (await write(session, bodyFor(session, { marks }))).status,
      404,
    );
  }
  await noWrite(session.sessionId);
});
test('substitute authority is occurrence-specific and does not grant general roster access', async () => {
  await TeacherAssignment.updateMany(
    { teacherId: teacherB.id },
    { $set: { isActive: false } },
  );
  await replacement();
  const sub = await open(teacherB);
  assert.equal(sub.status, 200, sub.message);
  assert.equal(sub.data.period.room, 'Approved revised room');
  assert.equal((await open()).status, 404);
  assert.equal((await open(teacherB, periodId, '2026-10-06')).status, 404);
  assert.equal(
    (
      await http(
        `/teacher/classes/${class8}/sections/${section8A}/subjects/${math}/students`,
        teacherB,
      )
    ).status,
    404,
  );
  assert.equal(
    (await write(sub.data, bodyFor(sub.data), 'submit', teacherB)).status,
    200,
  );
});
test('roster movement creates review conflict without changing attendance', async () => {
  const session = (await open()).data;
  await Student.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(learnerIds[0]) },
    { $set: { sectionId: section8B } },
  );
  assert.equal((await write(session)).status, 409);
  await noWrite(session.sessionId);
  assert.equal(
    (await sessionDetail(session.sessionId)).data.students.length,
    2,
  );
});
test('new trusted enrollment invalidates the roster fingerprint', async () => {
  const session = (await open()).data;
  const learner = await actor('new-learner', 'student', branchA);
  await createStudent({
    createdBy: String(principal.id),
    userId: String(learner.id),
    branchId: String(branchA),
    classId: String(class8),
    sectionId: String(section8A),
    admissionNumber: 'NEW',
  });
  assert.equal((await write(session)).status, 409);
  await noWrite(session.sessionId);
});
test('stale revision cannot overwrite a newer draft', async () => {
  const session = (await open()).data;
  await write(session, bodyFor(session), 'draft');
  assert.equal(
    (
      await write(
        session,
        bodyFor(session, { clientOperationId: 'stale_revision_00001' }),
      )
    ).status,
    409,
  );
  assert.equal(await AttendanceOperation.countDocuments(), 1);
});
test('empty roster does not generate absence records and cannot finalize', async () => {
  await Student.collection.deleteMany({});
  const session = (await open()).data;
  assert.equal(session.students.length, 0);
  assert.equal((await write(session)).status, 400);
  await noWrite(session.sessionId);
});
test('school-date rollover does not auto-mark or auto-submit', async () => {
  const session = (await open()).data;
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T06:00:00Z') });
  await pending();
  await noWrite(session.sessionId);
});
test('future occurrence cannot create attendance and draft schedules remain hidden', async () => {
  assert.equal((await open(teacherA, periodId, '2026-10-20')).status, 400);
  await TimetableVersion.updateOne(
    { _id: versionId },
    { $set: { status: 'draft' } },
  );
  assert.equal((await open()).status, 404);
  assert.equal(await AttendanceSession.countDocuments(), 0);
});
test('cross-product subject/section responsibility is denied by shared occurrence resolver', async () => {
  await TimetablePeriod.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(periodId) },
    { $set: { subjectId: physics } },
  );
  assert.equal((await open()).status, 404);
});
for (const [name, change] of [
  [
    'branch change',
    async () => {
      await User.updateOne(
        { _id: teacherA.id },
        { $set: { branchId: branchB } },
      );
    },
  ],
  [
    'inactive Teacher',
    async () => {
      await User.updateOne({ _id: teacherA.id }, { $set: { isActive: false } });
    },
  ],
  [
    'inactive Branch',
    async () => {
      await Branch.updateOne({ _id: branchA }, { $set: { isActive: false } });
    },
  ],
  [
    'attendance view permission removal',
    async () => {
      ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
        p => p !== PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
      );
    },
  ],
  [
    'role change',
    async () => {
      await User.updateOne(
        { _id: teacherA.id },
        { $set: { role: 'principal' } },
      );
    },
  ],
  [
    'assignment revoke',
    async () => {
      await TeacherAssignment.updateMany(
        { teacherId: teacherA.id },
        { $set: { isActive: false } },
      );
    },
  ],
  [
    'version retirement',
    async () => {
      await TimetableVersion.updateOne(
        { _id: versionId },
        { $set: { status: 'retired' } },
      );
    },
  ],
  [
    'new winning revision',
    async () => {
      const newer = await version({ versionNumber: 2 });
      await approve(newer.data.versionId);
    },
  ],
  [
    'inactive class',
    async () => {
      await SchoolClass.updateOne(
        { _id: class8 },
        { $set: { isActive: false } },
      );
    },
  ],
  [
    'inactive section',
    async () => {
      await Section.updateOne(
        { _id: section8A },
        { $set: { isActive: false } },
      );
    },
  ],
  [
    'inactive subject',
    async () => {
      await Subject.updateOne({ _id: math }, { $set: { isActive: false } });
    },
  ],
  [
    'session revoke',
    async () => {
      await Session.updateOne(
        { token: teacherA.token },
        { $set: { isRevoked: true } },
      );
    },
  ],
  [
    'permission removal',
    async () => {
      ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
        p => p !== PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
      );
    },
  ],
] as const)
  test(`${name} after initial authorization causes zero attendance write`, async () => {
    const session = (await open()).data;
    const original = mongoose.startSession.bind(mongoose);
    const hook = mock.method(
      mongoose,
      'startSession',
      async (...args: Parameters<typeof mongoose.startSession>) => {
        hook.mock.restore();
        await change();
        return original(...args);
      },
    );
    const result = await write(session);
    assert.ok([401, 403, 404].includes(result.status), result.message);
    await noWrite(session.sessionId);
  });
test('substitute withdrawal before final persistence causes zero attendance writes', async () => {
  const id = await replacement();
  const session = (await open(teacherB)).data;
  const original = mongoose.startSession.bind(mongoose);
  const hook = mock.method(mongoose, 'startSession', async () => {
    hook.mock.restore();
    await SubstituteAssignment.updateOne(
      { _id: id },
      { $set: { status: 'retired' } },
    );
    return original();
  });
  assert.equal(
    (await write(session, bodyFor(session), 'submit', teacherB)).status,
    404,
  );
  await noWrite(session.sessionId);
});
test('permission invalidation after staging domain writes rolls back records, audit and fences', async () => {
  const session = (await open()).data;
  const beforeVersion = (await Branch.findById(branchA))!.__v;
  const original = AttendanceSession.updateOne.bind(AttendanceSession);
  const hook = mock.method(
    AttendanceSession,
    'updateOne',
    (...args: Parameters<typeof AttendanceSession.updateOne>) => {
      hook.mock.restore();
      // Static permission invalidation after domain rows are staged proves rollback,
      // without bypassing the real database writes/transaction under test.
      ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
        p => p !== PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
      );
      return original(...args);
    },
  );
  assert.equal((await write(session)).status, 403);
  await noWrite(session.sessionId);
  assert.equal((await Branch.findById(branchA))!.__v, beforeVersion);
});
test('roster change at final persistence boundary is rejected', async () => {
  const session = (await open()).data;
  const original = mongoose.startSession.bind(mongoose);
  const hook = mock.method(mongoose, 'startSession', async () => {
    hook.mock.restore();
    await Student.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(learnerIds[0]) },
      { $set: { classId: class9, sectionId: section9B } },
    );
    return original();
  });
  assert.equal((await write(session)).status, 409);
  await noWrite(session.sessionId);
});
test('malformed IDs, unknown fields and invalid statuses are sanitized and write nothing', async () => {
  assert.equal((await sessionDetail('not-an-id')).status, 400);
  const session = (await open()).data;
  for (const extra of [
    { branchId: String(branchB) },
    { teacherId: String(teacherB.id) },
    { clientOperationId: 'short' },
    { marks: [{ studentId: learnerIds[0], status: '' }] },
    { marks: [{ studentId: learnerIds[0], status: 'halfDay' }] },
  ]) {
    assert.equal((await write(session, bodyFor(session, extra))).status, 400);
  }
  assert.equal(
    (await pending(teacherA, '?teacherId=' + teacherB.id)).status,
    400,
  );
  assert.equal(
    (await http('/teacher/attendance/pending', teacherA, 'GET', {})).status,
    400,
  );
  await noWrite(session.sessionId);
});
test('actual unique indexes protect occurrence, row and operation identities', async () => {
  const enrollmentIndexes = await Student.collection.indexes();
  assert.deepEqual(
    enrollmentIndexes.find(i => i.name === 'active_enrollment_roster')?.key,
    { branchId: 1, classId: 1, sectionId: 1, isActive: 1 },
  );
  for (const [model, name] of [
    [AttendanceSession, 'attendance_occurrence'],
    [PeriodAttendanceRecord, 'attendance_student'],
    [AttendanceOperation, 'attendance_operation'],
  ] as const) {
    const indexes = await model.collection.indexes();
    assert.equal(indexes.find(i => i.name === name)?.unique, true);
  }
});
test('foreign timetable occurrence is concealed even with valid IDs', async () => {
  const foreignPrincipal = await actor(
    'foreign-principal',
    'principal',
    branchB,
  );
  const foreign = await version(
    {
      periods: [
        slot({
          teacherId: String(foreignTeacher.id),
          classId: String(foreignClass),
          sectionId: String(foreignSection),
          subjectId: String(foreignSubject),
        }),
      ],
    },
    foreignPrincipal,
  );
  // Provision a valid foreign assignment before trusted timetable creation.
  assert.equal(foreign.status, 404);
  const assignment = await http(
    '/teacher-assignments',
    foreignPrincipal,
    'POST',
    input({
      teacherId: String(foreignTeacher.id),
      classId: String(foreignClass),
      sectionId: String(foreignSection),
      subjectId: String(foreignSubject),
    }),
  );
  assert.equal(assignment.status, 201);
  const created = await version(
    {
      periods: [
        slot({
          teacherId: String(foreignTeacher.id),
          classId: String(foreignClass),
          sectionId: String(foreignSection),
          subjectId: String(foreignSubject),
        }),
      ],
    },
    foreignPrincipal,
  );
  assert.equal(created.status, 201);
  assert.equal(
    (await approve(created.data.versionId, foreignPrincipal)).status,
    200,
  );
  const record = await TimetablePeriod.findOne({
    timetableVersionId: created.data.versionId,
  });
  assert.equal((await open(teacherA, String(record!._id))).status, 404);
  assert.equal((await open(foreignTeacher, String(record!._id))).status, 200);
});
test('same operation identity from separate actors cannot expose or deduplicate another actor audit', async () => {
  const session = (await open()).data;
  assert.equal((await write(session, bodyFor(session), 'draft')).status, 200);
  await replacement();
  const substitute = (await open(teacherB)).data;
  assert.equal(
    (await write(substitute, bodyFor(substitute), 'draft', teacherB)).status,
    200,
  );
  assert.equal(await AttendanceOperation.countDocuments(), 2);
});
test('real concurrent student movement is fenced until the valid attendance write commits', async () => {
  const session = (await open()).data;
  let movement: Promise<unknown> | undefined,
    moved = false;
  const original = AttendanceSession.updateOne.bind(AttendanceSession);
  const hook = mock.method(
    AttendanceSession,
    'updateOne',
    async (...args: Parameters<typeof AttendanceSession.updateOne>) => {
      hook.mock.restore();
      movement = Student.collection
        .updateOne(
          { _id: new mongoose.Types.ObjectId(learnerIds[0]) },
          { $set: { sectionId: section8B } },
        )
        .then(() => {
          moved = true;
        });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(moved, false);
      return original(...args);
    },
  );
  assert.equal((await write(session)).status, 200);
  await movement;
  assert.equal(moved, true);
  assert.equal(await AttendanceOperation.countDocuments(), 1);
});
test('real concurrent timetable retirement waits for fenced attendance commit', async () => {
  const session = (await open()).data;
  let retirement: Promise<unknown> | undefined,
    retired = false;
  const original = AttendanceSession.updateOne.bind(AttendanceSession);
  const hook = mock.method(
    AttendanceSession,
    'updateOne',
    async (...args: Parameters<typeof AttendanceSession.updateOne>) => {
      hook.mock.restore();
      retirement = TimetableVersion.updateOne(
        { _id: versionId },
        { $set: { status: 'retired' } },
      ).then(() => {
        retired = true;
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(retired, false);
      return original(...args);
    },
  );
  assert.equal((await write(session)).status, 200);
  await retirement;
  const history = await sessionDetail(session.sessionId);
  assert.equal(history.status, 200);
  assert.equal(history.data.state, 'submitted');
  assert.equal((await write(session, bodyFor(session, {clientOperationId: 'retired_attendance_write_001'}))).status, 404);
  assert.equal(await AttendanceOperation.countDocuments(), 1);
});
test('three explicit draft marks out of thirty never turn the other twenty-seven into absences', async () => {
  for (let index = 3; index < 30; index++) {
    const learner = await actor(`learner-${index}`, 'student', branchA);
    await new Student({
      userId: learner.id,
      branchId: branchA,
      classId: class8,
      sectionId: section8A,
      admissionNumber: `A${index}`,
    }).save();
  }
  const session = (await open()).data;
  const body = bodyFor(session, {
    marks: session.students.map((s, index) => ({
      studentId: s.studentId,
      status: index < 3 ? 'present' : null,
    })),
  });
  assert.equal((await write(session, body, 'draft')).status, 200);
  const latest = (await sessionDetail(session.sessionId)).data;
  assert.equal(latest.students.filter(s => s.status === null).length, 27);
  assert.equal(await PeriodAttendanceRecord.countDocuments(), 3);
  assert.equal(
    await PeriodAttendanceRecord.countDocuments({ status: 'absent' }),
    0,
  );
});
test('Teacher view and manage permissions never broaden Principal or Super Admin attendance authority', () => {
  for (const permission of [
    PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
  ]) {
    assert.equal(ROLE_PERMISSIONS.teacher.includes(permission), true);
    assert.equal(ROLE_PERMISSIONS.principal.includes(permission), false);
    assert.equal(ROLE_PERMISSIONS.super_admin.includes(permission), false);
  }
  assert.equal(
    ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TIMETABLE_MANAGE),
    false,
  );
  assert.equal(
    ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE),
    false,
  );
});
test('Teacher period attendance does not reinterpret or modify legacy daily summaries', async () => {
  await LegacyAttendance.collection.deleteMany({});
  const original = await new LegacyAttendance({
    branchId: branchA,
    classId: class8,
    sectionId: section8A,
    studentId: learnerIds[0],
    date: new Date(),
    status: 'late',
    markedBy: teacherA.id,
  }).save();
  const summary = await getBranchAttendanceSummary(String(branchA));
  const session = (await open()).data;
  assert.equal((await write(session)).status, 200);
  assert.deepEqual(await getBranchAttendanceSummary(String(branchA)), summary);
  assert.equal((await LegacyAttendance.findById(original._id))!.status, 'late');
});
test('Principal cannot reach Teacher attendance even with mistakenly granted operational permissions', async () => {
  ROLE_PERMISSIONS.principal.push(
    PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
  );
  assert.equal((await open(principal)).status, 403);
  assert.equal(await AttendanceSession.countDocuments(), 0);
});
test('submitted history pins the old version after an approved replacement; draft history stays operational', async () => {
  const submitted = (await open()).data;
  assert.equal((await write(submitted)).status, 200);
  const snapshot = await AttendanceSession.findById(submitted.sessionId).lean();
  const next = await version({versionNumber: 2}); assert.equal(next.status, 201);
  assert.equal((await approve(next.data.versionId)).status, 200);
  const history = await sessionDetail(submitted.sessionId); assert.equal(history.status, 200);
  assert.equal(history.data.period.approvedVersion.versionId, versionId);
  assert.equal(history.data.period.periodId, periodId);
  assert.equal(history.data.canSave, false);
  assert.deepEqual(await AttendanceSession.findById(submitted.sessionId).lean(), snapshot);
  assert.equal((await write(submitted, bodyFor(submitted, {clientOperationId: 'replaced_attendance_write_001'}))).status, 404);
  const replacementPeriod = await TimetablePeriod.findOne({timetableVersionId: next.data.versionId});
  const current = (await open(teacherA, String(replacementPeriod!._id))).data;
  assert.equal(current.period.approvedVersion.versionId, next.data.versionId);
  assert.equal((await http(`/timetables/versions/${next.data.versionId}/retire`, principal, 'POST', {})).status, 200);
  assert.equal((await sessionDetail(current.sessionId)).status, 404);
  assert.equal((await sessionDetail(submitted.sessionId)).status, 200);
});
test('historical substitute read is record-specific and explicit substitute revocation still denies it', async () => {
  await TeacherAssignment.updateMany({teacherId: teacherB.id}, {$set: {isActive: false}});
  const substituteId = await replacement();
  const attendance = (await open(teacherB)).data;
  assert.equal((await write(attendance, bodyFor(attendance), 'submit', teacherB)).status, 200);
  const snapshot = await AttendanceSession.findById(attendance.sessionId).lean();
  assert.equal((await http(`/timetables/versions/${versionId}/retire`, principal, 'POST', {})).status, 200);
  const history = await sessionDetail(attendance.sessionId, teacherB); assert.equal(history.status, 200);
  assert.equal(history.data.period.isSubstitute, true); assert.equal(history.data.period.substituteId, substituteId);
  assert.equal(history.data.period.room, 'Approved revised room'); assert.equal(history.data.period.canAcknowledgeSubstitute, false);
  assert.equal((await sessionDetail(attendance.sessionId, teacherA)).status, 404);
  assert.equal((await open(teacherB)).status, 404);
  assert.equal((await http(`/timetables/substitutes/${substituteId}/retire`, principal, 'POST', {})).status, 200);
  assert.equal((await sessionDetail(attendance.sessionId, teacherB)).status, 404);
  assert.deepEqual(await AttendanceSession.findById(attendance.sessionId).lean(), snapshot);
});
