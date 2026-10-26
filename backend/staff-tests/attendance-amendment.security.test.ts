import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
import Student from '../src/staff/src/models/student';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import {
  AttendanceCorrection,
  StudentLeave,
  AttendanceDownstreamIntent,
  ensureAttendanceAmendmentIndexes,
} from '../src/staff/src/models/attendanceAmendment';
import {
  PeriodAttendanceRecord,
  AttendanceSession,
  AttendanceOperation,
} from '../src/staff/src/models/periodAttendance';
import {
  effectiveAttendance,
  absenceIntentIsCurrent,
} from '../src/staff/src/services/attendance-effective.service';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, { type UserRole } from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import { ensureAttendanceIndexes } from '../src/staff/src/models/periodAttendance';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  ensureTimetableIndexes,
} from '../src/staff/src/models/timetable';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import {
  schoolToday,
  scheduleWeekday,
  addScheduleDays,
} from '../src/staff/src/services/school-date.service';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
// No dotenv/development data: an owned, ephemeral replica set only.
let db: MongoMemoryReplSet, server: Server, base: string;
let branch: any,
  foreign: any,
  teacher: any,
  other: any,
  classId: any,
  sectionId: any,
  subjectId: any,
  version: any,
  period: any;
const originalTimezone = process.env.SCHOOL_TIMEZONE;
const originalSecret = process.env.JWT_SECRET,
  grants = [...ROLE_PERMISSIONS.teacher];
