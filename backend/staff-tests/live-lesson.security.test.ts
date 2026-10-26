import assert from 'node:assert/strict';
import { after, before, beforeEach, test, mock } from 'node:test';
import { createDecipheriv } from 'node:crypto';
import { fork } from 'node:child_process';
import { join as pathJoin } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import { liveLessonRouter } from '../src/staff/src/routes/live-lesson.routes';
import User from '../src/staff/src/models/user';
import { LiveLessonPresence } from '../src/staff/src/models/liveLessonPresence';
import Branch from '../src/staff/src/models/branch';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import Student from '../src/staff/src/models/student';
import Session from '../src/staff/src/models/session';
import { AcademicPeriod } from '../src/staff/src/models/academicPeriod';
import { ClassSubject } from '../src/staff/src/models/classSubject';
import { StudentEnrollment } from '../src/staff/src/models/studentEnrollment';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  ensureTimetableIndexes,
} from '../src/staff/src/models/timetable';
import {
  LiveLessonSession,
  ensureLiveLessonIndexes,
} from '../src/staff/src/models/liveLessonSession';
import {
  createLiveLessonService,
  lessonInstant,
} from '../src/staff/src/services/live-lesson.service';
import { ZegoRtcProvider } from '../src/staff/src/services/rtc/zego-rtc-provider';
import type {
  RtcCredentialRequest,
  RtcProvider,
} from '../src/staff/src/services/rtc/rtc-provider';
import {
  generateAccessToken,
  type JwtPayload,
} from '../src/staff/src/services/jwt.service';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import {
  schoolDateTime,
  scheduleWeekday,
  addScheduleDays,
} from '../src/staff/src/services/school-date.service';
import { withAcademicCatalogLock } from '../src/staff/src/services/academic-catalog-lock.service';
import { withTimetablePublication } from '../src/staff/src/services/teacher-timetable.service';

const previousSecret = process.env.JWT_SECRET;
let db: MongoMemoryReplSet;
let branch: mongoose.Types.ObjectId,
  cls: mongoose.Types.ObjectId,
  section: mongoose.Types.ObjectId,
  subject: mongoose.Types.ObjectId;
let academic: mongoose.Types.ObjectId,
  period: mongoose.Types.ObjectId,
  version: mongoose.Types.ObjectId;
let teacher: JwtPayload,
  student: JwtPayload,
  other: JwtPayload,
  teacherToken: string,
  studentToken: string,
  otherToken: string;
let date: string, startTime: string, endTime: string;
let calls: RtcCredentialRequest[] = [];
const fake: RtcProvider = {
  publicConfig: () => ({ provider: 'fake', appId: 123 }),
  name: 'fake',
  roomId: id => 'room_' + id,
  issueCredential(input) {
    calls.push(input);
    return {
      provider: 'fake',
      appId: 123,
      roomId: input.roomId,
      userId: 'opaque',
      role: input.role,
      token: 'test-only-token',
      expiresAt: new Date(
        Math.min(Date.now() + 300000, input.expiresAt.getTime()),
      ).toISOString(),
    };
  },
};
const service = createLiveLessonService(() => fake);
const start = (identity = teacher, token = teacherToken) =>
  service.start(identity, token, String(period), date);
const deny = async (action: Promise<unknown>) => {
  const beforeCalls = calls.length;
  await assert.rejects(action);
  assert.equal(calls.length, beforeCalls);
};
before(async () => {
  process.env.JWT_SECRET = 'isolated-live-lesson-test';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'live_lesson_tests',
    autoIndex: false,
  });
  await Promise.all([
    ensureLiveLessonIndexes(),
    ensureTimetableIndexes(),
    TeacherAssignment.createIndexes(),
    StudentEnrollment.createIndexes(),
  ]);
});
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (db) await db.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
beforeEach(async () => {
  mock.restoreAll();
  calls = [];
  for (const collection of Object.values(mongoose.connection.collections))
    await collection.deleteMany({});
  // Owned fixture clock is fixed at midday so operational tests work at midnight.
  const actualNow = Date.now();
  date = schoolDateTime(new Date(actualNow)).date;
  const instant = lessonInstant(date, '12:00').getTime();
  mock.method(Date, 'now', () => instant);
  startTime = '11:55';
  endTime = '12:55';
  branch = (
    await Branch.create({
      name: 'Branch A',
      code: 'AA',
      address: 'Private',
      city: 'City',
    })
  )._id;
  async function actor(name: string, role: 'teacher' | 'student') {
    const row = await User.create({
      fullName: name,
      email: name + '@test.invalid',
      password: 'fixture-hash',
      role,
      branchId: branch,
    });
    const identity = { userId: String(row._id), role };
    const token = generateAccessToken(identity.userId, role);
    await Session.create({ userId: row._id, role, token });
    return { identity, token };
  }
  ({ identity: teacher, token: teacherToken } = await actor(
    'teacher',
    'teacher',
  ));
  ({ identity: other, token: otherToken } = await actor('other', 'teacher'));
  ({ identity: student, token: studentToken } = await actor(
    'student',
    'student',
  ));
  academic = (
    await AcademicPeriod.create({
      branchId: branch,
      name: 'Year',
      code: '2026',
      startDate: '2020-01-01',
      endDate: '2035-01-01',
      status: 'active',
      createdBy: teacher.userId,
      updatedBy: teacher.userId,
    })
  )._id;
  cls = (
    await SchoolClass.create({
      branchId: branch,
      name: 'Class 8',
      code: '8',
      academicYear: '2026',
      academicPeriodId: academic,
    })
  )._id;
  section = (
    await Section.create({
      branchId: branch,
      classId: cls,
      name: 'A',
      code: 'A',
    })
  )._id;
  subject = (await Subject.create({ branchId: branch, name: 'Math' }))._id;
  await ClassSubject.create({
    branchId: branch,
    academicPeriodId: academic,
    classId: cls,
    subjectId: subject,
    createdBy: teacher.userId,
    updatedBy: teacher.userId,
  });
  await TeacherAssignment.create({
    branchId: branch,
    teacherId: teacher.userId,
    classId: cls,
    sectionId: section,
    subjectId: subject,
    validFrom: new Date(0),
    createdBy: teacher.userId,
    updatedBy: teacher.userId,
  });
  version = (
    await TimetableVersion.create({
      branchId: branch,
      versionNumber: 1,
      status: 'approved',
      effectiveFrom: addScheduleDays(date, -1),
      effectiveUntil: addScheduleDays(date, 2),
      periodCount: 1,
      createdBy: teacher.userId,
    })
  )._id;
  period = (
    await TimetablePeriod.create({
      branchId: branch,
      timetableVersionId: version,
      teacherId: teacher.userId,
      classId: cls,
      sectionId: section,
      subjectId: subject,
      dayOfWeek: scheduleWeekday(date),
      startTime,
      endTime,
      room: 'A',
    })
  )._id;
  const person = await Student.create({
    userId: student.userId,
    branchId: branch,
    classId: cls,
    sectionId: section,
    admissionNumber: 'TEST1',
  });
  await StudentEnrollment.create({
    studentId: person._id,
    branchId: branch,
    academicPeriodId: academic,
    classId: cls,
    sectionId: section,
    effectiveFrom: new Date(0),
    reason: 'Fixture',
    createdBy: teacher.userId,
    updatedBy: teacher.userId,
  });
});

