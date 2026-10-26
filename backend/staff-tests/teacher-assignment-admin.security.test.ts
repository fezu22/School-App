import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
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
import Student from '../src/staff/src/models/student';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { hashPassword } from '../src/staff/src/utils/password';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import {
  TimetablePeriod,
  TimetableVersion,
  ensureTimetableIndexes,
} from '../src/staff/src/models/timetable';
import { ensureAttendanceIndexes } from '../src/staff/src/models/periodAttendance';
import {ensureAssignmentAdminIndexes} from '../src/staff/src/services/teacher-assignment-admin.service';

// Owned ephemeral data only; never load dotenv or the development DB URI.
let db: MongoMemoryReplSet, server: Server, base: string;
let branch: string,
  foreign: string,
  admin: string,
  principal: string,
  teacher: string,
  teacherId: string,
  foreignTeacher: string,
  classId: string,
  otherClass: string,
  sectionId: string,
  otherSection: string,
  subjectId: string,
  foreignSubject: string;
const grants = [...ROLE_PERMISSIONS.principal],
  originalSecret = process.env.JWT_SECRET;
const actor = async (role: UserRole, branchId?: string) => {
  const user = await new User({
    fullName: 'Actor ' + role,
    email: new mongoose.Types.ObjectId() + '@test.invalid',
    password: 'test-fixture-hash',
    role,
    branchId,
  }).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return { id: String(user._id), token };
};
const http = async (
  path: string,
  token?: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json()) as any };
};
const input = (extra: Record<string, unknown> = {}) => ({
  teacherId,
  classId,
  sectionId,
  subjectId,
  validFrom: '2020-01-01T00:00:00Z',
  ...extra,
});
const options = (query = '', token = principal) =>
  http('/teacher-assignments/options' + query, token);