const actor = async (role: UserRole, branchId = branch) => {
  const u = await new User({
    fullName: 'Teacher Ayesha',
    email: new mongoose.Types.ObjectId() + '@test.invalid',
    password: 'private-test-hash',
    role,
    branchId,
  }).save();
  const token = generateAccessToken(String(u._id), role);
  await registerSession(String(u._id), token, role);
  return { id: u._id, token };
};
const http = async (
  path = '/teacher/home',
  person = teacher,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) => {
  const token = typeof person === 'string' ? person : person.token;
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, json: (await r.json()) as any };
};
before(async () => {
  process.env.JWT_SECRET = 'teacher-home-owned-test-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { autoIndex: false });
  await Promise.all([
    ensureTimetableIndexes(),
    ensureAttendanceIndexes(),
    ensureAttendanceAmendmentIndexes(),
    TeacherAssignment.createIndexes(),
    Subject.createIndexes(),
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  if (originalTimezone === undefined) delete process.env.SCHOOL_TIMEZONE;
  else process.env.SCHOOL_TIMEZONE = originalTimezone;
});
beforeEach(async () => {
  process.env.SCHOOL_TIMEZONE = 'Asia/Karachi';
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T05:00:00Z') });
  ROLE_PERMISSIONS.teacher = [...grants];
  for (const m of Object.values(mongoose.models))
    await m.collection.deleteMany({});
  branch = (
    await Branch.create({
      name: 'Main',
      code: 'MC',
      address: 'Address',
      city: 'City',
    })
  )._id;
  foreign = (
    await Branch.create({
      name: 'Other',
      code: 'OC',
      address: 'Address',
      city: 'City',
    })
  )._id;
  teacher = await actor('teacher');
  other = await actor('teacher');
  classId = (
    await new SchoolClass({
      branchId: branch,
      name: 'Grade 8',
      code: 'G8',
      academicYear: '2026',
    }).save()
  )._id;
  sectionId = (
    await new Section({
      branchId: branch,
      classId,
      name: 'A',
      code: 'A',
    }).save()
  )._id;
  subjectId = (
    await new Subject({ branchId: branch, name: 'Mathematics' }).save()
  )._id;
  await TeacherAssignment.create({
    teacherId: teacher.id,
    branchId: branch,
    classId,
    sectionId,
    subjectId,
    validFrom: new Date(Date.now() - 86400000),
    createdBy: other.id,
    updatedBy: other.id,
  });
  const today = schoolToday();
  version = await TimetableVersion.create({
    branchId: branch,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: today,
    effectiveUntil: addScheduleDays(today, 1),
    periodCount: 1,
    createdBy: other.id,
  });
  period = await TimetablePeriod.create({
    branchId: branch,
    timetableVersionId: version._id,
    teacherId: teacher.id,
    classId,
    sectionId,
    subjectId,
    dayOfWeek: scheduleWeekday(today),
    startTime: '00:00',
    endTime: '23:59',
    room: 'Room 204',
  });
});
after(async () => {
  ROLE_PERMISSIONS.teacher = grants;
  await new Promise<void>(r => server.close(() => r()));
  await mongoose.disconnect();
  await db.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
let principal: any,
  foreignPrincipal: any,
  student: any,
  student2: any,
  session: any;
const principalGrants = [...ROLE_PERMISSIONS.principal],
  savedPolicy = process.env.PRINCIPAL_APPROVAL_AUTHORITY,
  savedGrace = process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES;
beforeEach(async () => {
  ROLE_PERMISSIONS.principal = [...principalGrants];
  process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES = '30';
  principal = await actor('principal', branch);
  foreignPrincipal = await actor('principal', foreign);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: {
      branchId: String(branch),
      types: ['attendance_correction', 'leave'],
    },
    [String(foreignPrincipal.id)]: {
      branchId: String(foreign),
      types: ['attendance_correction', 'leave'],
    },
  });
  student = await new Student({
    userId: (await actor('student', branch)).id,
    branchId: branch,
    classId,
    sectionId,
    admissionNumber: 'ST-001',
  }).save();
  student2 = await new Student({
    userId: (await actor('student', branch)).id,
    branchId: branch,
    classId,
    sectionId,
    admissionNumber: 'ST-002',
  }).save();
  // These tests create NEW attendance before exercising historical amendments.
  await seedCurriculumFixtures();
  const opened = await http(
    `/teacher/attendance/occurrences/${period._id}?date=2026-10-14`,
    teacher,
  );
  assert.equal(opened.status, 200);
  session = opened.json.data;
  const submitted = await http(
    `/teacher/attendance/sessions/${session.sessionId}/submit`,
    teacher,
    {
      revision: 0,
      rosterVersion: session.rosterVersion,
      clientOperationId: 'submission_operation_0001',
      marks: session.students.map((s: any) => ({
        studentId: s.studentId,
        status: s.studentId === String(student._id) ? 'absent' : 'late',
      })),
    },
  );
  assert.equal(submitted.status, 200);
});
after(() => {
  ROLE_PERMISSIONS.principal = principalGrants;
  if (savedPolicy === undefined)
    delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = savedPolicy;
  if (savedGrace === undefined)
    delete process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES;
  else process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES = savedGrace;
});
const path = () =>
  `/teacher/attendance/sessions/${session.sessionId}/students/${student._id}`;
const correction = (extra: any = {}, person = teacher) =>
  http(path() + '/corrections', person, {
    requestedStatus: 'present',
    reason: 'Marked absent by mistake during roll call.',
    submittedRevision: 1,
    effectiveRevision: 0,
    clientOperationId: 'correction_operation_0001',
    ...extra,
  });
const leave = (extra: any = {}) =>
  http(path() + '/leaves', teacher, {
    fromDate: '2026-10-14',
    untilDate: '2026-10-14',
    category: 'illness',
    reason: 'Student has an authorized absence.',
    clientOperationId: 'leave_operation_000001',
    ...extra,
  });
const decide = (id: string, extra: any = {}, person = principal) =>
  http('/attendance-review/' + id + '/decision', person, {
    action: 'approved',
    reviewNote: 'Verified against class evidence.',
    revision: 0,
    clientOperationId: 'review_operation_000001',
    ...extra,
  });
const effective = async () =>
  (await effectiveAttendance(String(branch), session.sessionId)).get(
    String(student._id),
  )!;
const original = () =>
  PeriodAttendanceRecord.findOne({
    attendanceSessionId: session.sessionId,
    studentId: student._id,
  }).lean();
test('Teacher requests correction; original and effective status remain immutable until approval', async () => {
  const originalBefore = await original(),
    c = await correction();
  assert.equal(c.status, 200);
  assert.equal(c.json.data.state, 'pending');
  assert.deepEqual(await original(), originalBefore);
  assert.equal((await effective()).status, 'absent');
  const d = await http(path() + '/review');
  assert.equal(d.status, 200);
  assert.equal(d.json.data.corrections[0].requestedStatus, 'present');
  for (const secret of [
    'test-fixture-hash',
    'fingerprint',
    'decisionOperationId',
  ])
    assert.equal(JSON.stringify(d.json).includes(secret), false);
});
test('existing approval queue includes typed request; generic review cannot bypass atomic handler', async () => {
  const c = await correction(),
    id = c.json.data.approvalId;
  const q = await http('/approval-requests/pending', principal);
  assert.equal(q.status, 200);
  assert.ok(q.json.data.requests.some((r: any) => r._id === id));
  assert.equal(
    (
      await http(
        '/approval-requests/' + id,
        principal,
        { action: 'approved' },
        'PATCH',
      )
    ).status,
    400,
  );
  assert.equal((await effective()).status, 'absent');
});
test('unassigned Teacher denied valid guessed attendance identifiers', async () => {
  assert.equal((await correction({}, other)).status, 404);
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
});
test('foreign Teacher and Principal cannot discover or approve', async () => {
  const c = await correction();
  assert.equal(
    (await correction({}, await actor('teacher', foreign))).status,
    404,
  );
  assert.equal(
    (
      await http(
        '/attendance-review/' + c.json.data.approvalId,
        foreignPrincipal,
      )
    ).status,
    404,
  );
  assert.equal(
    (await decide(c.json.data.approvalId, {}, foreignPrincipal)).status,
    404,
  );
});
test('wrong class/section relation is concealed', async () => {
  await Section.collection.updateOne(
    { _id: sectionId },
    { $set: { classId: new mongoose.Types.ObjectId() } },
  );
  assert.equal((await correction()).status, 404);
});
test('arbitrary student outside submitted roster denied', async () => {
  const stranger = await new Student({
    userId: (await actor('student', branch)).id,
    branchId: branch,
    classId,
    sectionId,
    admissionNumber: 'NEW-STUDENT',
  }).save();
  assert.equal(
    (
      await http(
        `/teacher/attendance/sessions/${session.sessionId}/students/${stranger._id}/corrections`,
        teacher,
        {
          requestedStatus: 'present',
          reason: 'Valid but unrelated student context.',
          submittedRevision: 1,
          effectiveRevision: 0,
          clientOperationId: 'arbitrary_student_op_01',
        },
      )
    ).status,
    404,
  );
});
for (const [label, extra, code] of [
  ['no-op', { requestedStatus: 'absent' }, 400],
  ['malformed status', { requestedStatus: 'unknown' }, 400],
  ['short reason', { reason: 'bad' }, 400],
  ['forged state', { state: 'approved' }, 400],
  ['stale submission', { submittedRevision: 9 }, 409],
  ['stale effective', { effectiveRevision: 5 }, 409],
] as const)
  test(label + ' fails without changing source', async () => {
    assert.equal((await correction(extra)).status, code);
    assert.equal(await AttendanceCorrection.countDocuments(), 0);
    assert.equal((await original())?.status, 'absent');
  });
test('idempotent replay; changed payload conflicts', async () => {
  const a = await correction(),
    b = await correction();
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.json.data.replayed, true);
  assert.equal(a.json.data.requestId, b.json.data.requestId);
  assert.equal(
    (await correction({ reason: 'Different reason for reused operation.' }))
      .status,
    409,
  );
  assert.equal(await AttendanceCorrection.countDocuments(), 1);
  assert.equal(await ApprovalRequest.countDocuments(), 1);
});
test('two conflicting Teacher requests create one pending record', async () => {
  const r = await Promise.all([
    correction(),
    correction({
      requestedStatus: 'late',
      clientOperationId: 'conflicting_request_op_02',
    }),
  ]);
  assert.deepEqual(r.map(item => item.status).sort(), [200, 409]);
  assert.equal(
    await AttendanceCorrection.countDocuments({ state: 'pending' }),
    1,
  );
});
test('approved effective state preserves original actor, timestamps, session and history', async () => {
  const record = await original(),
    submitted = await AttendanceSession.findById(session.sessionId).lean(),
    c = await correction();
  assert.equal((await decide(c.json.data.approvalId)).status, 200);
  assert.equal((await effective()).status, 'present');
  assert.deepEqual(await original(), record);
  const submittedAfter = await AttendanceSession.findById(
    session.sessionId,
  ).lean();
  for (const field of [
    'state',
    'revision',
    'submittedAt',
    'submittedBy',
    'updatedAt',
  ])
    assert.deepEqual((submittedAfter as any)[field], (submitted as any)[field]);
  assert.equal(
    (await ApprovalRequest.findById(c.json.data.approvalId))?.history.length,
    1,
  );
  const d = await http('/teacher/attendance/sessions/' + session.sessionId);
  const row = d.json.data.students.find(
    (s: any) => s.studentId === String(student._id),
  );
  assert.equal(row.originalStatus, 'absent');
  assert.equal(row.status, 'present');
  assert.equal(d.json.data.canSave, false);
});
test('Principal without category authority denied', async () => {
  const c = await correction();
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = '{}';
  assert.equal((await decide(c.json.data.approvalId)).status, 403);
  assert.equal((await effective()).status, 'absent');
});
test('Teacher cannot approve own request', async () => {
  const c = await correction();
  assert.equal((await decide(c.json.data.approvalId, {}, teacher)).status, 403);
});
test('double approval replay writes one audit event', async () => {
  const c = await correction();
  assert.equal((await decide(c.json.data.approvalId)).status, 200);
  const replay = await decide(c.json.data.approvalId);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.replayed, true);
  assert.equal(
    (
      await decide(c.json.data.approvalId, {
        clientOperationId: 'different_decision_op_2',
      })
    ).status,
    409,
  );
  assert.equal(
    (await ApprovalRequest.findById(c.json.data.approvalId))?.history.length,
    1,
  );
});
test('approve/reject race produces one terminal decision', async () => {
  const c = await correction();
  const r = await Promise.all([
    decide(c.json.data.approvalId),
    decide(c.json.data.approvalId, {
      action: 'rejected',
      reviewNote: 'Evidence does not justify this change.',
      clientOperationId: 'rejection_racing_op_02',
    }),
  ]);
  assert.deepEqual(r.map(item => item.status).sort(), [200, 409]);
  assert.equal(
    (await ApprovalRequest.findById(c.json.data.approvalId))?.history.length,
    1,
  );
});
test('rejection does not change effective status', async () => {
  const c = await correction();
  assert.equal(
    (
      await decide(c.json.data.approvalId, {
        action: 'rejected',
        reviewNote: 'Insufficient evidence supplied for correction.',
      })
    ).status,
    200,
  );
  assert.equal((await effective()).status, 'absent');
  assert.equal((await AttendanceCorrection.findOne())?.state, 'rejected');
});
test('latest approved correction determines effective status', async () => {
  const c = await correction();
  assert.equal((await decide(c.json.data.approvalId)).status, 200);
  const d = await correction({
    requestedStatus: 'late',
    effectiveRevision: 1,
    clientOperationId: 'second_correction_op_02',
  });
  assert.equal(d.status, 200);
  assert.equal((await decide(d.json.data.approvalId)).status, 200);
  assert.deepEqual(await effective(), {
    originalStatus: 'absent',
    status: 'late',
    effectiveRevision: 2,
  });
});
test('historical roster evidence permits same-branch moved student', async () => {
  await Student.updateOne(
    { _id: student._id },
    {
      $set: {
        classId: new mongoose.Types.ObjectId(),
        sectionId: new mongoose.Types.ObjectId(),
      },
    },
  );
  assert.equal((await correction()).status, 200);
  const d = await http('/teacher/attendance/sessions/' + session.sessionId);
  assert.ok(
    d.json.data.students.some((s: any) => s.studentId === String(student._id)),
  );
});
test('approved substitute has authority; original Teacher loses simultaneous authority', async () => {
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: teacher.id,
    substituteTeacherId: other.id,
    date: '2026-10-14',
    startTime: '09:00',
    endTime: '10:00',
    room: 'Sub room',
    status: 'approved',
    createdBy: principal.id,
  });
  assert.equal((await correction()).status, 404);
  assert.equal((await correction({}, other)).status, 200);
});
test('revocation denies request and approval of queued correction', async () => {
  const c = await correction();
  await TeacherAssignment.updateMany({}, { $set: { isActive: false } });
  assert.equal((await correction()).status, 404);
  assert.equal((await decide(c.json.data.approvalId)).status, 404);
  assert.equal((await effective()).status, 'absent');
});
test('leave after submission needs approved leave then a separate correction', async () => {
  const l = await leave();
  assert.equal(l.status, 200);
  assert.equal((await decide(l.json.data.approvalId)).status, 200);
  assert.equal((await effective()).status, 'absent');
  const c = await correction({
    requestedStatus: 'leave',
    leaveId: l.json.data.requestId,
  });
  assert.equal(c.status, 200);
  assert.equal((await decide(c.json.data.approvalId)).status, 200);
  assert.equal((await effective()).status, 'leave');
  assert.equal((await StudentLeave.findOne())?.state, 'approved');
  assert.equal((await original())?.status, 'absent');
});
test('unapproved or unknown leave cannot justify correction', async () => {
  const l = await leave();
  assert.equal(
    (
      await correction({
        requestedStatus: 'leave',
        leaveId: l.json.data.requestId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await correction({
        requestedStatus: 'leave',
        leaveId: String(new mongoose.Types.ObjectId()),
      })
    ).status,
    400,
  );
});
test('stale absence intents suppressed atomically and stale requeue cannot dispatch', async () => {
  const intents = await AttendanceDownstreamIntent.find({});
  assert.equal(intents.length, 2);
  mock.timers.setTime(Date.parse('2026-10-14T07:00:00Z'));
  await AttendanceDownstreamIntent.updateMany(
    {},
    { $set: { approvalState: 'approved' } },
  );
  assert.equal(await absenceIntentIsCurrent(String(intents[0]._id)), true);
  const c = await correction();
  assert.equal((await decide(c.json.data.approvalId)).status, 200);
  assert.equal(
    await AttendanceDownstreamIntent.countDocuments({ state: 'suppressed' }),
    2,
  );
  assert.equal(await absenceIntentIsCurrent(String(intents[0]._id)), false);
  await AttendanceDownstreamIntent.updateOne(
    { _id: intents[0]._id },
    { $set: { state: 'pending' } },
  );
  assert.equal(await absenceIntentIsCurrent(String(intents[0]._id)), false);
});
test('correction does not auto-absent other students or reopen submission', async () => {
  const originalBefore = await PeriodAttendanceRecord.findOne({
      studentId: student2._id,
    }).lean(),
    c = await correction();
  assert.equal((await decide(c.json.data.approvalId)).status, 200);
  assert.deepEqual(
    await PeriodAttendanceRecord.findOne({ studentId: student2._id }).lean(),
    originalBefore,
  );
  assert.equal(
    (
      await http(
        `/teacher/attendance/sessions/${session.sessionId}/draft`,
        teacher,
        {
          revision: 1,
          rosterVersion: session.rosterVersion,
          clientOperationId: 'illegal_reopen_operation',
          marks: [],
        },
      )
    ).status,
    409,
  );
  assert.equal(await AttendanceOperation.countDocuments(), 1);
});
for (const kind of ['inactive', 'role', 'session', 'permission'] as const)
  test(kind + ' change denies correction', async () => {
    if (kind === 'inactive')
      await User.updateOne({ _id: teacher.id }, { $set: { isActive: false } });
    if (kind === 'role')
      await User.updateOne({ _id: teacher.id }, { $set: { role: 'student' } });
    if (kind === 'session')
      await Session.updateMany(
        { token: teacher.token },
        { $set: { isRevoked: true } },
      );
    if (kind === 'permission')
      ROLE_PERMISSIONS.teacher = grants.filter(
        p => p !== PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
      );
    assert.ok([401, 403].includes((await correction()).status));
  });

test('Principal session, role and permission changes fail closed', async () => {
  const c = await correction();
  await Session.updateMany(
    { token: principal.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await decide(c.json.data.approvalId)).status, 401);
  assert.equal((await AttendanceCorrection.findOne())?.state, 'pending');
  assert.equal((await effective()).status, 'absent');
});
test('Principal permission revoked during decision rolls back correction, approval and intents', async () => {
  const c = await correction();
  const originalUpdate =
    AttendanceCorrection.updateOne.bind(AttendanceCorrection);
  mock.method(AttendanceCorrection, 'updateOne', (...args: any[]) => {
    const query = (originalUpdate as any)(...args);
    ROLE_PERMISSIONS.principal = principalGrants.filter(
      p => p !== PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
    );
    return query;
  });
  assert.equal((await decide(c.json.data.approvalId)).status, 403);
  assert.equal((await AttendanceCorrection.findOne())?.state, 'pending');
  assert.equal(
    (await ApprovalRequest.findById(c.json.data.approvalId))?.history.length,
    0,
  );
  assert.equal(
    await AttendanceDownstreamIntent.countDocuments({ state: 'suppressed' }),
    0,
  );
  assert.equal((await effective()).status, 'absent');
});
test('Teacher permission revoked during request rolls back both domain and approval records', async () => {
  const originalCreate = AttendanceCorrection.create.bind(AttendanceCorrection);
  mock.method(AttendanceCorrection, 'create', async (...args: any[]) => {
    const result = await (originalCreate as any)(...args);
    ROLE_PERMISSIONS.teacher = grants.filter(
      p => p !== PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
    );
    return result;
  });
  assert.equal((await correction()).status, 403);
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
  assert.equal(await ApprovalRequest.countDocuments(), 0);
});
test('replaced substitute cannot resolve an earlier occurrence request', async () => {
  const c = await correction();
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: teacher.id,
    substituteTeacherId: other.id,
    date: '2026-10-14',
    startTime: '09:00',
    endTime: '10:00',
    room: 'Sub room',
    status: 'approved',
    createdBy: principal.id,
  });
  assert.equal((await decide(c.json.data.approvalId)).status, 404);
  assert.equal((await effective()).status, 'absent');
});
test('changed source revision prevents approval and effective projection', async () => {
  const c = await correction();
  await AttendanceSession.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(session.sessionId) },
    { $inc: { revision: 1 } },
  );
  assert.equal((await decide(c.json.data.approvalId)).status, 409);
  assert.equal((await AttendanceCorrection.findOne())?.state, 'pending');
});
test('overlapping leave requests serialize and duplicate retries replay', async () => {
  const a = await leave(),
    b = await leave();
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.json.data.replayed, true);
  assert.equal(
    (await leave({ clientOperationId: 'different_leave_operation' })).status,
    409,
  );
  assert.equal(await StudentLeave.countDocuments(), 1);
});
test('approved leave before submission can be marked without rewriting other submitted attendance', async () => {
  const second = await TimetablePeriod.create({
    branchId: branch,
    timetableVersionId: version._id,
    teacherId: teacher.id,
    classId,
    sectionId,
    subjectId,
    dayOfWeek: scheduleWeekday('2026-10-14'),
    startTime: '14:00',
    endTime: '15:00',
    room: 'Room 204',
  });
  const opened = await http(
    `/teacher/attendance/occurrences/${second._id}?date=2026-10-14`,
  );
  assert.equal(opened.status, 200);
  const open = opened.json.data;
  const l = await http(
    `/teacher/attendance/sessions/${open.sessionId}/students/${student._id}/leaves`,
    teacher,
    {
      fromDate: '2026-10-14',
      untilDate: '2026-10-14',
      category: 'illness',
      reason: 'Authorized student absence before submission.',
      clientOperationId: 'premarking_leave_operation',
    },
  );
  assert.equal(l.status, 200);
  assert.equal((await decide(l.json.data.approvalId)).status, 200);
  const submitted = await http(
    `/teacher/attendance/sessions/${open.sessionId}/submit`,
    teacher,
    {
      revision: 0,
      rosterVersion: open.rosterVersion,
      clientOperationId: 'premarking_submit_operation',
      marks: open.students.map((s: any) => ({
        studentId: s.studentId,
        status: s.studentId === String(student._id) ? 'leave' : 'present',
      })),
    },
  );
  assert.equal(submitted.status, 200);
  assert.equal((await original())?.status, 'absent');
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
});
test('no missing-attendance or grace bypass generates dispatchable absence', async () => {
  const intents = await AttendanceDownstreamIntent.find({});
  assert.equal(await absenceIntentIsCurrent(String(intents[0]._id)), false);
  await AttendanceDownstreamIntent.updateMany(
    {},
    { $set: { approvalState: 'approved' } },
  );
  assert.equal(await absenceIntentIsCurrent(String(intents[0]._id)), false);
  assert.equal(
    await AttendanceDownstreamIntent.countDocuments({
      studentId: student2._id,
    }),
    0,
  );
});
for (const role of ['student', 'super_admin'] as const)
  test(role + ' cannot initiate or review amendments', async () => {
    const person = await actor(role),
      c = await correction();
    assert.equal((await correction({}, person)).status, 403);
    assert.equal(
      (await decide(c.json.data.approvalId, {}, person)).status,
      403,
    );
  });