test('scheduled host, enrolled student, opaque adapter boundary and bounded window', async () => {
  const result = await start();
  assert.equal(result.session.status, 'live');
  assert.equal(calls[0].actorId, teacher.userId);
  await admitStudent(result.session.id);
  const joined = await service.join(student, studentToken, result.session.id);
  assert.equal(joined.connection.role, 'participant');
  assert.equal(calls[1].actorId, student.userId);
  assert.equal(calls[1].roomId, calls[0].roomId);
  assert.ok(Date.parse(joined.connection.expiresAt) <= Date.now() + 300000);
  const raw = JSON.stringify(await service.read(teacher, result.session.id));
  for (const field of [
    'token',
    'providerRoomId',
    'history',
    'password',
    'email',
    '__v',
  ])
    assert.ok(!raw.includes(field));
});
test('preview metadata is scoped to the current host occurrence and creates no session or credential', async () => {
  assert.deepEqual(await service.previewConfig(teacher, String(period), date), {
    provider: 'fake',
    appId: 123,
  });
  assert.equal(await LiveLessonSession.countDocuments(), 0);
  assert.equal(calls.length, 0);
  await assert.rejects(service.previewConfig(other, String(period), date));
  await assert.rejects(service.previewConfig(student, String(period), date));
  await ClassSubject.updateMany({}, { isActive: false });
  await assert.rejects(service.previewConfig(teacher, String(period), date));
});
test('available sessions require managed enrollment and expose only scoped lesson summaries', async () => {
  const opened = await start();
  // available() uses real current Date, not the operational fixture clock.
  await LiveLessonSession.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(opened.session.id) },
    {
      $set: {
        scheduledStart: new Date(new Date().getTime() - 10000),
        scheduledEnd: new Date(new Date().getTime() + 3600000),
      },
    },
  );
  const visible = await service.available(student);
  assert.equal(visible.sessions.length, 1);
  assert.ok(visible.sessions[0].subjectName);
  assert.ok(!JSON.stringify(visible).includes('providerRoomId'));
  assert.ok(!JSON.stringify(visible).includes('token'));
  await StudentEnrollment.deleteMany({});
  assert.deepEqual(await service.available(student), { sessions: [] });
  await assert.rejects(service.available(teacher));
});
test('wrong teacher, unauthenticated identity, student start and Principal/Super Admin host denied', async () => {
  await deny(start(other, otherToken));
  await deny(service.start(undefined, '', String(period), date));
  await deny(start(student, studentToken));
  await User.updateOne({ _id: other.userId }, { role: 'principal' });
  await deny(start({ ...other, role: 'principal' }, otherToken));
  await User.updateOne({ _id: other.userId }, { role: 'super_admin', branchId: null });
  await deny(start({ ...other, role: 'super_admin' }, otherToken));
});
for (const [name, mutation] of Object.entries({
  'inactive teacher': () =>
    User.updateOne({ _id: teacher.userId }, { isActive: false }),
  'foreign branch': () =>
    User.updateOne(
      { _id: teacher.userId },
      { branchId: new mongoose.Types.ObjectId() },
    ),
  'revoked assignment': () =>
    TeacherAssignment.updateMany({}, { isActive: false }),
  'wrong class assignment': () =>
    TeacherAssignment.collection.updateMany(
      {},
      { $set: { classId: new mongoose.Types.ObjectId() } },
    ),
  'wrong section': () =>
    Section.collection.updateOne(
      { _id: section },
      { $set: { classId: new mongoose.Types.ObjectId() } },
    ),
  'inactive academic period': () =>
    AcademicPeriod.updateOne({ _id: academic }, { status: 'closed' }),
  'invalid curriculum': () => ClassSubject.updateMany({}, { isActive: false }),
  'retired timetable': () =>
    TimetableVersion.updateOne({ _id: version }, { status: 'retired' }),
  'revoked login': () =>
    Session.updateOne({ token: teacherToken }, { isRevoked: true }),
}))
  test(name + ' denies start before signer', async () => {
    await mutation();
    await deny(start());
  });
