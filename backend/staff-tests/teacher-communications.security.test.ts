import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test, mock } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, { type UserRole } from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import Student from '../src/staff/src/models/student';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import SchoolNotice from '../src/staff/src/models/schoolNotice';
import Session from '../src/staff/src/models/session';
import {
  TeacherNotice,
  NoticeDelivery,
  NoticeOperation,
  ensureTeacherNoticeIndexes,
} from '../src/staff/src/models/teacherNotice';
import { AssignedWork } from '../src/staff/src/models/assignedWork';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import type {
  TeacherNotice as NoticeDTO,
  RecipientPreview,
  TeacherQueue,
  TeacherWork,
} from '../../src/staff/services/teacher/communicationService';
// Use the actual mobile adapter with an explicit native-config test boundary.
const configPath = require.resolve('../../src/mobileApp/shared/services/apiConfig.js');
require.cache[configPath] = {id: configPath, filename: configPath, loaded: true, exports: {API_ROOT: 'http://127.0.0.1:1/api'}} as NodeModule;
const {communicationService: actualCommunicationService} = require('../../src/staff/services/teacher/communicationService');

type Actor = { id: string; token: string };
let db: MongoMemoryReplSet, server: Server, base: string;
let a: Actor, b: Actor, foreign: Actor, principal: Actor;
let branch: string,
  otherBranch: string,
  classA: string,
  classB: string,
  foreignClass: string;
let sectionA: string,
  sectionB: string,
  otherSection: string,
  foreignSection: string,
  math: string,
  science: string;
let assignment: string,
  learner: string,
  secondLearner: string,
  wrongLearner: string;
const secret = process.env.JWT_SECRET;
const permissions = [...ROLE_PERMISSIONS.teacher];
const ids = () => new mongoose.Types.ObjectId().toString();
const actor = async (
  name: string,
  role: UserRole,
  branchId: string,
): Promise<Actor> => {
  const user = await new User({
    fullName: name,
    email: `${name}@test.invalid`,
    password: 'private-password',
    phone: '+923001234567',
    role,
    branchId,
  }).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return { id: String(user._id), token };
};
const http = async <T = NoticeDTO>(
  path: string,
  person: Actor = a,
  method = 'GET',
  body?: unknown,
) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${person.token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  const value = JSON.parse(raw) as { data: T; message: string };
  return {
    status: response.status,
    data: value.data,
    raw,
    message: value.message,
    cache: response.headers.get('cache-control'),
  };
};
const context = (extra: Record<string, unknown> = {}) => ({
  classId: classA,
  sectionId: sectionA,
  subjectId: math,
  audienceType: 'class_students',
  ...extra,
});
const content = (extra: Record<string, unknown> = {}) => ({
  ...context(),
  title: 'Class announcement',
  body: 'Bring your maths book tomorrow.',
  language: 'en',
  ...extra,
});
const draft = async () => {
  const result = await http('/teacher/notices', a, 'POST', content());
  assert.equal(result.status, 200, result.message);
  return result.data;
};
const send = (
  notice: NoticeDTO,
  operation = 'operation_for_notice_001',
  extra = {},
) =>
  http(`/teacher/notices/${notice.noticeId}/send`, a, 'POST', {
    revision: notice.revision,
    clientOperationId: operation,
    ...extra,
  });
const assign = (extra: Record<string, unknown> = {}) =>
  http<TeacherWork>('/assigned-work', principal, 'POST', {
    assigneeUserId: a.id,
    sourceType: 'coordinator_follow_up',
    title: 'Coordinator follow-up',
    summary: 'Review the upcoming school activity.',
    ...extra,
  });