test('parallel duplicate creation is one request and one approval', async () => {
  const results = await Promise.all([correction(), correction()]);
  assert.deepEqual(
    results.map(item => item.status),
    [200, 200],
  );
  assert.equal(results[0].json.data.requestId, results[1].json.data.requestId);
  assert.equal(await AttendanceCorrection.countDocuments(), 1);
  assert.equal(await ApprovalRequest.countDocuments(), 1);
});
for (const change of ['inactive', 'role'] as const)
  test('Principal ' + change + ' denies review without effect', async () => {
    const c = await correction();
    await User.updateOne(
      { _id: principal.id },
      {
        $set: change === 'inactive' ? { isActive: false } : { role: 'teacher' },
      },
    );
    assert.equal((await decide(c.json.data.approvalId)).status, 401);
    assert.equal((await AttendanceCorrection.findOne())?.state, 'pending');
  });
test('student branch move and malformed IDs cannot influence historical corrections', async () => {
  assert.equal(
    (await http('/teacher/attendance/sessions/bad/students/bad/review')).status,
    400,
  );
  await User.updateOne(
    { _id: student.userId },
    { $set: { branchId: foreign } },
  );
  assert.equal((await correction()).status, 404);
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
});
test('reject without meaningful review note is rejected and never mutates request', async () => {
  const c = await correction();
  assert.equal(
    (
      await decide(c.json.data.approvalId, {
        action: 'rejected',
        reviewNote: '',
      })
    ).status,
    400,
  );
  assert.equal((await AttendanceCorrection.findOne())?.state, 'pending');
});