test('missing start permission denied at service boundary', async () => {
  const permissions = ROLE_PERMISSIONS.teacher;
  try {
    ROLE_PERMISSIONS.teacher = permissions.filter(
      p => p !== PERMISSIONS.LIVE_LESSON_START,
    );
    await deny(start());
  } finally {
    ROLE_PERMISSIONS.teacher = permissions;
  }
});
async function substitute(extra: Record<string, unknown> = {}) {
  return SubstituteAssignment.create({
    branchId: branch,
    periodId: period,
    originalTeacherId: teacher.userId,
    substituteTeacherId: other.userId,
    date,
    startTime,
    endTime,
    room: 'A',
    status: 'approved',
    createdBy: teacher.userId,
    ...extra,
  });
}
test('approved exact substitute replaces original operational host', async () => {
  const sub = await substitute();
  await deny(start());
  const result = await start(other, otherToken);
  assert.equal(result.connection.role, 'host');
  const stored = await LiveLessonSession.findById(result.session.id);
  assert.equal(String(stored!.substituteId), String(sub._id));
});
for (const kind of ['other-date', 'other-period', 'draft', 'expired'])
  test(kind + ' substitute denied', async () => {
    await substitute(
      kind === 'other-date'
        ? { date: addScheduleDays(date, 1) }
        : kind === 'other-period'
        ? { periodId: new mongoose.Types.ObjectId() }
        : kind === 'draft'
        ? { status: 'draft' }
        : { startTime: '09:00', endTime: '10:00' },
    );
    await deny(start(other, otherToken));
  });
for (const [name, mutation] of Object.entries({
  'wrong class': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { classId: new mongoose.Types.ObjectId() } },
    ),
  'wrong section': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { sectionId: new mongoose.Types.ObjectId() } },
    ),
  'wrong academic period': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { academicPeriodId: new mongoose.Types.ObjectId() } },
    ),
  'foreign student branch': () =>
    User.updateOne(
      { _id: student.userId },
      { branchId: new mongoose.Types.ObjectId() },
    ),
  'withdrawn enrollment': () =>
    StudentEnrollment.updateMany(
      {},
      { status: 'withdrawn', effectiveTo: new Date() },
    ),
  'promoted enrollment': () =>
    StudentEnrollment.updateMany(
      {},
      { status: 'promoted', effectiveTo: new Date() },
    ),
  'inactive student account': () =>
    User.updateOne({ _id: student.userId }, { isActive: false }),
  'inactive student profile': () => Student.updateMany({}, { isActive: false }),
  'future enrollment': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { effectiveFrom: new Date(Date.now() + 86400000) } },
    ),
  'zero enrollment legacy': () => StudentEnrollment.deleteMany({}),
}))
  test(name + ' denies student credential', async () => {
    const result = await start();
    await mutation();
    await deny(service.join(student, studentToken, result.session.id));
  });
