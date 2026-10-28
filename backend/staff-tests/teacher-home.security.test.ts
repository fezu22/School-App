import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
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
import SchoolNotice from '../src/staff/src/models/schoolNotice';
import { AssignedWork } from '../src/staff/src/models/assignedWork';
import {
  AttendanceSession,
  ensureAttendanceIndexes,
} from '../src/staff/src/models/periodAttendance';
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
  schoolDateTime,
  scheduleWeekday,
  addScheduleDays,
} from '../src/staff/src/services/school-date.service';
import { getTeacherWorkAttention } from '../src/staff/src/services/teacher-work.service';
import { homePeriodState } from '../src/staff/src/services/teacher-home.service';
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
const http = async (path = '/teacher/home', token = teacher.token) => {
  const r = await fetch(base + path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  return {
    status: r.status,
    json: (await r.json()) as any,
    cache: r.headers.get('Cache-Control'),
  };
};
const work = async (extra: Record<string, unknown> = {}) =>
  AssignedWork.create({
    branchId: branch,
    assigneeUserId: teacher.id,
    assigneeRole: 'teacher',
    sourceType: 'class_follow_up',
    sourceId: classId,
    sectionId,
    subjectId,
    title: 'Urgent follow-up',
    summary: 'Review this class',
    priority: 'high',
    assignedBy: other.id,
    ...extra,
  });
const notice = async (extra: Record<string, unknown> = {}) =>
  new SchoolNotice({
    branchId: branch,
    title: 'Important school notice',
    message: 'Review the published instructions',
    priority: 'urgent',
    status: 'published',
    audienceRoles: ['teacher'],
    createdBy: other.id,
    ...extra,
  }).save();
before(async () => {
  process.env.JWT_SECRET = 'teacher-home-owned-test-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { autoIndex: false });
  await Promise.all([
    ensureTimetableIndexes(),
    ensureAttendanceIndexes(),
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
test('own minimal projection uses real Teacher, school date, authorized occurrence and no-store', async () => {
  const r = await http();
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store');
  const d = r.json.data;
  assert.deepEqual(d.teacher, {
    id: String(teacher.id),
    fullName: 'Teacher Ayesha',
  });
  assert.equal(d.schoolDate, schoolToday());
  assert.equal(d.hero.currentOrNextPeriod.periodId, String(period._id));
  assert.equal(d.hero.currentOrNextPeriod.room, 'Room 204');
  assert.deepEqual(
    Object.keys(d).sort(),
    ['teacher', 'schoolDate', 'timezone', 'hero', 'primaryAction'].sort(),
  );
  assert.equal(JSON.stringify(d).includes('private-test-hash'), false);
});
test('unassigned Teacher has safe empty Home even if timetable names them', async () => {
  await TeacherAssignment.deleteMany({});
  const d = (await http()).json.data;
  assert.equal(d.hero.state, 'no_periods');
  assert.equal(d.hero.currentOrNextPeriod, null);
  assert.equal(d.primaryAction, null);
});
test('foreign branch periods, work and notices are excluded', async () => {
  await TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { teacherId: other.id } },
  );
  await work({ branchId: foreign });
  await notice({ branchId: foreign });
  const d = (await http()).json.data;
  assert.equal(d.hero.periodCount, 0);
  assert.equal(d.primaryAction, null);
});
test('same-branch unassigned class data is excluded', async () => {
  await TeacherAssignment.deleteMany({});
  await work();
  const d = (await http()).json.data;
  assert.equal(d.hero.periodCount, 0);
  assert.equal(d.primaryAction, null);
});
test('approved substitute occurrence uses effective room/time and does not require permanent tuple', async () => {
  await TeacherAssignment.deleteMany({});
  await TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { teacherId: other.id } },
  );
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: other.id,
    substituteTeacherId: teacher.id,
    date: schoolToday(),
    startTime: '00:01',
    endTime: '23:58',
    room: 'Effective room',
    status: 'approved',
    createdBy: other.id,
  });
  const d = (await http()).json.data;
  assert.equal(d.hero.currentOrNextPeriod.isSubstitute, true);
  assert.equal(d.hero.currentOrNextPeriod.room, 'Effective room');
  assert.equal(d.hero.currentOrNextPeriod.startTime, '00:01');
  assert.equal(d.primaryAction.count, 1);
});
test('replacement conceals original Teacher occurrence', async () => {
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: teacher.id,
    substituteTeacherId: other.id,
    date: schoolToday(),
    startTime: '00:00',
    endTime: '23:59',
    room: 'Effective room',
    status: 'approved',
    createdBy: other.id,
  });
  const d = (await http()).json.data;
  assert.equal(d.hero.periodCount, 0);
  assert.equal(d.primaryAction, null);
});
test('attendance count exactly matches queue and submitted attendance removes primary action', async () => {
  const d = (await http()).json.data,
    q = await http('/teacher/attendance/pending');
  assert.equal(d.primaryAction.type, 'attendance');
  assert.equal(d.primaryAction.count, q.json.data.total);
  await AttendanceSession.create({
    branchId: branch,
    periodId: period._id,
    timetableVersionId: version._id,
    date: schoolToday(),
    classId,
    sectionId,
    subjectId,
    responsibleTeacherId: teacher.id,
    rosterVersion: 'test-roster',
    state: 'submitted',
  });
  assert.equal((await http()).json.data.primaryAction, null);
});
test('attendance wins over urgent work and important notices', async () => {
  await work();
  await notice();
  assert.equal((await http()).json.data.primaryAction.type, 'attendance');
});
test('urgent work selects Tasks and exact full authorized queue count beyond first page', async () => {
  await TimetablePeriod.deleteMany({});
  await work();
  for (let i = 0; i < 52; i++) await work({ priority: 'normal' });
  await notice();
  const d = (await http()).json.data,
    q = await http('/teacher/tasks');
  assert.equal(d.primaryAction.type, 'work');
  assert.equal(d.primaryAction.count, 53);
  assert.equal(d.primaryAction.count, q.json.data.total);
});
test('overdue normal work is actionable; completed work disappears', async () => {
  await TimetablePeriod.deleteMany({});
  const w = await work({
    priority: 'normal',
    dueAt: new Date(Date.now() - 1000),
  });
  assert.equal((await http()).json.data.primaryAction.type, 'work');
  await AssignedWork.updateOne(
    { _id: w._id },
    { $set: { status: 'completed' } },
  );
  assert.equal((await http()).json.data.primaryAction, null);
});
test('normal future work does not create a primary action', async () => {
  await TimetablePeriod.deleteMany({});
  await work({ priority: 'normal', dueAt: new Date(Date.now() + 86400000) });
  assert.equal((await http()).json.data.primaryAction, null);
});
test('important notice selection follows published Teacher Inbox audience and expiry', async () => {
  await TimetablePeriod.deleteMany({});
  await notice({ audienceRoles: undefined, title: 'Hidden legacy' });
  await notice({ status: 'draft', title: 'Hidden draft' });
  await notice({
    expiresAt: new Date(Date.now() - 1000),
    title: 'Hidden expired',
  });
  await notice({ priority: 'normal', title: 'Normal notice' });
  const n = await notice();
  const d = (await http()).json.data,
    q = await http('/teacher/inbox');
  assert.equal(d.primaryAction.type, 'notice');
  assert.equal(d.primaryAction.noticeId, String(n._id));
  assert.ok(
    q.json.data.items.some((i: any) => i.noticeId === d.primaryAction.noticeId),
  );
  assert.equal('count' in d.primaryAction, false);
});
test('revoked academic assignment removes period and class work immediately', async () => {
  await work();
  await TeacherAssignment.updateMany({}, { $set: { isActive: false } });
  const d = (await http()).json.data;
  assert.equal(d.hero.currentOrNextPeriod, null);
  assert.equal(d.primaryAction, null);
});
test('inactive Teacher is denied', async () => {
  await User.updateOne({ _id: teacher.id }, { $set: { isActive: false } });
  assert.equal((await http()).status, 401);
});
test('revoked or unregistered session is denied', async () => {
  await Session.updateMany(
    { token: teacher.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await http()).status, 401);
  await Session.deleteMany({});
  assert.equal((await http()).status, 401);
});
for (const role of ['student', 'principal', 'super_admin'] as const)
  test(role + ' cannot use Teacher Home', async () => {
    assert.equal(
      (await http('/teacher/home', (await actor(role)).token)).status,
      403,
    );
  });
