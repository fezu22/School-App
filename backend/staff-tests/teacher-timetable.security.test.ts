import Room from '../src/staff/src/models/room';
import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { request as nodeRequest, type Server } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, { type UserRole } from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import Session from '../src/staff/src/models/session';
import Student from '../src/staff/src/models/student';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import type { TeacherAssignmentTuple } from '../src/staff/src/services/teacher-scope.service';
import { createTimetableVersion, timetableOptions, listTimetableVersions } from '../src/staff/src/services/timetable-admin.service';
import {getTeacherHome} from '../src/staff/src/services/teacher-home.service';
import {createLiveLessonService, lessonInstant} from '../src/staff/src/services/live-lesson.service';
import {
  getTeacherTimetable,
  type TeacherPeriodDTO,
} from '../src/staff/src/services/teacher-timetable.service';
import {
  ensureTimetableIndexes,
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  TimetableIssue,
} from '../src/staff/src/models/timetable';
import {
  schoolToday,
  scheduleWeekday,
  addScheduleDays,
} from '../src/staff/src/services/school-date.service';

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
let roomIds: Map<string,string>;
const roomNames = ['Room 8','Approved revised room','Revised 2','Wednesday','Another room','Room'];
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
const detail = (id: Id | string, person: Actor | undefined = teacherA) =>
  http(`/teacher/classes/${id}`, person);
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
    Room,
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
  roomIds = new Map((await Room.insertMany(roomNames.map((name,i) => ({branchId:branchA,name,code:'R'+i,category:'classroom',createdBy:principal.id,updatedBy:principal.id})))).map(row=>[row.name,String(row._id)]));
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
  roomId: roomIds.get(String(extra.room ?? 'Room 8')),
  room: 'Room 8',
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
const todayQueue = (person = teacherA, query = '') =>
  http<{ periods: TeacherPeriodDTO[]; today: string; timezone: string }>(
    '/teacher/timetable' + query,
    person,
  );
const periodDetail = (id: string, date = nowDate, person = teacherA) =>
  http<TeacherPeriodDTO>(
    `/teacher/timetable/periods/${id}?date=${date}`,
    person,
  );
const ack = (id: string, person = teacherB, date = nowDate) =>
  http<TeacherPeriodDTO>(
    `/teacher/timetable/periods/${id}/acknowledge`,
    person,
    'POST',
    { date },
  );
const issue = (
  id: string,
  person = teacherA,
  reason: unknown = ' Room mismatch ',
  clientOperationId: unknown = 'operation_default_0001',
) =>
  http<TeacherPeriodDTO>(
    `/teacher/timetable/periods/${id}/issues`,
    person,
    'POST',
    { date: nowDate, reason, clientOperationId },
  );
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
      roomId: roomIds.get(String(extra.room ?? 'Approved revised room')),
      room: 'Approved revised room',
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

test('eligible Teachers follow exact Class Section Subject assignment and current active catalog', async () => {
  const path = `/timetables/options?classId=${class9}&sectionId=${section9B}&subjectId=${physics}`;
  const result = await http<Awaited<ReturnType<typeof timetableOptions>>>(
    path,
    principal
  );
  assert.equal(result.status, 200, result.raw);
  assert.deepEqual(
    result.data.teachers.map((t) => t.id),
    [String(teacherA.id)]
  );
  assert.equal(
    (
      await http(
        `/timetables/options?classId=${class9}&sectionId=${section8A}&subjectId=${physics}`,
        principal
      )
    ).status,
    404
  );
  assert.equal(
    (await http(path + `&branchId=${branchB}`, principal)).status,
    403
  );
  assert.equal(
    (await http(`/timetables/options?classId=${class9}`, principal)).status,
    400
  );
  await Section.updateOne()
    .where('_id')
    .equals(section9B)
    .set({ isActive: false });
  assert.equal((await http(path, principal)).status, 404);
});

test('a branch-bound Super Admin cannot bypass canonical global administration scope', async () => {
  const admin = await actor('scoped-admin', 'super_admin', branchA);
  assert.equal(
    (await http(`/timetables/options?branchId=${branchB}`, admin)).status,
    403
  );
  assert.equal(
    (await version({ branchId: String(branchA), versionNumber: 2 }, admin))
      .status,
    403
  );
});

test('approval cannot publish an assignment revoked between initial validation and the transaction fence', async () => {
  const draft = await version({ versionNumber: 2 });
  assert.equal(draft.status, 201);
  const original = TeacherAssignment.collection.updateOne.bind(
    TeacherAssignment.collection
  );
  let changed = false;
  mock.method(
    TeacherAssignment.collection,
    'updateOne',
    async (...args: Parameters<typeof original>) => {
      if (!changed && args[2]?.session) {
        changed = true;
        await original({ _id: args[0]._id }, { $set: { isActive: false } });
      }
      return original(...args);
    }
  );
  assert.equal((await approve(draft.data.versionId)).status, 404);
  assert.equal(
    (await TimetableVersion.findById(draft.data.versionId))?.status,
    'draft'
  );
});

test('approval rejects an imported draft with an invalid clock window', async () => {
  const draft = await version({ versionNumber: 2 });
  assert.equal(draft.status, 201);
  await TimetablePeriod.collection.updateMany(
    { timetableVersionId: new mongoose.Types.ObjectId(draft.data.versionId) },
    { $set: { endTime: '01:00' } }
  );
  assert.equal((await approve(draft.data.versionId)).status, 400);
  assert.equal(
    (await TimetableVersion.findById(draft.data.versionId))?.status,
    'draft'
  );
});

test('Teacher eligibility distinguishes valid curriculum with no assignment from revoked and future responsibility', async () => {
  const path = `/timetables/options?classId=${class9}&sectionId=${section9B}&subjectId=${math}`;
  const result = await http<Awaited<ReturnType<typeof timetableOptions>>>(
    path,
    principal
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.teachers, []);
  await TeacherAssignment.collection.updateMany(
    { teacherId: teacherA.id },
    { $set: { validFrom: new Date('2027-01-01T00:00:00Z') } }
  );
  const future = await http<Awaited<ReturnType<typeof timetableOptions>>>(
    `/timetables/options?classId=${class9}&sectionId=${section9B}&subjectId=${physics}`,
    principal
  );
  assert.equal(future.status, 200);
  assert.deepEqual(future.data.teachers, []);
});

for (const action of ['create', 'approve', 'retire', 'substitute'] as const)
  test(`Principal Branch reassignment during ${action} cannot mutate the old Branch`, async () => {
    let draftId = '';
    if (action === 'approve') {
      const draft = await version({ versionNumber: 2 });
      assert.equal(draft.status, 201);
      draftId = draft.data.versionId;
    }
    const original = User.collection.updateOne.bind(User.collection);
    let changed = false;
    mock.method(
      User.collection,
      'updateOne',
      async (...args: Parameters<typeof original>) => {
        if (
          !changed &&
          String(args[0]._id) === String(principal.id) &&
          args[2]?.session
        ) {
          changed = true;
          await original(
            { _id: principal.id },
            { $set: { branchId: branchB } }
          );
        }
        return original(...args);
      }
    );
    const result =
      action === 'create'
        ? await version({ versionNumber: 2 })
        : action === 'approve'
        ? await approve(draftId)
        : action === 'retire'
        ? await http(
            `/timetables/versions/${versionId}/retire`,
            principal,
            'POST',
            {}
          )
        : await http('/timetables/substitutes', principal, 'POST', {
            periodId,
            substituteTeacherId: String(teacherB.id),
            date: nowDate,
            startTime: '11:00',
            endTime: '11:40',
            room: 'Room',
          });
    assert.equal(result.status, 403, result.raw);
    assert.equal(
      await TimetableVersion.countDocuments({
        versionNumber: 2,
        status: 'approved',
      }),
      0
    );
    assert.equal(
      (await TimetableVersion.findById(versionId))?.status,
      'approved'
    );
  });