test('end is host-only, idempotent, denies joins and history survives retirement/period close', async () => {
  const result = await start();
  await deny(service.end(other, otherToken, result.session.id));
  const ended = await service.end(teacher, teacherToken, result.session.id);
  assert.equal(ended.status, 'ended');
  assert.ok(ended.endedAt);
  assert.deepEqual(
    await service.end(teacher, teacherToken, result.session.id),
    ended,
  );
  await deny(service.join(student, studentToken, result.session.id));
  await deny(start());
  await TimetableVersion.updateOne({ _id: version }, { status: 'retired' });
  await AcademicPeriod.updateOne({ _id: academic }, { status: 'closed' });
  assert.equal(
    (await service.read(teacher, result.session.id)).status,
    'ended',
  );
  assert.equal(
    (await service.read(student, result.session.id)).status,
    'ended',
  );
});
test('managed enrollment wins over stale legacy student class and section', async () => {
  const result = await start();
  await Student.collection.updateMany(
    {},
    {
      $set: {
        classId: new mongoose.Types.ObjectId(),
        sectionId: new mongoose.Types.ObjectId(),
      },
    },
  );
  await admitStudent(result.session.id);
  assert.equal(
    (await service.join(student, studentToken, result.session.id)).connection
      .role,
    'participant',
  );
});
test('join permission and current host assignment are revalidated', async () => {
  const result = await start();
  const permissions = ROLE_PERMISSIONS.student;
  try {
    ROLE_PERMISSIONS.student = permissions.filter(
      p => p !== PERMISSIONS.LIVE_LESSON_JOIN,
    );
    await deny(service.join(student, studentToken, result.session.id));
  } finally {
    ROLE_PERMISSIONS.student = permissions;
  }
  await TeacherAssignment.updateMany({}, { isActive: false });
  await deny(service.join(student, studentToken, result.session.id));
});
test('database unique indexes reject duplicate occurrence and provider room identities', async () => {
  await start();
  const row = await LiveLessonSession.findOne().lean();
  assert.ok(row);
  await assert.rejects(
    LiveLessonSession.collection.insertOne({
      ...row,
      _id: new mongoose.Types.ObjectId(),
      providerRoomId: 'different',
    }),
    (error: { code?: number }) => error.code === 11000,
  );
  await assert.rejects(
    LiveLessonSession.collection.insertOne({
      ...row,
      _id: new mongoose.Types.ObjectId(),
      date: addScheduleDays(date, 1),
    }),
    (error: { code?: number }) => error.code === 11000,
  );
});
test('parallel independent service starts converge on one database session', async () => {
  const second = createLiveLessonService(() => fake);
  const results = await Promise.all([
    start(),
    second.start(teacher, teacherToken, String(period), date),
    start(),
  ]);
  assert.equal(new Set(results.map(r => r.session.id)).size, 1);
  assert.equal(await LiveLessonSession.countDocuments(), 1);
  assert.equal((await LiveLessonSession.findOne())!.history.length, 3);
});
async function worker() {
  const child = fork(
    pathJoin(__dirname, 'helpers/live-lesson-worker.ts'),
    [db.getUri('live_lesson_tests'), String(Date.now())],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    },
  );
  const wait = (type: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Worker timed out: ' + type));
      }, 20000);
      const listener = (value: Record<string, unknown>) => {
        if (value.type === type || value.type === 'failure') {
          clearTimeout(timeout);
          child.off('message', listener);
          if (value.type === 'failure') reject(new Error('Worker failed'));
          else resolve(value);
        }
      };
      child.on('message', listener);
    });
  await wait('ready');
  return {
    child,
    wait,
    close: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>(resolve => {
        child.once('exit', () => resolve());
        child.send({ action: 'shutdown' });
      });
    },
  };
}
test('separate Node instances concurrently start exactly one logical session', async () => {
  const second = await worker();
  try {
    const remote = second.wait('result');
    second.child.send({
      action: 'start',
      identity: teacher,
      token: teacherToken,
      id: String(period),
      date,
    });
    const local = await start();
    const result = await remote;
    assert.equal(result.ok, true);
    assert.equal(result.id, local.session.id);
    assert.equal(await LiveLessonSession.countDocuments(), 1);
  } finally {
    await second.close();
  }
});
test('signer failure rolls back all lifecycle writes and retries safely', async () => {
  const failed = createLiveLessonService(() => ({
    ...fake,
    issueCredential() {
      throw new Error('private-provider-error');
    },
  }));
  await assert.rejects(
    failed.start(teacher, teacherToken, String(period), date),
    /credential issuance failed/,
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
  assert.equal((await start()).session.status, 'live');
});
test('historical/future starts and post-window joins denied', async () => {
  await deny(
    service.start(
      teacher,
      teacherToken,
      String(period),
      addScheduleDays(date, -7),
    ),
  );
  await deny(
    service.start(
      teacher,
      teacherToken,
      String(period),
      addScheduleDays(date, 7),
    ),
  );
  const result = await start();
  mock.method(Date, 'now', () => lessonInstant(date, '13:00').getTime());
  await deny(service.join(student, studentToken, result.session.id));
});

// Hold the same persisted publication/catalog fence as administrative writers.
// The credential request begins while that transaction is uncommitted, then
// must retry and observe revocation. No process-local lock participates.
async function race(
  mutate: (session: mongoose.ClientSession) => Promise<unknown>,
  identity = teacher,
  token = teacherToken,
  id = String(period),
  publication = false,
  action = 'start',
  participantId?: string,
  operation?: string,
) {
  const remote = await worker();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => {
    release = r;
  });
  const acquired = new Promise<void>(r => {
    entered = r;
  });
  const writer = async (session: mongoose.ClientSession) => {
    await mutate(session);
    entered();
    await gate;
  };
  const winning = publication
    ? withTimetablePublication(String(branch), String(period), writer)
    : withAcademicCatalogLock(String(branch), writer);
  try {
    await acquired;
    const atFence = remote.wait('fence'),
      outcome = remote.wait('result');
    remote.child.send({
      action,
      identity,
      token,
      id,
      date,
      participantId,
      operation,
    });
    // Prove the other process reaches the DB write fence before releasing it.
    await atFence;
    release();
    await winning;
    assert.equal((await outcome).ok, false);
  } finally {
    release();
    await remote.close();
  }
}
test('start versus timetable retirement observes winning commit', async () => {
  await race(
    s =>
      TimetableVersion.updateOne(
        { _id: version },
        { status: 'retired' },
        { session: s },
      ),
    teacher,
    teacherToken,
    String(period),
    true,
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
});
test('start versus assignment revocation observes winning commit', async () => {
  await race(s =>
    TeacherAssignment.updateMany({}, { isActive: false }, { session: s }),
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
});
test('substitute start versus revocation observes winning commit', async () => {
  const sub = await substitute();
  await race(
    s =>
      SubstituteAssignment.updateOne(
        { _id: sub._id },
        { status: 'retired' },
        { session: s },
      ),
    other,
    otherToken,
    String(period),
    true,
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
});
test('join versus enrollment withdrawal observes winning commit', async () => {
  const result = await start();
  await admitStudent(result.session.id);
  calls = [];
  await race(
    s =>
      StudentEnrollment.updateMany(
        {},
        { status: 'withdrawn', effectiveTo: new Date() },
        { session: s },
      ),
    student,
    studentToken,
    result.session.id,
    false,
    'join',
  );
  assert.equal(calls.length, 0);
});
test('join versus enrollment transfer observes winning commit', async () => {
  const result = await start();
  await admitStudent(result.session.id);
  await race(
    s =>
      StudentEnrollment.updateMany(
        {},
        { status: 'transferred', effectiveTo: new Date() },
        { session: s },
      ),
    student,
    studentToken,
    result.session.id,
    false,
    'join',
  );
});
test('HTTP rejects spoofed teacher/student identities and administrative roles', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/live-lessons', liveLessonRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const url = `http://127.0.0.1:${address.port}/api/live-lessons`;
    const response = await fetch(`${url}/from-timetable/${period}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date, teacherId: other.userId }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await start();
    const join = await fetch(`${url}/${result.session.id}/join-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: student.userId }),
    });
    assert.equal(join.status, 400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
test('production adapter Token04 decrypts to exact scoped role grants without secret leakage', () => {
  const secret = '0123456789abcdef0123456789abcdef'; // synthetic fixture, never production
  const provider = new ZegoRtcProvider({
    LIVE_LESSON_ENABLED: 'true',
    ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'true',
    ZEGOCLOUD_APP_ID: '123',
    ZEGOCLOUD_SERVER_SECRET: secret,
  });
  const roomId = provider.roomId('session-a');
  assert.notEqual(roomId, provider.roomId('session-b'));
  for (const role of ['host', 'participant'] as const) {
    const result = provider.issueCredential({
      sessionId: 'session-a',
      roomId,
      actorId: teacher.userId,
      role,
      expiresAt: new Date(Date.now() + 600000),
    });
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!result.userId.includes(teacher.userId));
    const bytes = Buffer.from(result.token.slice(2), 'base64');
    assert.equal(
      bytes.readBigInt64BE(),
      BigInt(Math.floor(Date.now() / 1000) + 300),
    );
    const ivSize = bytes.readUInt16BE(8);
    assert.equal(ivSize, 16);
    const decipher = createDecipheriv(
      'aes-256-cbc',
      Buffer.from(secret),
      bytes.subarray(10, 10 + ivSize),
    );
    const claims = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(12 + ivSize)),
        decipher.final(),
      ]).toString(),
    );
    assert.equal(claims.user_id, result.userId);
    assert.equal(claims.app_id, 123);
    assert.deepEqual(JSON.parse(claims.payload), {
      room_id: roomId,
      privilege: { 1: 1, 2: role === 'host' ? 1 : 0 },
      stream_id_list: [],
    });
  }
  for (const env of [
    {},
    { LIVE_LESSON_ENABLED: 'true' },
    { LIVE_LESSON_TOKEN_TTL_SECONDS: '9999' },
  ])
    assert.throws(() => new ZegoRtcProvider(env));
  const configured = {
    LIVE_LESSON_ENABLED: 'true',
    ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'true',
    ZEGOCLOUD_APP_ID: '123',
    ZEGOCLOUD_SERVER_SECRET: secret,
  };
  for (const ttl of ['0', '29', '601', 'NaN'])
    assert.throws(
      () =>
        new ZegoRtcProvider({
          ...configured,
          LIVE_LESSON_TOKEN_TTL_SECONDS: ttl,
        }),
    );
  assert.throws(
    () =>
      new ZegoRtcProvider({
        ...configured,
        ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'false',
      }),
  );
  const short = provider.issueCredential({
    sessionId: 'session',
    roomId,
    actorId: teacher.userId,
    role: 'participant',
    expiresAt: new Date(Date.now() + 10000),
  });
  assert.equal(Date.parse(short.expiresAt), Date.now() + 10000);
});