test('new current enrollment can request leave before a draft roster is resaved', async () => {
  const next = await TimetablePeriod.create({
    branchId: branch,
    timetableVersionId: version._id,
    teacherId: teacher.id,
    classId,
    sectionId,
    subjectId,
    dayOfWeek: scheduleWeekday('2026-10-14'),
    startTime: '16:00',
    endTime: '17:00',
    room: 'Room 204',
  });
  const open = await http(
    `/teacher/attendance/occurrences/${next._id}?date=2026-10-14`,
  );
  const added = await new Student({
    userId: (await actor('student')).id,
    branchId: branch,
    classId,
    sectionId,
    admissionNumber: 'NEW-ENROLLMENT',
  }).save();
  const l = await http(
    `/teacher/attendance/sessions/${open.json.data.sessionId}/students/${added._id}/leaves`,
    teacher,
    {
      fromDate: '2026-10-14',
      untilDate: '2026-10-14',
      category: 'illness',
      reason: 'Confirmed leave for newly enrolled student.',
      clientOperationId: 'new_enrollment_leave_op',
    },
  );
  assert.equal(l.status, 200);
  assert.equal((await decide(l.json.data.approvalId)).status, 200);
  assert.equal(
    (await StudentLeave.findOne({ studentId: added._id }))?.state,
    'approved',
  );
});
test('a later explicit absence creates a fresh grace-bound intent, never revives obsolete approval', async () => {
  const first = await correction();
  assert.equal((await decide(first.json.data.approvalId)).status, 200);
  const second = await correction({
    requestedStatus: 'absent',
    effectiveRevision: 1,
    clientOperationId: 'return_to_absence_operation',
  });
  assert.equal((await decide(second.json.data.approvalId)).status, 200);
  const fresh = await AttendanceDownstreamIntent.find({ effectiveRevision: 2 });
  assert.equal(fresh.length, 2);
  assert.ok(
    fresh.every(
      item =>
        item.approvalState === 'pending' &&
        item.notBefore.getTime() === Date.now() + 30 * 60000,
    ),
  );
  assert.equal(
    await AttendanceDownstreamIntent.countDocuments({
      effectiveRevision: 0,
      state: 'suppressed',
    }),
    2,
  );
  assert.equal(await absenceIntentIsCurrent(String(fresh[0]._id)), false);
  assert.equal((await original())?.status, 'absent');
});