test('timetable Class catalog uses existing scoped Academic Setup DTO independently of Teacher assignments', async () => {
  const result = await http<{
    items: {
      id: string;
      name: string;
      code: string;
      isActive: boolean;
      periodStatus: string;
      legacy: boolean;
    }[];
  }>('/academic-setup/classes', principal);
  assert.equal(result.status, 200, result.raw);
  const row = result.data.items.find((c) => c.id === String(class8));
  assert.ok(row);
  assert.equal(row.name, 'Class 8');
  assert.equal(row.code, '8');
  assert.equal(row.isActive, true);
  assert.equal(row.legacy, false);
  assert.equal(row.periodStatus, 'active');
  assert.ok(result.data.items.some((c) => c.id === String(class10))); // No tuple needed to browse a Class.
  assert.ok(!result.data.items.some((c) => c.id === String(foreignClass)));
  assert.equal(
    (await http(`/academic-setup/classes?branchId=${branchB}`, principal))
      .status,
    404
  );
  assert.equal((await http('/academic-setup/classes', undefined)).status, 401);
  assert.equal((await http('/academic-setup/classes', teacherA)).status, 403);
});

test('Super Admin Class catalog requires explicit valid Branch and returns only selected Branch Classes', async () => {
  const admin = await actor('class-browser', 'super_admin');
  const result = await http<{ items: { id: string }[] }>(
    `/academic-setup/classes?branchId=${branchB}`,
    admin
  );
  assert.equal(result.status, 200, result.raw);
  assert.deepEqual(
    result.data.items.map((c) => c.id),
    [String(foreignClass)]
  );
  assert.equal((await http('/academic-setup/classes', admin)).status, 400);
  await Branch.updateOne({ _id: branchB }, { $set: { isActive: false } });
  assert.equal(
    (await http(`/academic-setup/classes?branchId=${branchB}`, admin)).status,
    404
  );
});

test('Class catalog retains inactive and legacy metadata so timetable eligibility cannot masquerade as no Classes', async () => {
  await SchoolClass.updateOne()
    .where('_id')
    .equals(class9)
    .set({ isActive: false });
  await SchoolClass.collection.updateOne(
    { _id: class10 },
    { $unset: { academicPeriodId: '' } }
  );
  const result = await http<{
    items: {
      id: string;
      isActive: boolean;
      legacy: boolean;
      periodStatus: string;
    }[];
  }>('/academic-setup/classes', principal);
  assert.equal(result.status, 200);
  assert.equal(
    result.data.items.find((c) => c.id === String(class9))?.isActive,
    false
  );
  assert.equal(
    result.data.items.find((c) => c.id === String(class10))?.legacy,
    true
  );
  assert.equal(
    result.data.items.find((c) => c.id === String(class10))?.periodStatus,
    'legacy'
  );
});

test('admin read context derives Principal branch and eligible exact assignment tuples', async () => {
  const result = await http<Awaited<ReturnType<typeof timetableOptions>>>(
    `/timetables/options?teacherId=${teacherA.id}`,
    principal
  );
  assert.equal(result.status, 200);
  assert.equal(result.cache, 'no-store');
  assert.equal(result.data.branchFixed, true);
  assert.equal(result.data.branchId, String(branchA));
  assert.deepEqual(
    result.data.branches.map((b) => b.id),
    [String(branchA)]
  );
  assert.equal(result.data.timezone, 'Asia/Karachi');
  assert.ok(
    result.data.tuples.some(
      (t) =>
        t.classId === String(class8) &&
        t.sectionId === String(section8A) &&
        t.subjectId === String(math) &&
        t.academicPeriodId
    )
  );
  assert.equal(
    (await http(`/timetables/options?branchId=${branchB}`, principal)).status,
    403
  );
  assert.equal(
    (
      await http(
        `/timetables/options?teacherId=${foreignTeacher.id}`,
        principal
      )
    ).status,
    404
  );
  assert.equal((await http('/timetables/options', teacherA)).status, 403);
  assert.equal((await http('/timetables/options', undefined)).status, 401);
  assert.equal(
    (await http('/timetables/options?role=super_admin', principal)).status,
    400
  );
});

test('admin schedule browser returns immutable complete versions, safe labels and next revision', async () => {
  const result = await http<Awaited<ReturnType<typeof listTimetableVersions>>>(
    '/timetables/versions',
    principal
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.nextVersionNumber, 2);
  assert.equal(result.data.currentVersion?.versionId, versionId);
  assert.equal(result.data.items[0]?.versionId, versionId);
  assert.equal(result.data.items[0]?.periods[0]?.periodId, periodId);
  assert.equal(result.data.items[0]?.periods[0]?.teacherName, 'teacher-a');
  assert.ok(!result.raw.includes('private-password'));
  assert.equal(
    (await http(`/timetables/versions?branchId=${branchB}`, principal)).status,
    403
  );
  assert.equal(
    (await http('/timetables/versions?offset=-1', principal)).status,
    400
  );
  assert.equal((await http('/timetables/versions', teacherA)).status, 403);
});

test('Super Admin creates and approves a scoped schedule with exact day and 24-hour clocks', async () => {
  const admin = await actor('global-scheduler', 'super_admin');
  const created = await version(
    {
      branchId: String(branchA),
      versionNumber: 2,
      periods: [slot({ dayOfWeek: 0, startTime: '13:05', endTime: '14:00' })],
    },
    admin
  );
  assert.equal(created.status, 201, created.raw);
  const persisted = await TimetablePeriod.findOne({
    timetableVersionId: created.data.versionId,
  }).lean();
  assert.ok(persisted);
  assert.equal(persisted.dayOfWeek, 0);
  assert.equal(persisted.startTime, '13:05');
  assert.equal(persisted.endTime, '14:00');
  assert.equal((await approve(created.data.versionId, admin)).status, 200);
});