async function admitStudent(
  id: string,
  key = 'internal-connection',
  host = teacher,
  hostToken = teacherToken,
) {
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    id,
    key,
  );
  await service.moderate(host, hostToken, id, waiting.participant.id, 'admit');
  return waiting.participant.id;
}

test('waiting is durable and gives no media credential; concurrent requests have one logical identity', async () => {
  const { session } = await start();
  const callsBefore = calls.length;
  const requests = await Promise.all(
    [1, 2, 3].map(() =>
      service.requestAdmission(
        student,
        studentToken,
        session.id,
        'student-device-one',
      ),
    ),
  );
  assert.equal(new Set(requests.map(r => r.participant.id)).size, 1);
  assert.equal(requests[0].participant.admission, 'waiting');
  assert.equal(calls.length, callsBefore);
  await deny(
    service.join(student, studentToken, session.id, 'student-device-one'),
  );
  assert.equal(
    await LiveLessonPresence.countDocuments({ role: 'participant' }),
    1,
  );
  assert.equal(
    (await LiveLessonPresence.findOne({ role: 'participant' }))!.history.filter(
      h => h.event === 'joinRequested',
    ).length,
    1,
  );
});

for (const corruption of [
  'withdrawn',
  'foreign-branch',
  'legacy-only',
  'inactive-user',
]) {
  test(
    'waiting request denies ' + corruption + ' authority before credentials',
    async () => {
      const { session } = await start();
      if (corruption === 'withdrawn')
        await StudentEnrollment.updateMany(
          {},
          { status: 'withdrawn', effectiveTo: new Date(Date.now()) },
        );
      if (corruption === 'foreign-branch')
        await Student.collection.updateMany(
          {},
          { $set: { branchId: new mongoose.Types.ObjectId() } },
        );
      if (corruption === 'legacy-only') await StudentEnrollment.deleteMany({});
      if (corruption === 'inactive-user')
        await User.updateOne({ _id: student.userId }, { isActive: false });
      await deny(
        service.requestAdmission(
          student,
          studentToken,
          session.id,
          'student-device-one',
        ),
      );
      assert.equal(
        await LiveLessonPresence.countDocuments({ role: 'participant' }),
        0,
      );
    },
  );
}

test('only current host admits; self-admit and unrelated/admin identities fail; double admit has one event', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  for (const [who, auth] of [
    [other, otherToken],
    [student, studentToken],
    [{ userId: teacher.userId, role: 'principal' }, teacherToken],
  ] as const)
    await assert.rejects(
      service.moderate(who, auth, session.id, waiting.participant.id, 'admit'),
    );
  await Promise.all(
    [1, 2].map(() =>
      service.moderate(
        teacher,
        teacherToken,
        session.id,
        waiting.participant.id,
        'admit',
      ),
    ),
  );
  const row = await LiveLessonPresence.findById(waiting.participant.id);
  assert.equal(row!.admission, 'admitted');
  assert.equal(row!.history.filter(h => h.event === 'admitted').length, 1);
  assert.ok(
    !JSON.stringify(
      await service.classroom(
        teacher,
        teacherToken,
        session.id,
        'internal-connection',
      ),
    ).includes('@test.invalid'),
  );
});

test('reject is idempotent and blocks admission/token retries', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await service.moderate(
    teacher,
    teacherToken,
    session.id,
    waiting.participant.id,
    'reject',
  );
  await service.moderate(
    teacher,
    teacherToken,
    session.id,
    waiting.participant.id,
    'reject',
  );
  await assert.rejects(
    service.moderate(
      teacher,
      teacherToken,
      session.id,
      waiting.participant.id,
      'admit',
    ),
  );
  assert.equal(
    (
      await service.requestAdmission(
        student,
        studentToken,
        session.id,
        'student-device-one',
      )
    ).participant.admission,
    'rejected',
  );
  await deny(
    service.join(student, studentToken, session.id, 'student-device-one'),
  );
});

test('remove commits denial and one event even when provider enforcement fails', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id);
  await service.join(student, studentToken, session.id);
  await assert.rejects(
    service.moderate(other, otherToken, session.id, id, 'remove'),
  );
  await service.moderate(teacher, teacherToken, session.id, id, 'remove');
  await service.moderate(teacher, teacherToken, session.id, id, 'remove');
  const row = await LiveLessonPresence.findById(id);
  assert.equal(row!.admission, 'removed');
  assert.equal(row!.enforcement, 'failed');
  assert.equal(row!.history.filter(h => h.event === 'removed').length, 1);
  await deny(service.join(student, studentToken, session.id));
  assert.equal(
    (
      await service.requestAdmission(
        student,
        studentToken,
        session.id,
        'another-device-one',
      )
    ).participant.admission,
    'removed',
  );
});