test('inactive or missing branch fails closed', async () => {
  await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
  assert.equal((await http()).status, 403);
});
for (const query of [
  '?teacherId=invalid',
  '?branchId=000000000000000000000001',
  '?classId[$ne]=x',
  '?date=2026-10-14',
])
  test('Home rejects caller scope override ' + query, async () => {
    assert.equal((await http('/teacher/home' + query)).status, 400);
  });
test('missing or malformed authentication is denied', async () => {
  assert.equal((await http('/teacher/home', '')).status, 401);
  assert.equal((await http('/teacher/home', 'bad-token')).status, 401);
});
test('source permission removal fails closed instead of showing false caught-up state', async () => {
  ROLE_PERMISSIONS.teacher = grants.filter(
    p => p !== PERMISSIONS.TEACHER_WORK_VIEW,
  );
  assert.equal((await http()).status, 403);
});
test('clock resolver distinguishes current, next, finished and empty with exclusive end', () => {
  const p = { startTime: '08:00', endTime: '09:00' } as any;
  assert.equal(homePeriodState([p], '08:00').state, 'current');
  assert.equal(homePeriodState([p], '07:59').state, 'next');
  assert.equal(homePeriodState([p], '09:00').state, 'finished');
  assert.equal(homePeriodState([], '08:00').state, 'no_periods');
});
for (const state of ['future', 'expired'] as const)
  test(
    state + ' assignment cannot authorize Home period or class work',
    async () => {
      await work();
      await TeacherAssignment.collection.updateMany(
        {},
        {
          $set:
            state === 'future'
              ? { validFrom: new Date(Date.now() + 86400000) }
              : { validUntil: new Date(Date.now() - 1000) },
        },
      );
      const d = (await http()).json.data;
      assert.equal(d.hero.periodCount, 0);
      assert.equal(d.primaryAction, null);
    },
  );