test('new admin draft publishes an upcoming occurrence to Teacher Home and authorized preview without room creation', async () => {
  const created = await version({
    versionNumber: 2,
    periods: [slot({ startTime: '11:10', endTime: '11:50' })],
  });
  assert.equal(created.status, 201, created.raw);
  assert.equal(
    (await getTeacherHome({ userId: String(teacherA.id), role: 'teacher' }))
      .hero.currentOrNextPeriod,
    null
  );
  assert.equal((await approve(created.data.versionId)).status, 200);
  const queue = await todayQueue();
  assert.equal(queue.data.periods.length, 1);
  const occurrence = queue.data.periods[0]!;
  assert.equal(occurrence.startTime, '11:10');
  assert.equal(occurrence.endTime, '11:50');
  assert.equal(occurrence.date, nowDate);
  const home = await http<Awaited<ReturnType<typeof getTeacherHome>>>(
    '/teacher/home',
    teacherA
  );
  assert.equal(home.status, 200, home.raw);
  assert.equal(home.data.hero.state, 'next');
  assert.equal(
    home.data.hero.currentOrNextPeriod?.periodId,
    occurrence.periodId
  );
  assert.equal(
    lessonInstant(nowDate, '11:10').toISOString(),
    '2026-10-13T06:10:00.000Z'
  );
  const preview = createLiveLessonService(() => ({
    name: 'preview-test',
    publicConfig: () => ({ provider: 'preview-test', appId: 1 }),
    roomId: () => {
      throw new Error('No room creation during preview');
    },
    issueCredential: () => {
      throw new Error('No credentials during preview');
    },
  }));
  assert.deepEqual(
    await preview.previewConfig(
      { userId: String(teacherA.id), role: 'teacher' },
      occurrence.periodId,
      nowDate
    ),
    { provider: 'preview-test', appId: 1 }
  );
  mock.timers.setTime(new Date('2026-10-13T06:20:00Z').getTime());
  assert.equal(
    (await getTeacherHome({ userId: String(teacherA.id), role: 'teacher' }))
      .hero.state,
    'current'
  );
});

test('schedule creation rejects overnight, malformed AM/PM, mismatched assignment and overlaps', async () => {
  for (const changes of [
    { startTime: '23:00', endTime: '01:00' },
    { startTime: '1:00 PM', endTime: '14:00' },
    { startTime: '11:00', endTime: '11:00' },
  ]) {
    assert.equal(
      (await version({ versionNumber: 2, periods: [slot(changes)] })).status,
      400
    );
  }
  assert.equal(
    (
      await version({
        versionNumber: 2,
        periods: [slot({ sectionId: String(section8B) })],
      })
    ).status,
    404
  );
  assert.equal(
    (
      await version({
        versionNumber: 2,
        periods: [slot(), slot({ startTime: '09:30', endTime: '10:00' })],
      })
    ).status,
    409
  );
});

test('Teacher operational queue returns only own current approved responsibility, with exact DTO', async () => {
  const own = await todayQueue();
  assert.equal(own.status, 200);
  assert.equal(own.cache, 'no-store');
  assert.equal(own.data.periods.length, 1);
  const row = own.data.periods[0];
  assert.equal(row.periodId, periodId);
  assert.equal(row.date, nowDate);
  assert.equal(row.room, 'Room 8');
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      'periodId',
      'date',
      'startTime',
      'endTime',
      'room',
      'classId',
      'className',
      'sectionId',
      'sectionName',
      'subjectId',
      'subjectName',
      'approvedVersion',
      'isSubstitute',
      'substituteId',
      'substituteStatus',
      'acknowledgedAt',
      'issueStatus',
      'canAcknowledgeSubstitute',
      'canRequestIssue',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(row.approvedVersion).sort(),
    ['versionId', 'versionNumber', 'effectiveFrom', 'effectiveUntil'].sort(),
  );
  assert.deepEqual((await todayQueue(teacherB)).data.periods, []);
  assert.equal((await periodDetail(periodId, nowDate, teacherB)).status, 404);
  for (const field of [
    'teacherId',
    'branchId',
    'password',
    'guardian',
    'approvedBy',
    'createdBy',
  ])
    assert.equal(own.raw.includes(field), false);
});

test('draft, future, expired and retired versions cannot displace Today', async () => {
  for (const extra of [
    { versionNumber: 2 },
    { versionNumber: 3, effectiveFrom: '2026-10-14' },
    {
      versionNumber: 4,
      effectiveFrom: '2026-09-01',
      effectiveUntil: '2026-10-01',
    },
    { versionNumber: 5 },
  ]) {
    const created = await version(extra);
    assert.equal(created.status, 201);
    if (extra.versionNumber !== 2)
      assert.equal((await approve(created.data.versionId)).status, 200);
    if (extra.versionNumber === 5)
      await http(
        `/timetables/versions/${created.data.versionId}/retire`,
        principal,
        'POST',
        {},
      );
  }
  assert.equal(
    (await todayQueue()).data.periods[0].approvedVersion.versionNumber,
    1,
  );
});

test('overlapping approved versions resolve deterministically to highest revision with exact approved time/room', async () => {
  const revised = await version({
    versionNumber: 2,
    periods: [
      slot({ startTime: '11:00', endTime: '11:50', room: 'Revised 2' }),
    ],
  });
  assert.equal((await approve(revised.data.versionId)).status, 200);
  const queue = await todayQueue();
  assert.equal(queue.data.periods.length, 1);
  assert.equal(queue.data.periods[0].startTime, '11:00');
  assert.equal(queue.data.periods[0].room, 'Revised 2');
  assert.equal((await periodDetail(periodId)).status, 404);
  assert.equal(
    await TimetablePeriod.countDocuments({ timetableVersionId: versionId }),
    1,
  );
  assert.equal(
    (await TimetableVersion.findById(versionId))?.status,
    'approved',
  );
});

test('week resolves version separately per civil date and retains effective bounds', async () => {
  const later = await version({
    versionNumber: 2,
    effectiveFrom: '2026-10-14',
    periods: [slot({ dayOfWeek: 3, room: 'Wednesday' })],
  });
  await approve(later.data.versionId);
  const queue = await http<{
    periods: TeacherPeriodDTO[];
    start: string;
    end: string;
  }>('/teacher/timetable/week?start=2026-10-13', teacherA);
  assert.equal(queue.status, 200);
  assert.equal(queue.data.start, '2026-10-13');
  assert.equal(queue.data.end, '2026-10-19');
  assert.deepEqual(
    queue.data.periods.map(p => [p.date, p.approvedVersion.versionNumber]),
    [
      ['2026-10-13', 1],
      ['2026-10-14', 2],
    ],
  );
  assert.equal(
    (await periodDetail(queue.data.periods[1].periodId, '2026-10-14')).status,
    200,
  );
});

test('same branch unassigned, tuple cross-products and guessed period IDs fail concealed', async () => {
  const records = await TimetablePeriod.insertMany([
    {
      ...slot({ sectionId: section8B }),
      branchId: branchA,
      timetableVersionId: versionId,
    },
    {
      ...slot({ subjectId: physics }),
      branchId: branchA,
      timetableVersionId: versionId,
    },
    {
      ...slot({ classId: class9 }),
      branchId: branchA,
      timetableVersionId: versionId,
    },
    {
      ...slot({
        teacherId: teacherB.id,
        classId: class10,
        sectionId: section10A,
      }),
      branchId: branchA,
      timetableVersionId: versionId,
    },
  ]);
  for (const record of records)
    assert.equal((await periodDetail(String(record._id))).status, 404);
  assert.equal(
    (await periodDetail(String(new mongoose.Types.ObjectId()))).status,
    404,
  );
  assert.equal((await todayQueue()).data.periods.length, 1);
});

test('foreign branch denied and Principal cannot provision another active branch', async () => {
  assert.equal(
    (await periodDetail(periodId, nowDate, foreignTeacher)).status,
    404,
  );
  assert.equal(
    (
      await version({
        branchId: String(branchB),
        periods: [
          slot({
            teacherId: String(foreignTeacher.id),
            classId: String(foreignClass),
            sectionId: String(foreignSection),
            subjectId: String(foreignSubject),
          }),
        ],
      })
    ).status,
    403,
  );
});