test('presence reconnects reuse identity and duplicate callbacks do not increment twice', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id);
  await service.join(student, studentToken, session.id);
  await service.classroom(
    student,
    studentToken,
    session.id,
    'internal-connection',
    'connected',
  );
  await service.classroom(
    student,
    studentToken,
    session.id,
    'internal-connection',
    'reconnecting',
  );
  await Promise.all(
    [1, 2].map(() =>
      service.classroom(
        student,
        studentToken,
        session.id,
        'internal-connection',
        'connected',
      ),
    ),
  );
  assert.equal((await LiveLessonPresence.findById(id))!.reconnectCount, 1);
  assert.equal(
    await LiveLessonPresence.countDocuments({ role: 'participant' }),
    1,
  );
});

test('same actor second device cannot steal an unexpired lease; stale replacement requires fresh admission', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id, 'student-device-one');
  const issued = await service.join(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await assert.rejects(
    service.requestAdmission(
      student,
      studentToken,
      session.id,
      'student-device-two',
    ),
  );
  await service.classroom(
    student,
    studentToken,
    session.id,
    'student-device-one',
    'left',
  );
  await assert.rejects(
    service.requestAdmission(
      student,
      studentToken,
      session.id,
      'student-device-two',
    ),
  );
  const later = Date.parse(issued.connection.expiresAt) + 6000;
  mock.method(Date, 'now', () => later);
  const retry = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-two',
  );
  assert.equal(retry.participant.id, id);
  assert.equal(retry.participant.admission, 'waiting');
});

test('host lease blocks second device, but idempotent same-connection start remains allowed', async () => {
  await service.start(
    teacher,
    teacherToken,
    String(period),
    date,
    'teacher-device-one',
  );
  await assert.rejects(
    service.start(
      teacher,
      teacherToken,
      String(period),
      date,
      'teacher-device-two',
    ),
  );
  await service.start(
    teacher,
    teacherToken,
    String(period),
    date,
    'teacher-device-one',
  );
  assert.equal(await LiveLessonPresence.countDocuments({ role: 'host' }), 1);
});

test('approved substitute can moderate and renewal fails after substitute revocation', async () => {
  const sub = await substitute();
  const { session } = await start(other, otherToken);
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await assert.rejects(
    service.moderate(
      teacher,
      teacherToken,
      session.id,
      waiting.participant.id,
      'admit',
    ),
  );
  await service.moderate(
    other,
    otherToken,
    session.id,
    waiting.participant.id,
    'admit',
  );
  await SubstituteAssignment.updateOne({ _id: sub._id }, { status: 'retired' });
  await assert.rejects(
    service.moderate(
      other,
      otherToken,
      session.id,
      waiting.participant.id,
      'remove',
    ),
  );
  await deny(start(other, otherToken));
});

test('authority replacement during an existing lesson fails closed rather than promoting a new host', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await substitute();
  await assert.rejects(
    service.moderate(
      teacher,
      teacherToken,
      session.id,
      waiting.participant.id,
      'admit',
    ),
  );
  await assert.rejects(
    service.moderate(
      other,
      otherToken,
      session.id,
      waiting.participant.id,
      'admit',
    ),
  );
  await deny(start(other, otherToken));
});

test('hand raise requires admission, is idempotent, actor-scoped and invalid after End', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await assert.rejects(
    service.hand(student, studentToken, session.id, 'student-device-one', true),
  );
  await service.moderate(
    teacher,
    teacherToken,
    session.id,
    waiting.participant.id,
    'admit',
  );
  await LiveLessonPresence.updateOne(
    { _id: waiting.participant.id },
    { $unset: { actionAfter: 1 } },
  );
  await Promise.all(
    [1, 2].map(() =>
      service.hand(
        student,
        studentToken,
        session.id,
        'student-device-one',
        true,
      ),
    ),
  );
  assert.equal(
    (await LiveLessonPresence.findById(waiting.participant.id))!.history.filter(
      h => h.event === 'handRaised',
    ).length,
    1,
  );
  await LiveLessonPresence.updateOne(
    { _id: waiting.participant.id },
    { $unset: { actionAfter: 1 } },
  );
  await service.moderate(
    teacher,
    teacherToken,
    session.id,
    waiting.participant.id,
    'lower-hand',
  );
  assert.equal(
    (await LiveLessonPresence.findById(waiting.participant.id))!.handRaised,
    false,
  );
  await service.end(teacher, teacherToken, session.id);
  await assert.rejects(
    service.hand(student, studentToken, session.id, 'student-device-one', true),
  );
});

test('admit versus reject is serialized and cannot produce contradictory terminal events', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  const outcomes = await Promise.allSettled(
    ['admit', 'reject'].map(action =>
      service.moderate(
        teacher,
        teacherToken,
        session.id,
        waiting.participant.id,
        action,
      ),
    ),
  );
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const row = await LiveLessonPresence.findById(waiting.participant.id);
  assert.equal(
    row!.history.filter(h => ['admitted', 'rejected'].includes(h.event!))
      .length,
    1,
  );
});

for (const mutation of ['withdrawal', 'end', 'remove'])
  test('renewal and reconnect fail closed after ' + mutation, async () => {
    const { session } = await start();
    const id = await admitStudent(session.id);
    await service.join(student, studentToken, session.id);
    if (mutation === 'withdrawal')
      await StudentEnrollment.updateMany(
        {},
        { status: 'withdrawn', effectiveTo: new Date(Date.now()) },
      );
    if (mutation === 'end')
      await service.end(teacher, teacherToken, session.id);
    if (mutation === 'remove')
      await service.moderate(teacher, teacherToken, session.id, id, 'remove');
    await deny(service.join(student, studentToken, session.id));
    if (mutation !== 'remove')
      await assert.rejects(
        service.classroom(
          student,
          studentToken,
          session.id,
          'internal-connection',
        ),
      );
    else
      assert.equal(
        (
          await service.classroom(
            student,
            studentToken,
            session.id,
            'internal-connection',
          )
        ).participant.admission,
        'removed',
      );
  });

test('durable issuance limit is shared across service instances; no token or JWT stored in presence', async () => {
  const { session } = await start();
  await admitStudent(session.id);
  const second = createLiveLessonService(() => fake);
  for (let i = 0; i < 10; i++)
    await (i % 2 ? service : second).join(student, studentToken, session.id);
  await assert.rejects(second.join(student, studentToken, session.id));
  const raw = JSON.stringify(await LiveLessonPresence.find());
  assert.ok(!raw.includes(studentToken));
  assert.ok(!raw.includes('test-only-token'));
});