test('guessed Home object path has no object lookup surface', async () => {
  const r = await fetch(
    base + '/teacher/home/' + new mongoose.Types.ObjectId(),
    { headers: { Authorization: 'Bearer ' + teacher.token } },
  );
  assert.equal(r.status, 404);
});

const afternoonPeriod = () =>
  TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { startTime: '14:00', endTime: '15:00' } },
  );
const attention = () =>
  getTeacherWorkAttention({ userId: String(teacher.id), role: 'teacher' });
const assertPendingCount = async (expected: number) => {
  const queue = await http('/teacher/attendance/pending'),
    home = await http();
  assert.equal(queue.status, 200);
  assert.equal(home.status, 200);
  assert.equal(queue.json.data.total, expected);
  assert.equal(queue.json.data.sessions.length, expected);
  if (expected)
    assert.deepEqual(home.json.data.primaryAction, {
      type: 'attendance',
      count: expected,
      routeTarget: 'TeacherAttendanceQueue',
    });
  else assert.notEqual(home.json.data.primaryAction?.type, 'attendance');
};
for (const [label, instant, expected] of [
  ['10:00 before a 14:00 start', '2026-10-14T05:00:00Z', 0],
  ['one millisecond before start', '2026-10-14T08:59:59.999Z', 0],
  ['exactly at start', '2026-10-14T09:00:00Z', 1],
  ['already started', '2026-10-14T09:30:00Z', 1],
  ['completed but not submitted', '2026-10-14T11:00:00Z', 1],
] as const)
  test('shared Pending/Home timing: ' + label, async () => {
    await afternoonPeriod();
    mock.timers.setTime(Date.parse(instant));
    await assertPendingCount(expected);
    assert.equal(await AttendanceSession.countDocuments(), 0);
  });
test('next-day approved occurrences are not pending', async () => {
  const tomorrow = addScheduleDays(schoolToday(), 1);
  await TimetableVersion.collection.updateOne(
    { _id: version._id },
    { $set: { effectiveUntil: addScheduleDays(tomorrow, 1) } },
  );
  await TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { dayOfWeek: scheduleWeekday(tomorrow) } },
  );
  const q = await http('/teacher/attendance/pending?date=' + tomorrow);
  assert.equal(q.status, 200);
  assert.equal(q.json.data.total, 0);
  await assertPendingCount(0);
  assert.equal(await AttendanceSession.countDocuments(), 0);
});
test('substitute pending uses effective start rather than original start', async () => {
  await TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { teacherId: other.id } },
  );
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: other.id,
    substituteTeacherId: teacher.id,
    date: schoolToday(),
    startTime: '14:00',
    endTime: '15:00',
    room: 'Effective room',
    status: 'approved',
    createdBy: other.id,
  });
  await assertPendingCount(0);
  mock.timers.setTime(Date.parse('2026-10-14T09:00:00Z'));
  await assertPendingCount(1);
  const queue = (await http('/teacher/attendance/pending')).json.data;
  assert.equal(queue.sessions[0].period.isSubstitute, true);
  assert.equal(queue.sessions[0].period.room, 'Effective room');
});
test('pre-marking remains allowed but future sessions stay outside Pending', async () => {
  // Only this new attendance-write fixture requires managed curriculum.
  await seedCurriculumFixtures();
  await afternoonPeriod();
  const opened = await http(
    `/teacher/attendance/occurrences/${period._id}?date=${schoolToday()}`,
  );
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  assert.equal(await AttendanceSession.countDocuments(), 1);
  await assertPendingCount(0);
  await AttendanceSession.updateMany({}, { $set: { state: 'submitted' } });
  mock.timers.setTime(Date.parse('2026-10-14T09:00:00Z'));
  await assertPendingCount(0);
  const stored = await AttendanceSession.findOne();
  assert.equal(stored?.state, 'submitted');
});
for (const kind of ['work', 'notice', 'none'] as const)
  test('future attendance does not preempt ' + kind, async () => {
    await afternoonPeriod();
    if (kind === 'work') {
      await work();
      await notice();
    } else if (kind === 'notice') await notice();
    await assertPendingCount(0);
    const action = (await http()).json.data.primaryAction;
    if (kind === 'none') assert.equal(action, null);
    else assert.equal(action.type, kind);
  });