test('substitute approval grants only the specific revised occurrence, never roster/class authority', async () => {
  await TeacherAssignment.updateMany(
    { teacherId: teacherB.id, classId: class8 },
    { $set: { isActive: false } },
  );
  const id = await replacement({}, false);
  assert.equal((await todayQueue(teacherA)).data.periods.length, 1);
  assert.equal((await todayQueue(teacherB)).data.periods.length, 0);
  assert.equal(
    (await http(`/timetables/substitutes/${id}/approve`, principal, 'POST', {}))
      .status,
    200,
  );
  assert.equal((await todayQueue(teacherA)).data.periods.length, 0);
  const row = (await todayQueue(teacherB)).data.periods[0];
  assert.equal(row.room, 'Approved revised room');
  assert.equal(row.startTime, '10:00');
  assert.equal(row.endTime, '10:45');
  assert.equal(row.isSubstitute, true);
  assert.equal(row.canAcknowledgeSubstitute, true);
  assert.equal((await detail(class8, teacherB)).status, 404);
  assert.equal(
    (
      await http(
        `/teacher/classes/${class8}/sections/${section8A}/subjects/${math}/students`,
        teacherB,
      )
    ).status,
    404,
  );
});

test('only effective substitute can acknowledge; idempotency retains first audit timestamp', async () => {
  const id = await replacement();
  assert.equal((await ack(periodId, teacherA)).status, 404);
  assert.equal((await ack(periodId, foreignTeacher)).status, 404);
  assert.equal((await ack(periodId)).status, 200);
  const first = await SubstituteAssignment.findById(id);
  assert.equal(String(first?.acknowledgedBy), String(teacherB.id));
  assert.ok(first?.acknowledgedAt);
  assert.equal((await ack(periodId)).status, 200);
  const second = await SubstituteAssignment.findById(id);
  assert.equal(
    second?.acknowledgedAt?.toISOString(),
    first?.acknowledgedAt?.toISOString(),
  );
  assert.equal(
    (await periodDetail(periodId, nowDate, teacherB)).data
      .canAcknowledgeSubstitute,
    false,
  );
});

test('future, past and retired substitute cannot be acknowledged', async () => {
  await replacement();
  for (const date of ['2026-10-06', '2026-10-20'])
    assert.equal((await ack(periodId, teacherB, date)).status, 404);
  await SubstituteAssignment.updateMany(
    { periodId },
    { $set: { status: 'retired' } },
  );
  assert.equal((await ack(periodId)).status, 404);
  assert.equal((await todayQueue()).data.periods.length, 1);
});

test('competing substitute approvals have one winner and preserve both histories', async () => {
  const a = await replacement({}, false),
    b = await replacement({ room: 'Another room' }, false);
  const result = await Promise.all(
    [a, b].map(id =>
      http(`/timetables/substitutes/${id}/approve`, principal, 'POST', {}),
    ),
  );
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.equal(
    await SubstituteAssignment.countDocuments({ periodId, status: 'approved' }),
    1,
  );
  assert.equal(await SubstituteAssignment.countDocuments({ periodId }), 2);
});

test('concurrent acknowledgement has one immutable actor/timestamp and no master mutation', async () => {
  const id = await replacement(),
    originalPeriod = await TimetablePeriod.findById(periodId).lean();
  const responses = await Promise.all([
    ack(periodId),
    ack(periodId),
    ack(periodId),
  ]);
  assert.ok(responses.every(r => r.status === 200));
  const record = await SubstituteAssignment.findById(id);
  assert.ok(record?.acknowledgedAt);
  assert.deepEqual(
    {
      ...(await TimetablePeriod.findById(periodId).lean()),
      __v: originalPeriod!.__v,
    },
    originalPeriod,
  );
});

test('issue uses scoped server actor/branch, trims reason, and duplicate submits are idempotent', async () => {
  assert.equal((await issue(periodId, teacherB)).status, 404);
  const result = await issue(periodId);
  assert.equal(result.status, 200);
  assert.equal(result.data.issueStatus, 'open');
  await Promise.all([issue(periodId), issue(periodId)]);
  const stored = await TimetableIssue.find({ periodId });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].reason, 'Room mismatch');
  assert.equal(String(stored[0].createdBy), String(teacherA.id));
  assert.equal(String(stored[0].branchId), String(branchA));
  assert.equal(result.data.canRequestIssue, true);
});

test('substitute issue captures specific override but does not expose issue reason or other reporters', async () => {
  const id = await replacement();
  const result = await issue(
    periodId,
    teacherB,
    'Private scheduling description',
  );
  assert.equal(result.status, 200);
  assert.equal(result.raw.includes('Private scheduling description'), false);
  assert.equal(
    String((await TimetableIssue.findOne({ periodId }))?.substituteId),
    id,
  );
  assert.equal((await issue(periodId, teacherA)).status, 404);
});