test('two Node processes cannot own different Student connections at once', async () => {
  const { session } = await start();
  const remote = await worker();
  try {
    const outcome = remote.wait('result');
    remote.child.send({
      action: 'admission',
      identity: student,
      token: studentToken,
      id: session.id,
      connectionId: 'student-remote-one',
    });
    const local = service.requestAdmission(
      student,
      studentToken,
      session.id,
      'student-local-one',
    );
    const [a, b] = await Promise.all([
      outcome,
      local.then(
        () => true,
        () => false,
      ),
    ]);
    assert.equal(Number(a.ok) + Number(b), 1);
    assert.equal(
      await LiveLessonPresence.countDocuments({ role: 'participant' }),
      1,
    );
  } finally {
    await remote.close();
  }
});

test('two Node processes cannot own different host connections at once', async () => {
  const remote = await worker();
  try {
    const outcome = remote.wait('result');
    remote.child.send({
      action: 'start',
      identity: teacher,
      token: teacherToken,
      id: String(period),
      date,
      connectionId: 'teacher-remote-one',
    });
    const [a, b] = await Promise.all([
      outcome,
      service
        .start(teacher, teacherToken, String(period), date, 'teacher-local-one')
        .then(
          () => true,
          () => false,
        ),
    ]);
    assert.equal(Number(a.ok) + Number(b), 1);
    assert.equal(await LiveLessonPresence.countDocuments({ role: 'host' }), 1);
  } finally {
    await remote.close();
  }
});

test('admission racing End leaves no admitted presence or renewable credential', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await Promise.allSettled([
    service.moderate(
      teacher,
      teacherToken,
      session.id,
      waiting.participant.id,
      'admit',
    ),
    service.end(teacher, teacherToken, session.id),
  ]);
  assert.equal((await LiveLessonSession.findById(session.id))!.status, 'ended');
  assert.equal(
    await LiveLessonPresence.countDocuments({ admission: 'admitted' }),
    0,
  );
  await deny(
    service.join(student, studentToken, session.id, 'student-device-one'),
  );
});

test('cross-process moderation cannot commit through substitute replacement fence', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  await race(
    async s => {
      await SubstituteAssignment.create(
        [
          {
            branchId: branch,
            periodId: period,
            timetableVersionId: version,
            date,
            originalTeacherId: teacher.userId,
            substituteTeacherId: other.userId,
            startTime,
            endTime,
            room: 'A',
            status: 'approved',
            createdBy: teacher.userId,
          },
        ],
        { session: s },
      );
    },
    teacher,
    teacherToken,
    session.id,
    true,
    'moderate',
    waiting.participant.id,
    'admit',
  );
  assert.equal(
    (await LiveLessonPresence.findById(waiting.participant.id))!.admission,
    'waiting',
  );
});

test('rejoin racing remove always ends removed and denies subsequent credentials', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id);
  await Promise.allSettled([
    service.join(student, studentToken, session.id),
    service.moderate(teacher, teacherToken, session.id, id, 'remove'),
  ]);
  assert.equal((await LiveLessonPresence.findById(id))!.admission, 'removed');
  await deny(service.join(student, studentToken, session.id));
});

test('cross-process reconnect cannot pass a committed session End fence', async () => {
  const { session } = await start();
  await admitStudent(session.id);
  await race(
    s =>
      LiveLessonSession.updateOne(
        { _id: session.id },
        { status: 'ended' },
        { session: s },
      ),
    student,
    studentToken,
    session.id,
    false,
    'join',
  );
});

test('maintenance revokes a withdrawn Student without trusting client disconnect reports', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id);
  await service.join(student, studentToken, session.id);
  await StudentEnrollment.updateMany(
    {},
    { status: 'withdrawn', effectiveTo: new Date(Date.now()) },
  );
  await service.maintainClassrooms();
  assert.equal((await LiveLessonPresence.findById(id))!.admission, 'removed');
});

test('host authority loss ends the immutable occurrence instead of silently transferring hosting', async () => {
  const { session } = await start();
  await admitStudent(session.id);
  await service.join(student, studentToken, session.id);
  await TeacherAssignment.updateMany({}, { isActive: false });
  await service.maintainClassrooms();
  assert.equal((await LiveLessonSession.findById(session.id))!.status, 'ended');
  assert.equal(
    await LiveLessonPresence.countDocuments({ admission: 'admitted' }),
    0,
  );
});

test('provider enforcement occurs after durable removal and repeated requests do not duplicate confirmed work', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id);
  await service.join(student, studentToken, session.id);
  await LiveLessonSession.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(session.id) },
    { $set: { provider: 'zegocloud' } },
  );
  let kicks = 0;
  const controlled = createLiveLessonService(
    () => fake,
    async (room, user, until) => {
      kicks++;
      assert.equal(
        (await LiveLessonPresence.findById(id))!.admission,
        'removed',
      );
      assert.equal(room, 'room_' + session.id);
      assert.equal(user, 'opaque');
      assert.ok(until.getTime() > Date.now());
    },
  );
  await controlled.moderate(teacher, teacherToken, session.id, id, 'remove');
  await controlled.moderate(teacher, teacherToken, session.id, id, 'remove');
  assert.equal(kicks, 1);
  assert.equal(
    (await LiveLessonPresence.findById(id))!.enforcement,
    'confirmed',
  );
});