before(async () => {
  process.env.JWT_SECRET = 'teacher-communications-isolated-test-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'teacher_communication_tests',
    autoIndex: false,
  });
  await Promise.all([
    ensureTeacherNoticeIndexes(),
    AssignedWork.createIndexes(),
    TeacherAssignment.createIndexes(),
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});
beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map(c => c.deleteMany({})),
  );
  const ba = await new Branch({
    name: 'Main',
    code: 'MAIN',
    address: 'School',
    city: 'Lahore',
  }).save();
  branch = String(ba._id);
  const bb = await new Branch({
    name: 'Other',
    code: 'OTHER',
    address: 'Other school',
    city: 'Karachi',
  }).save();
  otherBranch = String(bb._id);
  a = await actor('TeacherA', 'teacher', branch);
  b = await actor('TeacherB', 'teacher', branch);
  foreign = await actor('Foreign', 'teacher', otherBranch);
  principal = await actor('Principal', 'principal', branch);
  const makeClass = async (name: string, branchId = branch) =>
    String(
      (
        await new SchoolClass({
          branchId,
          name,
          code: name,
          academicYear: '2026',
        }).save()
      )._id,
    );
  classA = await makeClass('ClassA');
  classB = await makeClass('ClassB');
  foreignClass = await makeClass('ForeignClass', otherBranch);
  const makeSection = async (
    name: string,
    classId: string,
    branchId = branch,
  ) =>
    String(
      (await new Section({ branchId, classId, name, code: name }).save())._id,
    );
  sectionA = await makeSection('A', classA);
  sectionB = await makeSection('B', classA);
  otherSection = await makeSection('Other', classB);
  foreignSection = await makeSection('Foreign', foreignClass, otherBranch);
  math = String(
    (await new Subject({ branchId: branch, name: 'Math' }).save())._id,
  );
  science = String(
    (await new Subject({ branchId: branch, name: 'Science' }).save())._id,
  );
  const makeAssignment = async (
    teacherId: string,
    classId: string,
    sectionId: string,
    subjectId: string,
  ) =>
    String(
      (
        await new TeacherAssignment({
          teacherId,
          branchId: branch,
          classId,
          sectionId,
          subjectId,
          validFrom: new Date(Date.now() - 86400000),
          createdBy: principal.id,
          updatedBy: principal.id,
        }).save()
      )._id,
    );
  assignment = await makeAssignment(a.id, classA, sectionA, math);
  await makeAssignment(a.id, classB, otherSection, science);
  await makeAssignment(b.id, classA, sectionB, math);
  const student = async (name: string, sectionId: string) => {
    const user = await actor(name, 'student', branch);
    return String(
      (
        await new Student({
          userId: user.id,
          branchId: branch,
          classId: classA,
          sectionId,
          admissionNumber: name,
          guardianPhone: '+923009999999',
          address: 'Private home',
        }).save()
      )._id,
    );
  };
  learner = await student('Learner', sectionA);
  secondLearner = await student('Second', sectionA);
  wrongLearner = await student('Wrong', sectionB);
});
afterEach(() => {
  mock.restoreAll();
  ROLE_PERMISSIONS.teacher = [...permissions];
});
after(async () => {
  if (secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = secret;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
  await db.stop();
});

test('preview count and exact DTO exclude all confidential profile and identity data', async () => {
  // Exercise the actual frontend adapter against this owned local API. No
  // request is allowed to reach the configured development LAN address.
  const originalFetch = globalThis.fetch;
  const localAPI = mock.method(
    globalThis,
    'fetch',
    (...[url, init]: Parameters<typeof fetch>) => {
      assert.equal(
        new URL(String(url)).pathname,
        '/api/teacher/notices/preview',
      );
      return originalFetch(`${base}/teacher/notices/preview`, init);
    },
  );
  const actualPreview = await actualCommunicationService.preview(
    a.token,
    content(),
  );
  localAPI.mock.restore();
  assert.equal(actualPreview.recipientCount, 2);
  const preview = await http<RecipientPreview>(
    '/teacher/notices/preview',
    a,
    'POST',
    context(),
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.data.recipientCount, 2);
  assert.deepEqual(Object.keys(preview.data).sort(), [
    'audienceType',
    'channel',
    'context',
    'recipientCount',
  ]);
  assert.deepEqual(Object.keys(preview.data.context).sort(), [
    'assignmentId',
    'classId',
    'className',
    'sectionId',
    'sectionName',
    'subjectId',
    'subjectName',
  ]);
  assert.equal(preview.cache, 'no-store');
  for (const privateValue of [
    'phone',
    'email',
    'password',
    'guardian',
    'address',
    'finance',
    'counsel',
    'token',
    'session',
    'Learner',
  ])
    assert.ok(!preview.raw.includes(privateValue));
});
for (const attack of [
  'unrelated_class',
  'other_section',
  'foreign_branch',
  'subject_mismatch',
  'cross_product',
  'recipient_ids',
  'branch_spoof',
]) {
  test(`preview/draft reject ${attack}`, async () => {
    const override: Record<string, unknown> =
      attack === 'unrelated_class'
        ? { classId: classB, sectionId: otherSection }
        : attack === 'other_section'
        ? { sectionId: sectionB }
        : attack === 'foreign_branch'
        ? { classId: foreignClass, sectionId: foreignSection }
        : attack === 'subject_mismatch'
        ? { subjectId: science }
        : attack === 'cross_product'
        ? { classId: classB, sectionId: sectionA, subjectId: science }
        : attack === 'recipient_ids'
        ? { recipientIds: [wrongLearner] }
        : { branchId: otherBranch };
    const expected = ['recipient_ids', 'branch_spoof'].includes(attack)
      ? 400
      : 404;
    assert.equal(
      (await http('/teacher/notices/preview', a, 'POST', context(override)))
        .status,
      expected,
    );
    assert.equal(
      (await http('/teacher/notices', a, 'POST', content(override))).status,
      expected,
    );
    assert.equal(await NoticeDelivery.countDocuments(), 0);
  });
}
test('draft history is creator-only; foreign and unrelated Teachers receive concealed 404', async () => {
  const notice = await draft();
  assert.equal((await http(`/teacher/notices/${notice.noticeId}`)).status, 200);
  for (const person of [b, foreign]) {
    assert.equal(
      (await http(`/teacher/notices/${notice.noticeId}`, person)).status,
      404,
    );
    assert.equal(
      (
        await http(`/teacher/notices/${notice.noticeId}/send`, person, 'POST', {
          revision: 0,
          clientOperationId: 'attacker_operation_01',
        })
      ).status,
      404,
    );
  }
  assert.equal(notice.state, 'draft');
  assert.equal(await NoticeDelivery.countDocuments(), 0);
});
test('send removes moved students and never persists wrong-class recipients', async () => {
  const notice = await draft();
  assert.equal(
    (
      await http<RecipientPreview>(
        '/teacher/notices/preview',
        a,
        'POST',
        context(),
      )
    ).data.recipientCount,
    2,
  );
  await Student.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(learner) },
    { $set: { sectionId: new mongoose.Types.ObjectId(sectionB) } },
  );
  const result = await send(notice);
  assert.equal(result.status, 200, result.message);
  assert.equal(result.data.recipientCount, 1);
  const records = await NoticeDelivery.find().lean();
  assert.equal(records.length, 1);
  assert.equal(String(records[0].studentId), secondLearner);
  assert.equal(result.data.deliveryState, 'accepted_internal');
});
for (const change of [
  'assignment',
  'branch',
  'role',
  'permission',
  'session',
  'student_role',
  'student_branch',
]) {
  test(`send reauthorizes changed ${change} after preview`, async () => {
    const notice = await draft();
    await http('/teacher/notices/preview', a, 'POST', context());
    if (change === 'assignment')
      await TeacherAssignment.updateOne(
        { _id: assignment },
        { $set: { isActive: false } },
      );
    if (change === 'branch')
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(a.id) },
        { $set: { branchId: new mongoose.Types.ObjectId(otherBranch) } },
      );
    if (change === 'role')
      await User.updateOne({ _id: a.id }, { $set: { role: 'student' } });
    if (change === 'permission')
      ROLE_PERMISSIONS.teacher = permissions.filter(
        p => p !== PERMISSIONS.TEACHER_NOTICES_MANAGE,
      );
    if (change === 'session')
      await Session.updateMany(
        { token: a.token },
        { $set: { isRevoked: true } },
      );
    if (change.startsWith('student_')) {
      const row = await Student.findById(learner).select('userId');
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(String(row!.userId)) },
        {
          $set:
            change === 'student_role'
              ? { role: 'teacher' }
              : { branchId: new mongoose.Types.ObjectId(otherBranch) },
        },
      );
    }
    const result = await send(notice);
    if (change.startsWith('student_')) {
      assert.equal(result.status, 200);
      assert.equal(result.data.recipientCount, 1);
    } else {
      assert.ok([401, 403, 404].includes(result.status), result.message);
      assert.equal(await NoticeDelivery.countDocuments(), 0);
    }
  });
}
test('revoked drafts remain history but cannot be retargeted or sent', async () => {
  const notice = await draft();
  await TeacherAssignment.updateOne(
    { _id: assignment },
    { $set: { isActive: false } },
  );
  const history = await http(`/teacher/notices/${notice.noticeId}`);
  assert.equal(history.status, 200);
  assert.equal(history.data.canEdit, false);
  assert.equal(
    (
      await http(
        `/teacher/notices/${notice.noticeId}`,
        a,
        'PATCH',
        content({
          classId: classB,
          sectionId: otherSection,
          subjectId: science,
          revision: 0,
        }),
      )
    ).status,
    404,
  );
  assert.equal((await send(notice)).status, 404);
});
test('duplicate concurrent send and replay create one logical publication; changed payload conflicts', async () => {
  const notice = await draft();
  const results = await Promise.all([send(notice), send(notice), send(notice)]);
  results.forEach(r => assert.equal(r.status, 200, r.message));
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal(await NoticeOperation.countDocuments(), 1);
  assert.equal(await NoticeDelivery.countDocuments(), 2);
  assert.equal((await send(notice)).status, 200);
  assert.equal(
    (await send(notice, 'operation_for_notice_001', { revision: 1 })).status,
    409,
  );
  assert.equal((await send(notice, 'new_intentional_operation')).status, 409);
  assert.equal(
    (
      await http(
        `/teacher/notices/${notice.noticeId}`,
        a,
        'PATCH',
        content({ revision: 1 }),
      )
    ).status,
    409,
  );
});
test('same operation cannot publish a different draft; input recipient injection rejected at send', async () => {
  const first = await draft(),
    second = await draft();
  assert.equal((await send(first)).status, 200);
  assert.equal((await send(second)).status, 409);
  assert.equal(
    (
      await send(second, 'safe_new_operation_01', {
        recipientIds: [wrongLearner],
      })
    ).status,
    400,
  );
});
test('revision CAS rejects concurrent edits and stale send, and content contact disclosure is blocked', async () => {
  const notice = await draft();
  const results = await Promise.all([
    http(
      `/teacher/notices/${notice.noticeId}`,
      a,
      'PATCH',
      content({ revision: 0, title: 'First edit' }),
    ),
    http(
      `/teacher/notices/${notice.noticeId}`,
      a,
      'PATCH',
      content({ revision: 0, title: 'Second edit' }),
    ),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await send(notice)).status, 409);
  for (const body of ['Call +92 300 1234567', 'Email private@staff.invalid'])
    assert.equal(
      (await http('/teacher/notices', a, 'POST', content({ body }))).status,
      400,
    );
});
test('published class visibility requires exact supervising tuple; no draft sharing', async () => {
  const notice = await draft();
  await send(notice);
  assert.equal(
    (await http(`/teacher/notices/${notice.noticeId}`, b)).status,
    404,
  );
  await new TeacherAssignment({
    teacherId: b.id,
    branchId: branch,
    classId: classA,
    sectionId: sectionA,
    subjectId: math,
    validFrom: new Date(0),
    createdBy: principal.id,
    updatedBy: principal.id,
  }).save();
  assert.equal(
    (await http(`/teacher/notices/${notice.noticeId}`, b)).status,
    200,
  );
  const second = await draft();
  assert.equal(
    (await http(`/teacher/notices/${second.noticeId}`, b)).status,
    404,
  );
});
test('Inbox includes only explicitly opted-in active branch school notices and exact DTO keys', async () => {
  const n = await draft();
  for (const data of [
    { title: 'Legacy' },
    { title: 'Teachers', audienceRoles: ['teacher'] },
    { title: 'Expired', audienceRoles: ['teacher'], expiresAt: new Date(0) },
    { title: 'Foreign', audienceRoles: ['teacher'], branchId: otherBranch },
  ])
    await new SchoolNotice({
      branchId: branch,
      message: 'School announcement',
      createdBy: principal.id,
      status: 'published',
      ...data,
    }).save();
  const queue = await http<TeacherQueue<NoticeDTO>>('/teacher/inbox');
  assert.equal(queue.status, 200, queue.message);
  assert.equal(queue.data.total, 2);
  const school = queue.data.items.find(item => item.kind === 'school_notice')!;
  const storedSchool = await SchoolNotice.findById(school.noticeId);
  assert.equal(school.updatedAt, storedSchool!.updatedAt.toISOString());
  assert.deepEqual(Object.keys(queue.data).sort(), [
    'items',
    'nextOffset',
    'total',
  ]);
  const dto = queue.data.items.find(i => i.noticeId === n.noticeId)!;
  assert.deepEqual(Object.keys(dto).sort(), [
    'audienceType',
    'body',
    'canEdit',
    'channel',
    'classId',
    'createdAt',
    'deliveryState',
    'kind',
    'language',
    'noticeId',
    'publishedAt',
    'recipientCount',
    'revision',
    'sectionId',
    'state',
    'subjectId',
    'title',
    'updatedAt',
  ]);
  for (const privateKey of [
    'createdBy',
    'clientOperationId',
    'guardian',
    'password',
    'phone',
    'address',
    'recipientUserId',
  ])
    assert.ok(!queue.raw.includes(privateKey));
});
test('bounded Inbox pagination totals use the same shared policy', async () => {
  await TeacherNotice.insertMany(
    Array.from({ length: 55 }, (_, index) => ({
      branchId: branch,
      createdBy: a.id,
      ...content(),
      title: `Notice ${index}`,
    })),
  );
  const first = await http<TeacherQueue<NoticeDTO>>('/teacher/inbox');
  const second = await http<TeacherQueue<NoticeDTO>>(
    '/teacher/inbox?offset=50',
  );
  assert.equal(first.data.total, 55);
  assert.equal(first.data.items.length, 50);
  assert.equal(first.data.nextOffset, 50);
  assert.equal(second.data.items.length, 5);
  assert.equal(second.data.nextOffset, null);
  assert.equal(
    (await http('/teacher/inbox?recipientIds=anything')).status,
    400,
  );
});
test('Teacher assigned work is explicit, branch scoped, concealed, and uses exact privacy DTO keys', async () => {
  const own = await assign();
  assert.equal(own.status, 200, own.message);
  await assign({ assigneeUserId: b.id });
  const queue = await http<TeacherQueue<TeacherWork>>('/teacher/tasks');
  assert.equal(queue.status, 200);
  assert.equal(queue.data.total, 1);
  assert.deepEqual(Object.keys(queue.data.items[0]).sort(), [
    'canComplete',
    'completedAt',
    'createdAt',
    'dueAt',
    'priority',
    'revision',
    'source',
    'sourceType',
    'status',
    'summary',
    'title',
    'updatedAt',
    'workId',
  ]);
  for (const person of [b, foreign])
    assert.equal(
      (await http(`/teacher/tasks/${own.data.workId}`, person)).status,
      404,
    );
  assert.equal((await http(`/teacher/tasks/${ids()}`)).status, 404);
  for (const key of [
    'assignedBy',
    'assigneeUserId',
    'branchId',
    'history',
    'phone',
    'password',
    'token',
  ])
    assert.ok(!queue.raw.includes(key));
});
test('class source policy is enforced both when assigning and after revocation; task ownership does not grant source authority', async () => {
  const forbidden = await assign({
    sourceType: 'class_follow_up',
    sourceId: classA,
    sectionId: sectionB,
    subjectId: math,
  });
  assert.equal(forbidden.status, 404);
  const work = await assign({
    sourceType: 'class_follow_up',
    sourceId: classA,
    sectionId: sectionA,
    subjectId: math,
  });
  assert.equal(work.status, 200, work.message);
  ROLE_PERMISSIONS.teacher = permissions.filter(
    p => p !== PERMISSIONS.TEACHER_CLASSES_VIEW,
  );
  assert.equal(
    (await http<TeacherQueue<TeacherWork>>('/teacher/tasks')).data.total,
    0,
  );
  assert.equal((await http(`/teacher/tasks/${work.data.workId}`)).status, 404);
  assert.equal(
    (await http(`/teacher/tasks/${work.data.workId}/complete`, a, 'POST', {}))
      .status,
    404,
  );
  assert.equal(
    (
      await http(
        `/teacher/classes/${classA}/sections/${sectionA}/subjects/${math}/students`,
      )
    ).status,
    403,
  );
  ROLE_PERMISSIONS.teacher = [...permissions];
  const originalSession = mongoose.startSession.bind(mongoose);
  const sourcePermissionChange = mock.method(
    mongoose,
    'startSession',
    async () => {
      sourcePermissionChange.mock.restore();
      ROLE_PERMISSIONS.teacher = permissions.filter(
        p => p !== PERMISSIONS.TEACHER_CLASSES_VIEW,
      );
      return originalSession();
    },
  );
  assert.equal(
    (await http(`/teacher/tasks/${work.data.workId}/complete`, a, 'POST', {}))
      .status,
    403,
  );
  assert.equal((await AssignedWork.findById(work.data.workId))!.status, 'open');
  ROLE_PERMISSIONS.teacher = [...permissions];
  await TeacherAssignment.updateOne(
    { _id: assignment },
    { $set: { isActive: false } },
  );
  assert.equal(
    (await http<TeacherQueue<TeacherWork>>('/teacher/tasks')).data.total,
    0,
  );
  assert.equal((await http(`/teacher/tasks/${work.data.workId}`)).status, 404);
  assert.equal(
    (await http(`/teacher/tasks/${work.data.workId}/complete`, a, 'POST', {}))
      .status,
    404,
  );
  assert.equal(
    (
      await http(
        `/teacher/classes/${classA}/sections/${sectionA}/subjects/${math}/students`,
      )
    ).status,
    404,
  );
});
test('forged ownership records cannot bypass class source authorization', async () => {
  const spoofed = await new AssignedWork({
    branchId: branch,
    assigneeUserId: a.id,
    assignedBy: principal.id,
    sourceType: 'class_follow_up',
    sourceId: classA,
    sectionId: sectionB,
    subjectId: math,
    title: 'Forbidden',
    summary: 'Forbidden source',
  }).save();
  assert.equal((await http(`/teacher/tasks/${spoofed._id}`)).status, 404);
  assert.equal(
    (await http<TeacherQueue<TeacherWork>>('/teacher/tasks')).data.total,
    0,
  );
});
test('completion concurrent replay is idempotent with one transition and queue removal', async () => {
  const work = await assign();
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      http<TeacherWork>(
        `/teacher/tasks/${work.data.workId}/complete`,
        a,
        'POST',
        {},
      ),
    ),
  );
  results.forEach(r => assert.equal(r.status, 200, r.message));
  assert.deepEqual(results[0].data, results[1].data);
  const stored = await AssignedWork.findById(work.data.workId);
  assert.equal(stored!.revision, 1);
  assert.equal(stored!.history.filter(h => h.action === 'completed').length, 1);
  assert.equal(
    (await http<TeacherQueue<TeacherWork>>('/teacher/tasks')).data.total,
    0,
  );
});
test('withdrawal closes work; concurrent completion/withdrawal serializes to cancelled', async () => {
  const work = await assign();
  const results = await Promise.all([
    http(`/teacher/tasks/${work.data.workId}/complete`, a, 'POST', {}),
    http(`/assigned-work/${work.data.workId}/cancel`, principal, 'POST', {}),
  ]);
  assert.ok([200, 409].includes(results[0].status), results[0].message);
  assert.equal(results[1].status, 200, results[1].message);
  assert.equal(
    (await AssignedWork.findById(work.data.workId))!.status,
    'cancelled',
  );
  assert.equal((await http(`/teacher/tasks/${work.data.workId}`)).status, 404);
  assert.equal(
    (await http(`/teacher/tasks/${work.data.workId}/complete`, a, 'POST', {}))
      .status,
    409,
  );
});
test('inactive or removed class source closes stale open work', async () => {
  const work = await assign({
    sourceType: 'class_follow_up',
    sourceId: classA,
    sectionId: sectionA,
    subjectId: math,
  });
  await SchoolClass.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(classA) },
    { $set: { isActive: false } },
  );
  assert.equal(
    (await http<TeacherQueue<TeacherWork>>('/teacher/tasks')).data.total,
    0,
  );
  assert.equal(
    (await AssignedWork.findById(work.data.workId))!.status,
    'cancelled',
  );
});
test('Teachers cannot mutate ownership, assign work, withdraw work or approve Principal requests', async () => {
  const work = await assign();
  assert.equal(
    (await http('/assigned-work', a, 'POST', { assigneeUserId: a.id })).status,
    403,
  );
  assert.equal(
    (await http(`/assigned-work/${work.data.workId}/cancel`, a, 'POST', {}))
      .status,
    403,
  );
  assert.equal(
    (
      await http(`/teacher/tasks/${work.data.workId}/complete`, a, 'POST', {
        assigneeUserId: b.id,
      })
    ).status,
    400,
  );
  for (const body of [
    { branchId: branch },
    { assigneeRole: 'principal' },
    { sourceType: 'approval_request' },
  ])
    assert.equal((await assign(body)).status, 400);
  assert.equal((await assign({ assigneeUserId: foreign.id })).status, 404);
  assert.equal((await http('/approval-requests/pending')).status, 403);
  assert.equal(
    (
      await http(`/approval-requests/${ids()}`, a, 'PATCH', {
        action: 'approved',
      })
    ).status,
    403,
  );
  assert.ok(
    !ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE),
  );
});