test('school date/time uses configured timezone across midnight', () => {
  process.env.SCHOOL_TIMEZONE = 'America/Los_Angeles';
  assert.deepEqual(schoolDateTime(new Date('2026-10-14T00:00:00Z')), {
    date: '2026-10-13',
    time: '17:00',
  });
  process.env.SCHOOL_TIMEZONE = 'Pacific/Auckland';
  assert.deepEqual(schoolDateTime(new Date('2026-10-14T12:00:00Z')), {
    date: '2026-10-15',
    time: '01:00',
  });
});
test('coherent work fold: empty and non-urgent undated/null/future work', async () => {
  await TimetablePeriod.deleteMany({});
  assert.deepEqual(await attention(), { total: 0, needsAttention: false });
  await work({ priority: 'normal' });
  await work({ priority: 'normal', dueAt: null });
  await work({ priority: 'normal', dueAt: new Date(Date.now() + 86400000) });
  assert.deepEqual(await attention(), { total: 3, needsAttention: false });
  assert.equal((await http()).json.data.primaryAction, null);
});
for (const mode of ['high', 'overdue'] as const)
  test('coherent work fold: ' + mode + ' plus full open queue', async () => {
    await TimetablePeriod.deleteMany({});
    await work(
      mode === 'high'
        ? {}
        : { priority: 'normal', dueAt: new Date(Date.now() - 1) },
    );
    await work({ priority: 'normal' });
    await work({ status: 'completed' });
    await work({ assigneeUserId: other.id });
    assert.deepEqual(await attention(), { total: 2, needsAttention: true });
    const q = await http('/teacher/tasks'),
      home = await http();
    assert.equal(home.json.data.primaryAction.type, 'work');
    assert.equal(home.json.data.primaryAction.count, q.json.data.total);
    assert.equal(q.json.data.total, 2);
  });
test('coherent attention count includes all pages', async () => {
  await TimetablePeriod.deleteMany({});
  await work();
  for (let i = 0; i < 51; i++) await work({ priority: 'normal' });
  assert.deepEqual(await attention(), { total: 52, needsAttention: true });
  const q = (await http('/teacher/tasks')).json.data,
    home = (await http()).json.data;
  assert.equal(q.items.length, 50);
  assert.equal(q.total, 52);
  assert.equal(home.primaryAction.count, 52);
});
test('legacy split-read interleaving cannot create a zero-count task action', async () => {
  await TimetablePeriod.deleteMany({});
  let separateReads = 0;
  mock.method(
    AssignedWork,
    'countDocuments',
    () =>
      ({
        read: async () => {
          separateReads++;
          return 0;
        },
      } as any),
  );
  mock.method(
    AssignedWork,
    'exists',
    () =>
      ({
        read: async () => {
          separateReads++;
          const inserted = await work();
          return { _id: inserted._id };
        },
      } as any),
  );
  assert.deepEqual(await attention(), { total: 0, needsAttention: false });
  assert.equal((await http()).json.data.primaryAction, null);
  assert.equal(separateReads, 0);
  assert.equal(await AssignedWork.collection.countDocuments({}), 0);
});
test('insert after one aggregate evaluation cannot tear Home count from urgency', async () => {
  await TimetablePeriod.deleteMany({});
  await work();
  const aggregate = AssignedWork.aggregate;
  let changed = false,
    attentionQueries = 0;
  mock.method(
    AssignedWork,
    'aggregate',
    function (this: typeof AssignedWork, pipeline: any[], ...args: any[]) {
      const result = (aggregate as any).call(this, pipeline, ...args);
      if (pipeline.some(stage => stage.$group?.urgent)) {
        attentionQueries++;
        const read = result.read.bind(result);
        result.read = async (...readArgs: any[]) => {
          const rows = await read(...readArgs);
          if (!changed) {
            changed = true;
            await work({ priority: 'normal' });
          }
          return rows;
        };
      }
      return result;
    },
  );
  const first = (await http()).json.data.primaryAction;
  assert.deepEqual(first, { type: 'work', count: 1, routeTarget: 'Tasks' });
  assert.equal(attentionQueries, 1);
  assert.equal(
    await AssignedWork.collection.countDocuments({ status: 'open' }),
    2,
  );
  const second = (await http()).json.data.primaryAction;
  assert.deepEqual(second, { type: 'work', count: 2, routeTarget: 'Tasks' });
});