test('closure: stale maintenance snapshot cannot end a freshly reclaimed authorized host connection', async () => {
  const { session } = await start();
  const originalNow = Date.now();
  mock.method(Date, 'now', () => originalNow + 306000);
  await Session.updateOne({ token: teacherToken }, { isRevoked: true });
  const newToken = generateAccessToken(teacher.userId, 'teacher');
  await Session.create({
    userId: teacher.userId,
    role: 'teacher',
    token: newToken,
  });
  const originalFind = Session.find.bind(Session);
  let switched = false;
  mock.method(Session, 'find', ((...args: Parameters<typeof Session.find>) => {
    const query = originalFind(...args);
    const originalSelect = query.select.bind(query);
    query.select = ((...selectArgs: Parameters<typeof query.select>) => {
      const selected = originalSelect(...selectArgs);
      const originalExec = selected.exec.bind(selected);
      selected.exec = (async (
        ...execArgs: Parameters<typeof selected.exec>
      ) => {
        if (!switched) {
          switched = true;
          await service.start(
            teacher,
            newToken,
            String(period),
            date,
            'new-host-connection',
          );
        }
        return originalExec(...execArgs);
      }) as typeof selected.exec;
      return selected;
    }) as typeof query.select;
    return query;
  }) as typeof Session.find);
  await service.maintainClassrooms();
  assert.equal(switched, true);
  assert.equal((await LiveLessonSession.findById(session.id))!.status, 'live');
  const host = await LiveLessonPresence.findOne({
    liveLessonSessionId: session.id,
    role: 'host',
  });
  assert.equal(host!.admission, 'admitted');
  assert.equal(host!.connectionId, 'new-host-connection');
});

test('closure: expired enforcement claims recover across Node processes with one provider attempt', async () => {
  const { session } = await start();
  const id = await admitStudent(session.id);
  await service.join(student, studentToken, session.id);
  await service.moderate(teacher, teacherToken, session.id, id, 'remove');
  await LiveLessonSession.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(session.id) },
    { $set: { provider: 'zegocloud' } },
  );
  // Emulate a previous worker dying after its persisted claim, followed by expiry.
  await LiveLessonPresence.updateOne(
    { _id: id },
    {
      $set: {
        enforcement: 'pending',
        enforcementAfter: new Date(Date.now() - 1),
      },
    },
  );
  const remote = await worker();
  let kicks = 0;
  remote.child.on('message', (message: { type?: string }) => {
    if (message.type === 'kick') kicks++;
  });
  const local = createLiveLessonService(
    () => fake,
    async () => {
      kicks++;
    },
  );
  try {
    const outcome = remote.wait('result');
    remote.child.send({ action: 'enforce', id });
    await Promise.all([outcome, local.enforceRemoval(id)]);
    assert.equal(kicks, 1);
    assert.equal(
      (await LiveLessonPresence.findById(id))!.enforcement,
      'confirmed',
    );
  } finally {
    await remote.close();
  }
});

test('closure: the 500-actor cap preserves the host and returns a safe deterministic conflict', async () => {
  const { session } = await start();
  await LiveLessonPresence.collection.insertMany(
    Array.from({ length: 499 }, () => ({
      liveLessonSessionId: new mongoose.Types.ObjectId(session.id),
      branchId: branch,
      actorId: new mongoose.Types.ObjectId(),
      role: 'participant',
      admission: 'waiting',
    })),
  );
  await assert.rejects(
    service.requestAdmission(
      student,
      studentToken,
      session.id,
      'student-device-one',
    ),
    error =>
      error instanceof Error &&
      error.message === 'Classroom participant capacity reached',
  );
  const roster = await service.classroom(
    teacher,
    teacherToken,
    session.id,
    'internal-connection',
  );
  assert.equal(roster.participants.length, 500);
  assert.equal(roster.participants.filter(p => p.role === 'host').length, 1);
  assert.equal(
    await LiveLessonPresence.countDocuments({
      liveLessonSessionId: session.id,
    }),
    500,
  );
});

test('closure: a stale enforcement completion cannot confirm eviction of a new credential generation', async () => {
  const provider: RtcProvider = {
    ...fake,
    name: 'zegocloud',
    issueCredential: request => ({
      ...fake.issueCredential(request),
      provider: 'zegocloud',
    }),
  };
  let finish!: () => void, began!: () => void;
  const gate = new Promise<void>(resolve => {
    finish = resolve;
  });
  const started = new Promise<void>(resolve => {
    began = resolve;
  });
  const controlled = createLiveLessonService(
    () => provider,
    async () => {
      began();
      await gate;
    },
  );
  const { session } = await controlled.start(
    teacher,
    teacherToken,
    String(period),
    date,
  );
  const id = await admitStudent(session.id);
  const issued = await controlled.join(student, studentToken, session.id);
  await controlled.classroom(
    student,
    studentToken,
    session.id,
    'internal-connection',
    'left',
  );
  const oldJob = controlled.enforceRemoval(id);
  try {
    await started;
    const later = Date.parse(issued.connection.expiresAt) + 6000;
    mock.method(Date, 'now', () => later);
    await controlled.requestAdmission(
      student,
      studentToken,
      session.id,
      'new-student-connection',
    );
    await controlled.moderate(teacher, teacherToken, session.id, id, 'admit');
    await controlled.join(
      student,
      studentToken,
      session.id,
      'new-student-connection',
    );
  } finally {
    finish();
    await oldJob;
  }
  const current = await LiveLessonPresence.findById(id);
  assert.equal(current!.admission, 'admitted');
  assert.equal(current!.enforcement, 'none');
  assert.equal(current!.connectionId, 'new-student-connection');
});

test('closure: malformed classroom action/state types cannot coerce into a different transition', async () => {
  const { session } = await start();
  const waiting = await service.requestAdmission(
    student,
    studentToken,
    session.id,
    'student-device-one',
  );
  for (const action of [['admit'], ['reject'], ['remove'], null, true, {}]) {
    await assert.rejects(
      service.moderate(
        teacher,
        teacherToken,
        session.id,
        waiting.participant.id,
        action,
      ),
      error => (error as { status?: number }).status === 400,
    );
  }
  for (const state of [['connected'], ['left'], null, false, {}]) {
    await assert.rejects(
      service.classroom(
        student,
        studentToken,
        session.id,
        'student-device-one',
        state,
      ),
      error => (error as { status?: number }).status === 400,
    );
  }
  const row = await LiveLessonPresence.findById(waiting.participant.id);
  assert.equal(row!.admission, 'waiting');
  assert.equal(row!.history.length, 1);
});