for (const change of [
  'assignment',
  'branch',
  'role',
  'permission',
  'session',
  'class',
  'section',
  'subject',
]) {
  test(`send fences reject ${change} changing after initial authorization`, async () => {
    const notice = await draft();
    const original = mongoose.startSession.bind(mongoose);
    const hook = mock.method(mongoose, 'startSession', async () => {
      hook.mock.restore();
      if (change === 'assignment')
        await TeacherAssignment.updateOne(
          { _id: assignment },
          { $set: { isActive: false } },
        );
      if (change === 'branch')
        await User.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(a.id) },
          { $set: { branchId: new mongoose.Types.ObjectId(otherBranch) } },
        );
      if (change === 'role')
        await User.updateOne({ _id: a.id }, { $set: { role: 'student' } });
      if (change === 'permission')
        ROLE_PERMISSIONS.teacher = permissions.filter(
          p => p !== PERMISSIONS.TEACHER_NOTICES_MANAGE,
        );
      if (change === 'session')
        await Session.updateMany(
          { token: a.token },
          { $set: { isRevoked: true } },
        );
      if (change === 'class')
        await SchoolClass.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(classA) },
          { $set: { isActive: false } },
        );
      if (change === 'section')
        await Section.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(sectionA) },
          { $set: { isActive: false } },
        );
      if (change === 'subject')
        await Subject.updateOne({ _id: math }, { $set: { isActive: false } });
      return original();
    });
    const result = await send(notice);
    assert.ok([401, 403, 404].includes(result.status), result.message);
    assert.equal(await NoticeDelivery.countDocuments(), 0);
    assert.equal(await NoticeOperation.countDocuments(), 0);
    assert.equal(
      (await TeacherNotice.findById(notice.noticeId))!.state,
      'draft',
    );
  });
}
test('permission invalidation after staged publication rolls back deliveries, notice and operation', async () => {
  const notice = await draft();
  const original = NoticeOperation.create.bind(NoticeOperation);
  const hook = mock.method(
    NoticeOperation,
    'create',
    (...args: Parameters<typeof NoticeOperation.create>) => {
      hook.mock.restore();
      ROLE_PERMISSIONS.teacher = permissions.filter(
        p => p !== PERMISSIONS.TEACHER_NOTICES_MANAGE,
      );
      return original(...args);
    },
  );
  assert.equal((await send(notice)).status, 403);
  assert.equal(await NoticeDelivery.countDocuments(), 0);
  assert.equal(await NoticeOperation.countDocuments(), 0);
  assert.equal((await TeacherNotice.findById(notice.noticeId))!.state, 'draft');
});
test('enrollment movement at publication boundary serializes after recipient fences', async () => {
  const notice = await draft();
  const original = NoticeDelivery.insertMany.bind(NoticeDelivery);
  let movement: Promise<unknown> | undefined,
    moved = false;
  const hook = mock.method(
    NoticeDelivery,
    'insertMany',
    async (...args: Parameters<typeof NoticeDelivery.insertMany>) => {
      hook.mock.restore();
      movement = Student.collection
        .updateOne(
          { _id: new mongoose.Types.ObjectId(learner) },
          { $set: { sectionId: new mongoose.Types.ObjectId(sectionB) } },
        )
        .then(() => {
          moved = true;
        });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(moved, false);
      return original(...args);
    },
  );
  assert.equal((await send(notice)).status, 200);
  await movement;
  assert.equal(moved, true);
  assert.equal(await NoticeDelivery.countDocuments(), 2);
});
test('empty audience is not published and index invariants exist with autoIndex disabled', async () => {
  const notice = await draft();
  await Student.updateMany({}, { $set: { isActive: false } });
  assert.equal((await send(notice)).status, 409);
  assert.equal(await NoticeDelivery.countDocuments(), 0);
  const operationIndexes = await NoticeOperation.collection.indexes();
  assert.ok(
    operationIndexes.some(
      index =>
        index.unique &&
        index.key.createdBy === 1 &&
        index.key.clientOperationId === 1,
    ),
  );
  const deliveryIndexes = await NoticeDelivery.collection.indexes();
  assert.ok(
    deliveryIndexes.some(
      index =>
        index.unique && index.key.noticeId === 1 && index.key.studentId === 1,
    ),
  );
});