before(async () => {
  process.env.JWT_SECRET = 'owned-assignment-admin-fixture-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { autoIndex: false });
  await Promise.all([
    TeacherAssignment.createIndexes(),
    User.collection.createIndex({ email: 1 }, { unique: true }),
    ensureTimetableIndexes(),
    ensureAttendanceIndexes(),
  ]);
  await ensureAssignmentAdminIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const a = server.address();
  assert.ok(a && typeof a !== 'string');
  base = `http://127.0.0.1:${a.port}/api`;
});
beforeEach(async () => {
  ROLE_PERMISSIONS.principal = [...grants];
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  branch = String(
    (
      await Branch.create({
        name: 'Main Campus',
        code: 'MC',
        address: 'Private address',
        city: 'City',
      })
    )._id,
  );
  foreign = String(
    (
      await Branch.create({
        name: 'Other Campus',
        code: 'OC',
        address: 'Other address',
        city: 'City',
      })
    )._id,
  );
  admin = (await actor('super_admin')).token;
  principal = (await actor('principal', branch)).token;
  const t = await actor('teacher', branch);
  teacher = t.token;
  teacherId = t.id;
  foreignTeacher = (await actor('teacher', foreign)).id;
  classId = String(
    (
      await new SchoolClass({
        branchId: branch,
        name: 'Grade 8',
        code: 'G8',
        academicYear: '2026',
      }).save()
    )._id,
  );
  otherClass = String(
    (
      await new SchoolClass({
        branchId: branch,
        name: 'Grade 9',
        code: 'G9',
        academicYear: '2026',
      }).save()
    )._id,
  );
  sectionId = String(
    (
      await new Section({
        branchId: branch,
        classId,
        name: 'A',
        code: 'A',
      }).save()
    )._id,
  );
  otherSection = String(
    (
      await new Section({
        branchId: branch,
        classId: otherClass,
        name: 'B',
        code: 'B',
      }).save()
    )._id,
  );
  subjectId = String(
    (await new Subject({ branchId: branch, name: 'Mathematics' }).save())._id,
  );
  foreignSubject = String(
    (await new Subject({ branchId: foreign, name: 'Foreign subject' }).save())
      ._id,
  );
  await seedCurriculumFixtures(false);
});
after(async () => {
  ROLE_PERMISSIONS.principal = grants;
  if (server) await new Promise<void>(r => server.close(() => r()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
test('Principal options fix current branch and whitelist every DTO', async () => {
  const r = await options('?teacherId=' + teacherId + '&classId=' + classId);
  assert.equal(r.status, 200);
  assert.deepEqual(
    Object.keys(r.json.data).sort(),
    [
      'branchId',
      'branchFixed',
      'branches',
      'teachers',
      'selectedTeacher',
      'classes',
      'sections',
      'subjects',
    ].sort(),
  );
  assert.equal(r.json.data.branchFixed, true);
  assert.equal(r.json.data.branchId, branch);
  assert.equal(r.json.data.branches.length, 1);
  assert.deepEqual(
    Object.keys(r.json.data.selectedTeacher).sort(),
    ['teacherId', 'fullName', 'email', 'branchId', 'isActive'].sort(),
  );
  assert.deepEqual(
    Object.keys(r.json.data.branches[0]).sort(),
    ['id', 'name', 'code'].sort(),
  );
  for (const key of ['classes', 'sections', 'subjects'])
    assert.deepEqual(
      Object.keys(r.json.data[key][0]).sort(),
      ['id', 'name'].sort(),
    );
  assert.deepEqual(
    r.json.data.sections.map((s: any) => s.id),
    [sectionId],
  );
  assert.equal(
    r.json.data.subjects.some((s: any) => s.id === foreignSubject),
    false,
  );
});
test('global Super Admin options and Teacher preselection derive compatible branch', async () => {
  const r = await options('?teacherId=' + foreignTeacher, admin);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.branchId, foreign);
  assert.equal(r.json.data.branchFixed, false);
  assert.equal(
    (await options('?teacherId=' + teacherId + '&branchId=' + foreign, admin))
      .status,
    404,
  );
});
for (const role of ['teacher', 'student'] as const)
  test(role + ' cannot read options/history or create/revoke', async () => {
    const token = (await actor(role, branch)).token;
    for (const path of [
      '/teacher-assignments/options',
      '/teacher-assignments/teachers/' + teacherId,
    ])
      assert.equal((await http(path, token)).status, 403);
    assert.equal(
      (await http('/teacher-assignments', token, input())).status,
      403,
    );
    assert.equal(
      (
        await http(
          '/teacher-assignments/' + new mongoose.Types.ObjectId() + '/revoke',
          token,
          {},
          'PATCH',
        )
      ).status,
      403,
    );
  });
test('missing session, permission, current role, inactive actor and revocation fail closed', async () => {
  assert.equal((await http('/teacher-assignments/options')).status, 401);
  ROLE_PERMISSIONS.principal = grants.filter(
    p => p !== PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE,
  );
  assert.equal((await options()).status, 403);
  ROLE_PERMISSIONS.principal = [...grants];
  const login = await Session.findOne({ token: principal });
  assert.ok(login);
  await User.updateOne({ _id: login.userId }, { $set: { role: 'teacher' } });
  assert.equal((await options()).status, 401);
  await User.updateOne(
    { _id: login.userId },
    { $set: { role: 'principal', isActive: false } },
  );
  assert.equal((await options()).status, 401);
  await User.updateOne({ _id: login.userId }, { $set: { isActive: true } });
  await Session.updateOne({ _id: login._id }, { $set: { isRevoked: true } });
  assert.equal((await options()).status, 401);
});
test('Principal foreign branch/Teacher/history and cross-product class queries are concealed', async () => {
  assert.equal((await options('?branchId=' + foreign)).status, 404);
  assert.equal((await options('?teacherId=' + foreignTeacher)).status, 404);
  assert.equal(
    (await http('/teacher-assignments/teachers/' + foreignTeacher, principal))
      .status,
    404,
  );
  const c = await new SchoolClass({
    branchId: foreign,
    name: 'Foreign class',
    code: 'FC',
    academicYear: '2026',
  }).save();
  assert.equal((await options('?classId=' + c._id)).status, 404);
});
test('current Principal branch change refreshes scope and rejects old Teacher context', async () => {
  const login = await Session.findOne({ token: principal });
  assert.ok(login);
  await User.updateOne({ _id: login.userId }, { $set: { branchId: foreign } });
  assert.equal((await options()).json.data.branchId, foreign);
  assert.equal((await options('?teacherId=' + teacherId)).status, 404);
});
test('inactive branches, Teachers and academic choices are excluded/rejected', async () => {
  await User.updateOne({ _id: teacherId }, { $set: { isActive: false } });
  assert.equal(
    (await options('?teacherId=' + teacherId)).json.data.selectedTeacher
      .isActive,
    false,
  );
  assert.equal((await options()).json.data.teachers.total, 0);
  assert.equal(
    (await http('/teacher-assignments', principal, input())).status,
    403,
  );
  await SchoolClass.updateOne({ _id: classId }, { $set: { isActive: false } });
  assert.equal((await options('?classId=' + classId)).status, 404);
  await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
  assert.equal((await options()).status, 403);
});
for (const query of [
  '?branchId=bad',
  '?teacherId=bad',
  '?classId=bad',
  '?offset=-1',
  '?teacherId[$ne]=x',
  '?role=super_admin',
])
  test('strict lookup contract ' + query, async () =>
    assert.equal((await options(query)).status, 400),
  );
test('literal search and bounded pages do not leak unrelated/private users', async () => {
  await User.updateOne(
    { _id: teacherId },
    { $set: { fullName: 'Alice [Math]', phone: 'PRIVATE-PHONE' } },
  );
  const r = await options('?search=' + encodeURIComponent('[Math]'));
  assert.equal(r.status, 200);
  assert.equal(r.json.data.teachers.total, 1);
  assert.equal(JSON.stringify(r.json).includes('PRIVATE-PHONE'), false);
  assert.equal(
    (await options('?search=' + encodeURIComponent('.*'))).json.data.teachers
      .total,
    0,
  );
});
test('history labels, state and revoke preserve audit confidentiality and stop authority', async () => {
  const created = await http('/teacher-assignments', principal, input());
  assert.equal(created.status, 201);
  let history = await http(
    '/teacher-assignments/teachers/' + teacherId,
    principal,
  );
  assert.equal(history.status, 200);
  const row = history.json.data.items[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      'assignmentId',
      'className',
      'sectionName',
      'subjectName',
      'validFrom',
      'validUntil',
      'status',
      'canRevoke',
    ].sort(),
  );
  assert.equal(row.status, 'active');
  assert.equal((await http('/teacher/classes', teacher)).json.data.length, 1);
  assert.equal(
    (
      await http(
        '/teacher-assignments/' + created.json.data.assignmentId + '/revoke',
        principal,
        {},
        'PATCH',
      )
    ).status,
    200,
  );
  history = await http('/teacher-assignments/teachers/' + teacherId, principal);
  assert.equal(history.json.data.items[0].status, 'revoked');
  assert.equal(history.json.data.items[0].canRevoke, false);
  assert.equal((await http('/teacher/classes', teacher)).json.data.length, 0);
  assert.equal(await TeacherAssignment.countDocuments(), 1);
});
test('current assignments distinguish upcoming, expired and unavailable references', async () => {
  const created = await http(
    '/teacher-assignments',
    admin,
    input({ validFrom: '2090-01-01T00:00:00Z' }),
  );
  assert.equal(created.status, 201);
  assert.equal(
    (await http('/teacher-assignments/teachers/' + teacherId, admin)).json.data
      .items[0].status,
    'upcoming',
  );
  await Subject.updateOne({ _id: subjectId }, { $set: { isActive: false } });
  assert.equal(
    (await http('/teacher-assignments/teachers/' + teacherId, admin)).json.data
      .items[0].status,
    'unavailable',
  );
});
test('inactive Teacher history remains revocable without creating new authority', async () => {
  const created = await http('/teacher-assignments', principal, input());
  assert.equal(created.status, 201);
  await User.updateOne({ _id: teacherId }, { $set: { isActive: false } });
  const h = await http('/teacher-assignments/teachers/' + teacherId, principal);
  assert.equal(h.status, 200);
  assert.equal(h.json.data.teacher.isActive, false);
  assert.equal(h.json.data.items[0].status, 'unavailable');
  assert.equal(
    (await http('/teacher-assignments', principal, input())).status,
    403,
  );
  assert.equal(
    (
      await http(
        '/teacher-assignments/' + created.json.data.assignmentId + '/revoke',
        principal,
        {},
        'PATCH',
      )
    ).status,
    200,
  );
  assert.equal(await TeacherAssignment.countDocuments(), 1);
});
test('existing POST enforces mismatches, trusted IDs only, duplicates and Principal scope', async () => {
  for (const changes of [
    { sectionId: otherSection },
    { subjectId: foreignSubject },
    { teacherId: foreignTeacher },
  ])
    assert.equal(
      (await http('/teacher-assignments', principal, input(changes))).status,
      404,
    );
  assert.equal(
    (
      await http(
        '/teacher-assignments',
        principal,
        input({ teacherName: 'spoofed' }),
      )
    ).status,
    400,
  );
  const result = await Promise.all([
    http('/teacher-assignments', admin, input()),
    http('/teacher-assignments', admin, input()),
  ]);
  assert.deepEqual(result.map(r => r.status).sort(), [201, 409]);
  assert.equal(await TeacherAssignment.countDocuments(), 1);
});
test('full account-to-assignment-to-Teacher-login flow scopes roster, periods, attendance, notices and tasks', async () => {
  const login = await Session.findOne({ token: admin });
  assert.ok(login);
  await User.updateOne(
    { _id: login.userId },
    { $set: { password: await hashPassword('AdminFixturePassword123!') } },
  );
  const adminUser = await User.findById(login.userId);
  assert.ok(adminUser);
  await Session.deleteMany({ token: admin });
  const administrator = await http('/auth/login', undefined, {
    email: adminUser.email,
    password: 'AdminFixturePassword123!',
  });
  assert.equal(administrator.status, 200);
  const account = await http(
    '/admin/teachers',
    administrator.json.accessToken,
    {
      fullName: 'Ayesha Khan',
      email: 'ayesha@test.invalid',
      password: 'TeacherFixturePassword123!',
      branchId: branch,
    },
  );
  assert.equal(account.status, 201);
  assert.equal(
    (
      await options(
        '?teacherId=' + account.json.data.id,
        administrator.json.accessToken,
      )
    ).json.data.selectedTeacher.fullName,
    'Ayesha Khan',
  );
  const created = await http(
    '/teacher-assignments',
    administrator.json.accessToken,
    input({ teacherId: account.json.data.id }),
  );
  assert.equal(created.status, 201);
  await Session.updateMany(
    { token: administrator.json.accessToken },
    { $set: { isRevoked: true } },
  );
  const signed = await http('/auth/login', undefined, {
    email: 'ayesha@test.invalid',
    password: 'TeacherFixturePassword123!',
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.json.user.role, 'teacher');
  const token = signed.json.accessToken;
  const student = (await actor('student', branch)).id;
  await new Student({
    userId: student,
    branchId: branch,
    classId,
    sectionId,
    admissionNumber: 'OWN-LEARNER',
  }).save();
  const other = (await actor('student', branch)).id;
  await new Student({
    userId: other,
    branchId: branch,
    classId: otherClass,
    sectionId: otherSection,
    admissionNumber: 'UNRELATED-LEARNER',
  }).save();
  const classes = await http('/teacher/classes', token);
  assert.equal(classes.json.data.length, 1);
  assert.equal(classes.json.data[0].classId, classId);
  const roster = await http(
    `/teacher/classes/${classId}/sections/${sectionId}/subjects/${subjectId}/students`,
    token,
  );
  assert.equal(roster.status, 200);
  assert.deepEqual(
    roster.json.data.students.map((s: any) => s.admissionNumber),
    ['OWN-LEARNER'],
  );
  assert.equal(
    (await http('/teacher/classes/' + otherClass, token)).status,
    404,
  );
  const version = await TimetableVersion.create({
    branchId: branch,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: '2026-01-01',
    effectiveUntil: '2026-12-31',
    periodCount: 2,
    createdBy: login.userId,
    approvedBy: login.userId,
    approvedAt: new Date(),
  });
  const period = await TimetablePeriod.create({
    timetableVersionId: version._id,
    branchId: branch,
    teacherId: account.json.data.id,
    classId,
    sectionId,
    subjectId,
    dayOfWeek: 3,
    startTime: '08:00',
    endTime: '09:00',
    room: 'Room 1',
  });
  const denied = await TimetablePeriod.create({
    timetableVersionId: version._id,
    branchId: branch,
    teacherId,
    classId: otherClass,
    sectionId: otherSection,
    subjectId,
    dayOfWeek: 3,
    startTime: '09:00',
    endTime: '10:00',
    room: 'Room 2',
  });
  const timetable = await http('/teacher/timetable?date=2026-10-14', token);
  assert.equal(timetable.json.data.periods.length, 1);
  assert.equal(
    (
      await http(
        `/teacher/timetable/periods/${denied._id}?date=2026-10-14`,
        token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        `/teacher/attendance/occurrences/${period._id}?date=2026-10-14`,
        token,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await http(
        `/teacher/attendance/occurrences/${denied._id}?date=2026-10-14`,
        token,
      )
    ).status,
    404,
  );
  const draft = await http('/teacher/notices', token, {
    audienceType: 'class_students',
    classId,
    sectionId,
    subjectId,
    title: 'Class notice',
    body: 'Bring your books',
    language: 'en',
  });
  assert.equal(draft.status, 200);
  assert.equal(
    (
      await http('/teacher/notices/preview', token, {
        audienceType: 'class_students',
        classId: otherClass,
        sectionId: otherSection,
        subjectId,
      })
    ).status,
    404,
  );
  assert.equal((await http('/teacher/inbox', token)).json.data.total, 1);
  assert.equal((await http('/teacher/tasks', token)).json.data.total, 0);
  const work = await http('/assigned-work', principal, {
    assigneeUserId: account.json.data.id,
    sourceType: 'coordinator_follow_up',
    title: 'Own follow-up',
    summary: 'Assigned operational work',
  });
  assert.equal(work.status, 200);
  assert.equal((await http('/teacher/tasks', token)).json.data.total, 1);
});