test('Teacher cannot create, approve, retire or edit school timetable', async () => {
  assert.equal((await version({}, teacherA)).status, 403);
  assert.equal((await approve(versionId, teacherA)).status, 403);
  assert.equal(
    (
      await http(
        `/timetables/versions/${versionId}/retire`,
        teacherA,
        'POST',
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (await http('/timetables/substitutes', teacherA, 'POST', {})).status,
    403,
  );
  const result = await fetch(`${base}/teacher/timetable/periods/${periodId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${teacherA.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ room: 'hacked' }),
  });
  assert.notEqual(result.status, 200);
  assert.equal((await TimetablePeriod.findById(periodId))?.room, 'Room 8');
});

for (const permission of [
  PERMISSIONS.TEACHER_TIMETABLE_VIEW,
  PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE,
  PERMISSIONS.TEACHER_TIMETABLE_ISSUE,
]) {
  test(`permission removal ${permission} applies on next request`, async () => {
    await replacement();
    ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
      p => p !== permission,
    );
    const result =
      permission === PERMISSIONS.TEACHER_TIMETABLE_VIEW
        ? await todayQueue(teacherB)
        : permission === PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE
        ? await ack(periodId)
        : await issue(periodId, teacherB);
    assert.equal(result.status, 403);
  });
}
for (const state of [
  'inactive',
  'role',
  'branch',
  'branch inactive',
  'session',
] as const) {
  test(`current Teacher ${state} change removes queue/action access`, async () => {
    await replacement();
    if (state === 'inactive')
      await User.updateOne({ _id: teacherB.id }, { $set: { isActive: false } });
    if (state === 'role')
      await User.updateOne(
        { _id: teacherB.id },
        { $set: { role: 'principal' } },
      );
    if (state === 'branch')
      await User.updateOne(
        { _id: teacherB.id },
        { $set: { branchId: branchB } },
      );
    if (state === 'branch inactive')
      await Branch.updateOne({ _id: branchA }, { $set: { isActive: false } });
    if (state === 'session')
      await Session.updateOne(
        { token: teacherB.token },
        { $set: { isRevoked: true } },
      );
    assert.equal(
      (await ack(periodId)).status,
      state === 'branch' ? 404 : state === 'branch inactive' ? 403 : 401,
    );
  });
}
test('base assignment revocation and expiry remove operational access immediately', async () => {
  await TeacherAssignment.updateMany(
    { teacherId: teacherA.id, classId: class8 },
    { $set: { isActive: false } },
  );
  assert.equal((await periodDetail(periodId)).status, 404);
  await TeacherAssignment.collection.updateMany(
    { teacherId: teacherA.id, classId: class8 },
    { $set: { isActive: true, validUntil: new Date('2026-10-12T00:00:00Z') } },
  );
  assert.equal((await todayQueue()).data.periods.length, 0);
  await TeacherAssignment.collection.updateMany(
    { teacherId: teacherA.id, classId: class8 },
    {
      $unset: { validUntil: 1 },
      $set: { validFrom: new Date('2026-10-14T00:00:00Z') },
    },
  );
  assert.equal((await todayQueue()).data.periods.length, 0);
});

test('strict date/body/query contracts reject spoofing, malformed IDs and invalid reasons', async () => {
  for (const field of [
    'teacherId',
    'branchId',
    'permissions',
    'classId',
    'sectionId',
    'subjectId',
  ]) {
    assert.equal(
      (await todayQueue(teacherA, `?${field}=${teacherB.id}`)).status,
      400,
    );
    assert.equal(
      (
        await http('/teacher/timetable', teacherA, 'GET', {
          [field]: String(teacherB.id),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await http(
          `/teacher/timetable/periods/${periodId}/issues`,
          teacherA,
          'POST',
          { date: nowDate, reason: 'ok', [field]: String(teacherB.id) },
        )
      ).status,
      400,
    );
  }
  for (const date of ['2026-02-30', '2026-10-13T00:00:00Z', 'invalid'])
    assert.equal((await todayQueue(teacherA, `?date=${date}`)).status, 400);
  assert.equal(
    (await todayQueue(teacherA, '?date=2026-10-13&date=2026-10-14')).status,
    400,
  );
  assert.equal((await periodDetail('invalid')).status, 400);
  for (const reason of ['', '   ', 'x'.repeat(501), 1, {}])
    assert.equal((await issue(periodId, teacherA, reason)).status, 400);
});

test('trusted provisioning validates tuple/time/window, protects audit fields and active branch', async () => {
  for (const candidate of [
    { periods: [slot({ subjectId: String(physics) })] },
    { periods: [slot({ sectionId: String(section8B) })] },
    { periods: [slot({ endTime: '08:00' })] },
    { periods: [slot({ dayOfWeek: 7 })] },
    { effectiveUntil: '2026-09-01' },
    { effectiveUntil: '2028-01-01' },
    { approvedBy: String(teacherA.id) },
  ])
    assert.ok(
      [400, 404].includes(
        (await version({ versionNumber: 2, ...candidate })).status,
      ),
    );
  assert.equal(
    (await version({ versionNumber: 2, periods: [slot(), slot()] })).status,
    409,
  );
  assert.equal((await version()).status, 409);
  assert.equal((await approve(versionId)).status, 409);
  ROLE_PERMISSIONS.principal = ROLE_PERMISSIONS.principal.filter(
    p => p !== PERMISSIONS.TIMETABLE_MANAGE,
  );
  assert.equal((await version({ versionNumber: 2 })).status, 403);
});

test('incomplete drafts cannot be approved and current responsibility is revalidated', async () => {
  const created = await version({ versionNumber: 2 });
  await TimetablePeriod.deleteMany({
    timetableVersionId: created.data.versionId,
  });
  assert.equal((await approve(created.data.versionId)).status, 409);
  const next = await version({ versionNumber: 3 });
  await TeacherAssignment.updateMany(
    { teacherId: teacherA.id },
    { $set: { isActive: false } },
  );
  assert.equal((await approve(next.data.versionId)).status, 404);
});

test('substitute invalid date/time, foreign or inactive Teacher fails closed', async () => {
  for (const extra of [
    { date: '2026-10-14' },
    { date: '2026-11-03' },
    { startTime: '12:00', endTime: '11:00' },
    { substituteTeacherId: String(foreignTeacher.id) },
    { approvedBy: String(teacherA.id) },
  ]) {
    const result = await http('/timetables/substitutes', principal, 'POST', {
      periodId,
      substituteTeacherId: String(teacherB.id),
      date: nowDate,
      startTime: '10:00',
      endTime: '10:45',
      room: 'Room',
      ...extra,
    });
    assert.ok([400, 404].includes(result.status));
  }
  await User.updateOne({ _id: teacherB.id }, { $set: { isActive: false } });
  assert.equal(
    (
      await http('/timetables/substitutes', principal, 'POST', {
        periodId,
        substituteTeacherId: String(teacherB.id),
        date: nowDate,
        startTime: '10:00',
        endTime: '10:45',
        room: 'Room',
      })
    ).status,
    404,
  );
});

test('timezone boundary uses school civil dates independent of server timezone', async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-12T20:00:00Z') });
  assert.equal(schoolToday(), '2026-10-13');
  process.env.SCHOOL_TIMEZONE = 'UTC';
  assert.equal(schoolToday(), '2026-10-12');
  assert.equal(scheduleWeekday('2026-10-13'), 2);
  assert.equal(addScheduleDays('2026-12-31', 1), '2027-01-01');
});

test('sensitive legacy fields never escape version/period/substitute serializers', async () => {
  await replacement();
  const privateData = {
    guardianPhone: 'private',
    medical: 'private',
    password: 'private',
    internalAudit: 'private',
  };
  await TimetablePeriod.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(periodId) },
    { $set: privateData },
  );
  await TimetableVersion.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(versionId) },
    { $set: privateData },
  );
  await SubstituteAssignment.collection.updateOne(
    { periodId: new mongoose.Types.ObjectId(periodId) },
    { $set: privateData },
  );
  const queue = await todayQueue(teacherB);
  assert.equal(queue.raw.includes('private'), false);
});

test('unexpected timetable database failure is sanitized', async () => {
  mock.method(TimetableVersion, 'aggregate', () => {
    throw new Error('private database internals');
  });
  const result = await todayQueue();
  assert.equal(result.status, 500);
  assert.equal(result.raw.includes('private database internals'), false);
});

test('missing/expired authentication and direct-service role/permission gates remain independent', async () => {
  assert.equal((await http('/teacher/timetable', undefined)).status, 401);
  const expired = {
    ...teacherA,
    token: jwt.sign({ userId: String(teacherA.id), role: 'teacher' }, secret, {
      expiresIn: -1,
    }),
  };
  assert.equal((await todayQueue(expired)).status, 401);
  await assert.rejects(
    getTeacherTimetable({ userId: String(principal.id), role: 'principal' }),
    { status: 403 },
  );
  await assert.rejects(
    createTimetableVersion(
      { userId: String(teacherA.id), role: 'teacher' },
      {},
    ),
    { status: 403 },
  );
});

test('timetable queries batch references without per-period assignment or identity loops', async () => {
  const assignments = mock.method(TeacherAssignment, 'find'),
    periods = mock.method(TimetablePeriod, 'find');
  assert.equal((await todayQueue()).status, 200);
  assert.equal(assignments.mock.callCount(), 1);
  assert.equal(periods.mock.callCount(), 1);
});

test('timetable indexes exist with automatic index creation disabled', async () => {
  assert.ok((await TeacherAssignment.collection.indexes()).some(i => i.name === 'timetable_eligible_teacher_tuple'));
  const replacements = await SubstituteAssignment.collection
    .listIndexes()
    .toArray();
  assert.equal(
    replacements.find(i => i.name === 'one_approved_substitute')?.unique,
    true,
  );
  assert.deepEqual(
    replacements.find(i => i.name === 'one_approved_substitute')
      ?.partialFilterExpression,
    { status: 'approved' },
  );
  const issues = await TimetableIssue.collection.listIndexes().toArray();
  assert.equal(
    issues.find(i => i.name === 'teacher_issue_operation')?.unique,
    true,
  );
  const slots = await TimetablePeriod.collection.listIndexes().toArray();
  assert.ok(
    slots.some(
      i =>
        i.key.branchId === 1 &&
        i.key.timetableVersionId === 1 &&
        i.key.teacherId === 1,
    ),
  );
  const versions = await TimetableVersion.collection.listIndexes().toArray();
  assert.ok(
    versions.some(
      i => i.key.branchId === 1 && i.key.versionNumber === 1 && i.unique,
    ),
  );
});

const invalidateBeforeTransaction = (change: () => Promise<unknown>) => {
  const original = mongoose.startSession.bind(mongoose);
  const gate = mock.method(mongoose, 'startSession', async () => {
    gate.mock.restore();
    await change();
    return original();
  });
};
for (const change of [
  'branch',
  'assignment',
  'role',
  'version',
  'substitute',
] as const) {
  test(
    'issue rejects pre-persistence ' + change + ' invalidation with zero rows',
    async () => {
      const substituteId =
        change === 'substitute' ? await replacement() : undefined;
      const person = substituteId ? teacherB : teacherA;
      invalidateBeforeTransaction(async () => {
        if (change === 'branch')
          await User.updateOne(
            { _id: person.id },
            { $set: { branchId: branchB } },
          );
        if (change === 'role')
          await User.updateOne(
            { _id: person.id },
            { $set: { role: 'student' } },
          );
        if (change === 'assignment')
          await TeacherAssignment.updateMany(
            { teacherId: person.id },
            { $set: { isActive: false } },
          );
        if (change === 'version')
          await TimetableVersion.updateOne(
            { _id: versionId },
            { $set: { status: 'retired' } },
          );
        if (substituteId)
          await SubstituteAssignment.updateOne(
            { _id: substituteId },
            { $set: { status: 'retired' } },
          );
      });
      const result = await issue(periodId, person);
      assert.ok([401, 403, 404].includes(result.status), result.raw);
      assert.equal(await TimetableIssue.countDocuments(), 0);
    },
  );
}
for (const change of [
  'version',
  'new_revision',
  'substitute',
  'role',
  'branch',
  'permission',
] as const) {
  test(
    'acknowledgement rejects pre-persistence ' + change + ' invalidation',
    async () => {
      const substituteId = await replacement();
      const newVersion =
        change === 'new_revision'
          ? await version({ versionNumber: 2 })
          : undefined;
      invalidateBeforeTransaction(async () => {
        if (change === 'version')
          await TimetableVersion.updateOne(
            { _id: versionId },
            { $set: { status: 'retired' } },
          );
        if (change === 'new_revision')
          assert.equal((await approve(newVersion!.data.versionId)).status, 200);
        if (change === 'substitute')
          await SubstituteAssignment.updateOne(
            { _id: substituteId },
            { $set: { status: 'retired' } },
          );
        if (change === 'role')
          await User.updateOne(
            { _id: teacherB.id },
            { $set: { role: 'student' } },
          );
        if (change === 'branch')
          await User.updateOne(
            { _id: teacherB.id },
            { $set: { branchId: branchB } },
          );
        if (change === 'permission')
          ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
            p => p !== PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE,
          );
      });
      const result = await ack(periodId);
      assert.ok([401, 403, 404].includes(result.status), result.raw);
      const stored = await SubstituteAssignment.findById(substituteId);
      assert.equal(stored?.acknowledgedAt, undefined);
      assert.equal(stored?.acknowledgedBy, undefined);
    },
  );
}
test('distinct operation IDs allow distinct and repeated reasons on the same occurrence', async () => {
  assert.equal(
    (await issue(periodId, teacherA, 'First', 'operation_first_0001')).status,
    200,
  );
  assert.equal(
    (await issue(periodId, teacherA, 'Second', 'operation_second_0002')).status,
    200,
  );
  assert.equal(
    (await issue(periodId, teacherA, 'Second', 'operation_third_0003')).status,
    200,
  );
  assert.equal(await TimetableIssue.countDocuments(), 3);
});
test('concurrent same-key transport retries persist exactly one issue and reject changed payload', async () => {
  const results = await Promise.all(
    Array.from({ length: 4 }, () => issue(periodId)),
  );
  results.forEach(result => assert.equal(result.status, 200, result.raw));
  assert.equal(await TimetableIssue.countDocuments(), 1);
  assert.equal((await issue(periodId, teacherA, 'Different')).status, 409);
  assert.equal(await TimetableIssue.countDocuments(), 1);
});
test('another actor may use the same operation ID without collision or disclosure', async () => {
  assert.equal((await issue(periodId)).status, 200);
  await replacement();
  assert.equal((await issue(periodId, teacherB)).status, 200);
  const rows = await TimetableIssue.find();
  assert.equal(rows.length, 2);
  assert.notEqual(String(rows[0].createdBy), String(rows[1].createdBy));
});
test('operation identity is required, strict, and cannot contain authority fields', async () => {
  for (const key of [
    null,
    '',
    'short',
    'a'.repeat(81),
    ' spaces_are_invalid ',
    {},
    1,
  ])
    assert.equal(
      (await issue(periodId, teacherA, 'Valid reason', key)).status,
      400,
    );
  assert.equal(
    (
      await http(
        '/teacher/timetable/periods/' + periodId + '/issues',
        teacherA,
        'POST',
        { date: nowDate, reason: 'Valid' },
      )
    ).status,
    400,
  );
  for (const field of ['branchId', 'createdBy', 'teacherId']) {
    const result = await http(
      '/teacher/timetable/periods/' + periodId + '/issues',
      teacherA,
      'POST',
      {
        date: nowDate,
        reason: 'Valid',
        clientOperationId: 'operation_valid_0001',
        [field]: String(teacherB.id),
      },
    );
    assert.equal(result.status, 400);
  }
  assert.equal(await TimetableIssue.countDocuments(), 0);
});
test('startup replaces the known old index and retains legacy issue history', async () => {
  await TimetableIssue.collection.insertOne({
    branchId: branchA,
    createdBy: teacherA.id,
    periodId: new mongoose.Types.ObjectId(periodId),
    date: nowDate,
    reason: 'Legacy',
    status: 'open',
  });
  await TimetableIssue.collection.createIndex(
    { periodId: 1, date: 1, createdBy: 1 },
    { unique: true, name: 'one_teacher_occurrence_issue' },
  );
  await ensureTimetableIndexes();
  const indexes = await TimetableIssue.collection.indexes();
  assert.equal(
    indexes.some(index => index.name === 'one_teacher_occurrence_issue'),
    false,
  );
  assert.equal(
    indexes.find(index => index.name === 'teacher_issue_operation')?.unique,
    true,
  );
  assert.equal((await issue(periodId)).status, 200);
  assert.equal(await TimetableIssue.countDocuments(), 2);
  await ensureTimetableIndexes();
});

test('authorization failure after staged issue write rolls back the entire transaction', async () => {
  const original = TimetableIssue.updateOne.bind(TimetableIssue);
  const gate = mock.method(
    TimetableIssue,
    'updateOne',
    async (...args: Parameters<typeof original>) => {
      gate.mock.restore();
      const result = await original(...args);
      ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
        p => p !== PERMISSIONS.TEACHER_TIMETABLE_ISSUE,
      );
      return result;
    },
  );
  assert.equal((await issue(periodId)).status, 403);
  assert.equal(await TimetableIssue.countDocuments(), 0);
});
test('authorization failure after staged acknowledgement rolls back actor and timestamp', async () => {
  const id = await replacement();
  const original = SubstituteAssignment.updateOne.bind(SubstituteAssignment);
  const gate = mock.method(
    SubstituteAssignment,
    'updateOne',
    async (...args: Parameters<typeof original>) => {
      gate.mock.restore();
      const result = await original(...args);
      ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(
        p => p !== PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE,
      );
      return result;
    },
  );
  assert.equal((await ack(periodId)).status, 403);
  const stored = await SubstituteAssignment.findById(id);
  assert.equal(stored?.acknowledgedAt, undefined);
  assert.equal(stored?.acknowledgedBy, undefined);
});

test('version retirement cannot commit through an in-flight acknowledgement fence', async () => {
  const id = await replacement();
  const original = SubstituteAssignment.updateOne.bind(SubstituteAssignment);
  let retiring: Promise<unknown> | undefined;
  let retired = false;
  const gate = mock.method(
    SubstituteAssignment,
    'updateOne',
    async (...args: Parameters<typeof original>) => {
      gate.mock.restore();
      retiring = TimetableVersion.updateOne(
        { _id: versionId },
        { $set: { status: 'retired' } },
      ).then(() => {
        retired = true;
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(
        retired,
        false,
        'retirement must wait behind the occurrence fence',
      );
      return original(...args);
    },
  );
  assert.equal((await ack(periodId)).status, 200);
  await retiring;
  assert.equal(retired, true);
  assert.ok((await SubstituteAssignment.findById(id))?.acknowledgedAt);
  assert.equal((await periodDetail(periodId, nowDate, teacherB)).status, 404);
});
test('index reconciliation fails closed on an unexpected restrictive unique index', async () => {
  const name = 'unexpected_restrictive_issue';
  await TimetableIssue.collection.createIndex(
    { createdBy: 1, date: 1, periodId: 1 },
    { unique: true, name },
  );
  try {
    await assert.rejects(ensureTimetableIndexes(), /Unexpected restrictive/);
    assert.ok(
      (await TimetableIssue.collection.indexes()).some(
        index => index.name === name,
      ),
    );
  } finally {
    await TimetableIssue.collection.dropIndex(name);
  }
});

for (const [state, reason] of [
  ['missing', 'no_exact_assignment'],
  ['revoked', 'inactive_assignment'],
  ['future', 'future_assignment'],
  ['expired', 'expired_assignment'],
  ['inactive_teacher', 'teacher_unavailable'],
  ['wrong_role', 'teacher_unavailable'],
  ['foreign_teacher', 'teacher_unavailable'],
] as const)
  test(
    'empty Teacher selector explains exact assignment state: ' + state,
    async () => {
      const filter = {
        teacherId: teacherA.id,
        classId: class9,
        sectionId: section9B,
        subjectId: physics,
      };
      if (state === 'missing')
        await TeacherAssignment.collection.deleteMany(filter);
      if (state === 'revoked')
        await TeacherAssignment.collection.updateMany(filter, {
          $set: { isActive: false },
        });
      if (state === 'future')
        await TeacherAssignment.collection.updateMany(filter, {
          $set: { validFrom: new Date('2027-01-01') },
        });
      if (state === 'expired')
        await TeacherAssignment.collection.updateMany(filter, {
          $set: { validUntil: new Date('2026-10-13T06:00:00Z') },
        });
      if (state === 'inactive_teacher')
        await User.collection.updateOne(
          { _id: teacherA.id },
          { $set: { isActive: false } }
        );
      if (state === 'wrong_role')
        await User.collection.updateOne(
          { _id: teacherA.id },
          { $set: { role: 'principal' } }
        );
      if (state === 'foreign_teacher')
        await User.collection.updateOne(
          { _id: teacherA.id },
          { $set: { branchId: branchB } }
        );
      const result = await http<Awaited<ReturnType<typeof timetableOptions>>>(
        '/timetables/options?classId=' +
          class9 +
          '&sectionId=' +
          section9B +
          '&subjectId=' +
          physics,
        principal
      );
      assert.equal(result.status, 200, result.raw);
      assert.deepEqual(result.data.teachers, []);
      assert.deepEqual(result.data.teacherEligibility?.reasons, [reason]);
      assert.equal(
        result.data.teacherEligibility?.asOf,
        '2026-10-13T06:00:00.000Z'
      );
      assert.equal(
        (
          await version({
            versionNumber: 2,
            periods: [
              slot({
                classId: String(class9),
                sectionId: String(section9B),
                subjectId: String(physics),
              }),
            ],
          })
        ).status,
        state === 'inactive_teacher' || state === 'wrong_role' ? 401 : 404
      );
    }
  );

test('exact eligible Teacher can be scheduled, approved and read in Teacher timetable', async () => {
  const options = await http<Awaited<ReturnType<typeof timetableOptions>>>(
    '/timetables/options?classId=' +
      class9 +
      '&sectionId=' +
      section9B +
      '&subjectId=' +
      physics,
    principal
  );
  assert.equal(options.status, 200);
  assert.deepEqual(
    options.data.teachers.map((t) => t.id),
    [String(teacherA.id)]
  );
  assert.deepEqual(options.data.teacherEligibility?.reasons, []);
  const draft = await version({
    versionNumber: 2,
    periods: [
      slot({
        teacherId: options.data.teachers[0]!.id,
        classId: String(class9),
        sectionId: String(section9B),
        subjectId: String(physics),
      }),
    ],
  });
  assert.equal(draft.status, 201, draft.raw);
  assert.equal((await approve(draft.data.versionId)).status, 200);
  const timetable = await todayQueue();
  assert.equal(timetable.status, 200);
  assert.equal(timetable.data.periods.length, 1);
  const row = timetable.data.periods[0]!;
  assert.equal(row.classId, String(class9));
  assert.equal(row.sectionId, String(section9B));
  assert.equal(row.subjectId, String(physics));
  assert.equal(row.startTime, '09:00');
  assert.equal(row.endTime, '09:40');
  assert.equal(row.approvedVersion.versionNumber, 2);
});
for (const mismatch of ['class', 'section', 'subject'] as const)
  test(
    'exact Teacher eligibility excludes ' + mismatch + ' mismatch',
    async () => {
      const selectedClass = mismatch === 'class' ? class10 : class9;
      const selectedSection = mismatch === 'class' ? section10A : section9B;
      if (mismatch === 'section')
        await TeacherAssignment.collection.updateMany(
          { teacherId: teacherA.id, classId: class9 },
          { $set: { sectionId: section8B } }
        );
      const selectedSubject = mismatch === 'subject' ? math : physics;
      const result = await http<Awaited<ReturnType<typeof timetableOptions>>>(
        '/timetables/options?classId=' +
          selectedClass +
          '&sectionId=' +
          selectedSection +
          '&subjectId=' +
          selectedSubject,
        principal
      );
      assert.equal(result.status, 200, result.raw);
      assert.deepEqual(result.data.teachers, []);
      assert.deepEqual(result.data.teacherEligibility?.reasons, [
        'no_exact_assignment',
      ]);
    }
  );

for (const state of ['foreign', 'missing', 'inactive'] as const)
  test('Room scheduling rejects ' + state + ' canonical Room', async () => {
    let id = String(new mongoose.Types.ObjectId());
    if (state === 'foreign')
      id = String(
        (
          await Room.create({
            branchId: branchB,
            name: 'Foreign',
            code: 'F',
            createdBy: principal.id,
            updatedBy: principal.id,
          })
        )._id
      );
    if (state === 'inactive') {
      id = roomIds.get('Another room')!;
      await Room.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { isActive: false } }
      );
    }
    assert.equal(
      (await version({ versionNumber: 2, periods: [slot({ roomId: id })] }))
        .status,
      404
    );
  });
test('Room conflicts use canonical identity, with different Teachers and Sections; different Rooms are allowed', async () => {
  const a = slot({
    classId: String(class9),
    sectionId: String(section9B),
    subjectId: String(physics),
  });
  const b = slot({
    teacherId: String(teacherB.id),
    classId: String(class10),
    sectionId: String(section10A),
    startTime: '09:20',
    endTime: '10:00',
  });
  const conflict = await version({ versionNumber: 2, periods: [a, b] });
  assert.equal(conflict.status, 409);
  assert.match(conflict.message, /Room/);
  const valid = await version({
    versionNumber: 2,
    periods: [a, { ...b, roomId: roomIds.get('Another room') }],
  });
  assert.equal(valid.status, 201, valid.raw);
  assert.equal((await approve(valid.data.versionId)).status, 200);
});
test('Room snapshot is server-derived and historical display survives catalog rename and legacy records', async () => {
  const r = roomIds.get('Room 8')!;
  const draft = await version({
    versionNumber: 2,
    periods: [slot({ roomId: r, room: 'forged display' })],
  });
  assert.equal(draft.status, 201);
  assert.equal(
    (
      await TimetablePeriod.findOne({
        timetableVersionId: draft.data.versionId,
      })
    )?.room,
    'Room 8'
  );
  await Room.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(r) },
    { $set: { name: 'Renamed Room' } }
  );
  assert.equal((await todayQueue()).data.periods[0].room, 'Room 8');
  await TimetablePeriod.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(periodId) },
    { $unset: { roomId: '' }, $set: { room: 'Legacy hall' } }
  );
  assert.equal((await todayQueue()).data.periods[0].room, 'Legacy hall');
});
test('Room approval rejects inactive Room and imported text-only draft; new text-only writes cannot bypass identity', async () => {
  const id = roomIds.get('Another room')!;
  const draft = await version({
    versionNumber: 2,
    periods: [slot({ roomId: id })],
  });
  assert.equal(draft.status, 201);
  await Room.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { isActive: false } }
  );
  assert.equal((await approve(draft.data.versionId)).status, 404);
  await Room.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { isActive: true } }
  );
  await TimetablePeriod.collection.updateMany(
    { timetableVersionId: new mongoose.Types.ObjectId(draft.data.versionId) },
    { $unset: { roomId: '' } }
  );
  assert.equal((await approve(draft.data.versionId)).status, 409);
  assert.equal(
    (
      await version({
        versionNumber: 3,
        periods: [slot({ roomId: undefined })],
      })
    ).status,
    400
  );
});
test('Room deactivation and timetable create serialize on Branch; only a safe outcome commits', async () => {
  const id = roomIds.get('Another room')!;
  const [draft, deactivation] = await Promise.all([
    version({ versionNumber: 2, periods: [slot({ roomId: id })] }),
    http('/academic-setup/rooms/' + id + '/deactivate', principal, 'POST', {
      revision: 1,
    }),
  ]);
  assert.ok(
    (draft.status === 201 && deactivation.status === 409) ||
      (draft.status === 404 && deactivation.status === 200),
    JSON.stringify([draft.status, deactivation.status])
  );
});
test('Room substitution conflicts with another effective scheduled period', async () => {
  await TimetablePeriod.create({
    ...slot({
      teacherId: teacherB.id,
      classId: class10,
      sectionId: section10A,
      roomId: roomIds.get('Another room'),
      startTime: '10:00',
      endTime: '11:00',
    }),
    branchId: branchA,
    timetableVersionId: versionId,
  });
  const result = await http('/timetables/substitutes', principal, 'POST', {
    periodId,
    substituteTeacherId: String(teacherB.id),
    date: nowDate,
    startTime: '10:15',
    endTime: '10:45',
    roomId: roomIds.get('Another room'),
  });
  assert.equal(result.status, 409);
  assert.match(result.message, /Room conflict/);
});

test('Room collision imported into immutable draft cannot pass concurrent approvals', async () => {
  const a = slot({
    classId: String(class9),
    sectionId: String(section9B),
    subjectId: String(physics),
  });
  const b = slot({
    teacherId: String(teacherB.id),
    classId: String(class10),
    sectionId: String(section10A),
    roomId: roomIds.get('Another room'),
  });
  const draft = await version({ versionNumber: 2, periods: [a, b] });
  assert.equal(draft.status, 201);
  await TimetablePeriod.collection.updateMany(
    { timetableVersionId: new mongoose.Types.ObjectId(draft.data.versionId) },
    { $set: { roomId: new mongoose.Types.ObjectId(roomIds.get('Room 8')) } }
  );
  const results = await Promise.all([
    approve(draft.data.versionId),
    approve(draft.data.versionId),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [409, 409]
  );
  assert.equal(
    (await TimetableVersion.findById(draft.data.versionId))?.status,
    'draft'
  );
});

test('Room concurrent substitute approvals cannot reserve the same physical Room twice', async () => {
  const other = await TimetablePeriod.create({
    ...slot({
      teacherId: teacherB.id,
      classId: class10,
      sectionId: section10A,
      roomId: roomIds.get('Wednesday'),
    }),
    branchId: branchA,
    timetableVersionId: versionId,
  });
  const drafts = await Promise.all(
    [
      [periodId, teacherB.id],
      [String(other._id), teacherA.id],
    ].map(([id, teacher]) =>
      http<{ substituteId: string }>(
        '/timetables/substitutes',
        principal,
        'POST',
        {
          periodId: String(id),
          substituteTeacherId: String(teacher),
          date: nowDate,
          startTime: '10:00',
          endTime: '10:45',
          roomId: roomIds.get('Another room'),
        }
      )
    )
  );
  drafts.forEach((r) => assert.equal(r.status, 201, r.raw));
  const approvals = await Promise.all(
    drafts.map((r) =>
      http(
        '/timetables/substitutes/' + r.data.substituteId + '/approve',
        principal,
        'POST',
        {}
      )
    )
  );
  assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    await SubstituteAssignment.countDocuments({
      status: 'approved',
      roomId: roomIds.get('Another room'),
    }),
    1
  );
});
