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
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import { Syllabus } from '../src/staff/src/models/syllabus';
import { LessonPlan } from '../src/staff/src/models/lessonPlan';
import { SubstituteAssignment } from '../src/staff/src/models/timetable';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import {
  addScheduleDays,
  schoolToday,
} from '../src/staff/src/services/school-date.service';

let db: MongoMemoryReplSet, server: Server, base: string;
let branch: any,
  foreign: any,
  teacher: any,
  other: any,
  foreignTeacher: any,
  student: any,
  principal: any,
  admin: any;
let schoolClass: any,
  section: any,
  sectionB: any,
  subject: any,
  otherSubject: any,
  assignment: any,
  syllabus: any;
const originalSecret = process.env.JWT_SECRET;
const originalTimezone = process.env.SCHOOL_TIMEZONE;
const planningDate = () => addScheduleDays(schoolToday(), 10);
const id = () => String(new mongoose.Types.ObjectId());
const actor = async (role: UserRole, branchId = branch) => {
  const u = await User.create({
    fullName: 'Ayesha Teacher',
    email: `${id()}@test.invalid`,
    password: 'private-password',
    role,
    branchId,
  });
  const token = generateAccessToken(String(u._id), role);
  await registerSession(String(u._id), token, role);
  return { id: u._id, token };
};
const http = async (
  path: string,
  person = teacher,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${person.token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    json: (await res.json()) as any,
    cache: res.headers.get('cache-control'),
  };
};
const tuple = (extra = {}) => ({
  classId: String(schoolClass._id),
  sectionId: String(section._id),
  subjectId: String(subject._id),
  ...extra,
});
const query = (extra = {}) => new URLSearchParams(tuple(extra)).toString();
const draft = (extra = {}) => ({
  ...tuple(),
  syllabusId: syllabus.syllabusId,
  unitId: syllabus.units[0].unitId,
  topicIds: [syllabus.units[0].topics[0].topicId],
  teachingDate: planningDate(),
  objectives: 'Compare numbers',
  teachingActivities: 'Guided practice',
  resources: 'Workbook',
  notes: '',
  clientOperationId: 'academic_create_operation_01',
  ...extra,
});
const createSyllabus = (extra = {}) =>
  http('/syllabuses', admin, {
    classId: String(schoolClass._id),
    subjectId: String(subject._id),
    version: 1,
    title: 'Mathematics syllabus',
    units: [
      {
        title: 'Numbers',
        topics: [{ title: 'Integers', outcomes: ['Compare integers'] }],
      },
      { title: 'Algebra', topics: [{ title: 'Expressions' }] },
    ],
    ...extra,
  });
before(async () => {
  process.env.JWT_SECRET = 'isolated-academic-security-secret';
  process.env.SCHOOL_TIMEZONE = 'Asia/Karachi';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'academic_security',
    autoIndex: false,
  });
  await Promise.all([
    Syllabus.createIndexes(),
    LessonPlan.createIndexes(),
    TeacherAssignment.createIndexes(),
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
beforeEach(async () => {
  for (const m of [
    LessonPlan,
    Syllabus,
    TeacherAssignment,
    SubstituteAssignment,
    Subject,
    Section,
    SchoolClass,
    Session,
    User,
    Branch,
  ])
    await m.collection.deleteMany({});
  branch = (
    await Branch.create({
      name: 'Branch A',
      code: 'AA',
      address: 'private',
      city: 'Lahore',
    })
  )._id;
  foreign = (
    await Branch.create({
      name: 'Branch B',
      code: 'BB',
      address: 'private',
      city: 'Lahore',
    })
  )._id;
  teacher = await actor('teacher');
  other = await actor('teacher');
  foreignTeacher = await actor('teacher', foreign);
  student = await actor('student');
  principal = await actor('principal');
  admin = await actor('super_admin');
  schoolClass = await SchoolClass.create({
    branchId: branch,
    name: 'Grade 8',
    code: '8',
    academicYear: '2026–27',
  });
  section = await Section.create({
    branchId: branch,
    classId: schoolClass._id,
    name: 'A',
    code: 'A',
  });
  sectionB = await Section.create({
    branchId: branch,
    classId: schoolClass._id,
    name: 'B',
    code: 'B',
  });
  subject = await Subject.create({ branchId: branch, name: 'Mathematics' });
  otherSubject = await Subject.create({ branchId: branch, name: 'Science' });
  assignment = await TeacherAssignment.create({
    teacherId: teacher.id,
    branchId: branch,
    classId: schoolClass._id,
    sectionId: section._id,
    subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000),
    validUntil: new Date(Date.now() + 365 * 86400000),
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  await seedCurriculumFixtures();
  const created = await createSyllabus();
  assert.equal(created.status, 200);
  const published = await http(
    `/syllabuses/${created.json.data.syllabusId}/publish`,
    admin,
    { revision: 1 },
  );
  assert.equal(published.status, 200);
  syllabus = published.json.data;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTimezone === undefined) delete process.env.SCHOOL_TIMEZONE;
  else process.env.SCHOOL_TIMEZONE = originalTimezone;
});
test('assigned teacher reads published hierarchy through exact section context with safe DTO', async () => {
  const res = await http(
    `/teacher/academic/syllabuses/${syllabus.syllabusId}?${query()}`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.cache, 'no-store');
  assert.equal(res.json.data.syllabus.units[0].topics[0].title, 'Integers');
  assert.deepEqual(Object.keys(res.json.data).sort(), [
    'academicYear',
    'assignment',
    'syllabus',
    'teacherName',
  ]);
  assert.doesNotMatch(
    JSON.stringify(res.json),
    /password|email|publishedBy|createdBy|private|coverage|percent/,
  );
});
test('unassigned, wrong branch, wrong section, wrong subject and guessed syllabus are concealed', async () => {
  for (const [person, extra, syllabusId] of [
    [other, {}, syllabus.syllabusId],
    [foreignTeacher, {}, syllabus.syllabusId],
    [teacher, { sectionId: String(sectionB._id) }, syllabus.syllabusId],
    [teacher, { subjectId: String(otherSubject._id) }, syllabus.syllabusId],
    [teacher, {}, id()],
  ] as any[]) {
    assert.equal(
      (
        await http(
          `/teacher/academic/syllabuses/${syllabusId}?${query(extra)}`,
          person,
        )
      ).status,
      404,
    );
  }
});
test('draft hidden; replacement retires prior publication without destroying its structure', async () => {
  const next = (await createSyllabus({ version: 2 })).json.data;
  assert.equal(
    (await http(`/teacher/academic/syllabuses/${next.syllabusId}?${query()}`))
      .status,
    404,
  );
  assert.equal(
    (
      await http(`/syllabuses/${next.syllabusId}/publish`, admin, {
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await http(
        `/teacher/academic/syllabuses/${syllabus.syllabusId}?${query()}`,
      )
    ).status,
    404,
  );
  const old = await Syllabus.findById(syllabus.syllabusId);
  assert.equal(old?.status, 'retired');
  assert.equal(old?.units[0].title, 'Numbers');
  assert.equal(await Syllabus.countDocuments({ status: 'published' }), 1);
});
test('published structures cannot be overwritten and admin revision is checked', async () => {
  assert.equal(
    (
      await http(
        `/syllabuses/${syllabus.syllabusId}`,
        admin,
        { revision: 2, title: 'Overwrite', units: [] },
        'PATCH',
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(`/syllabuses/${syllabus.syllabusId}/retire`, admin, {
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http(`/syllabuses/${syllabus.syllabusId}/retire`, admin, {
        revision: 2,
      })
    ).status,
    200,
  );
  assert.equal(
    (await http(`/teacher/academic/context?${query()}`)).json.data.syllabus,
    null,
  );
});
test('teacher creates mapped draft; duplicate concurrent operation produces one record', async () => {
  const res = await Promise.all([
    http('/teacher/academic/lessons', teacher, draft()),
    http('/teacher/academic/lessons', teacher, draft()),
  ]);
  assert.deepEqual(
    res.map(r => r.status),
    [200, 200],
  );
  assert.equal(res[0].json.data.lessonPlanId, res[1].json.data.lessonPlanId);
  assert.equal(await LessonPlan.countDocuments(), 1);
  assert.equal(res[0].json.data.state, 'draft');
  assert.equal(
    (
      await http(
        '/teacher/academic/lessons',
        teacher,
        draft({ notes: 'Different payload' }),
      )
    ).status,
    409,
  );
});
test('foreign class/syllabus/topic and unit-topic cross-product are denied', async () => {
  for (const change of [
    { classId: id() },
    { syllabusId: id() },
    { topicIds: [id()] },
    {
      unitId: syllabus.units[1].unitId,
      topicIds: [syllabus.units[0].topics[0].topicId],
    },
  ]) {
    assert.equal(
      (await http('/teacher/academic/lessons', teacher, draft(change))).status,
      404,
    );
  }
  assert.equal(await LessonPlan.countDocuments(), 0);
});
test('optimistic updates, retry identity, submission snapshot and frozen submitted content', async () => {
  const lesson = (await http('/teacher/academic/lessons', teacher, draft()))
    .json.data;
  const path = `/teacher/academic/lessons/${lesson.lessonPlanId}`;
  const update = {
    unitId: lesson.unitId,
    topicIds: lesson.topicIds,
    teachingDate: lesson.teachingDate,
    objectives: 'Revised objectives',
    teachingActivities: 'Practice',
    resources: '',
    notes: '',
    revision: 1,
    clientOperationId: 'academic_update_operation_01',
  };
  const updated = await http(path, teacher, update, 'PATCH');
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.revision, 2);
  assert.equal(
    (await http(path, teacher, update, 'PATCH')).json.data.revision,
    2,
  );
  assert.equal(
    (
      await http(
        path,
        teacher,
        { ...update, clientOperationId: 'academic_stale_operation_01' },
        'PATCH',
      )
    ).status,
    409,
  );
  const submit = {
    revision: 2,
    clientOperationId: 'academic_submit_operation_01',
  };
  assert.equal(
    (await http(path + '/submit', teacher, submit)).json.data.state,
    'submitted',
  );
  assert.equal((await http(path + '/submit', teacher, submit)).status, 200);
  assert.equal(
    (
      await http(
        path,
        teacher,
        {
          ...update,
          revision: 3,
          clientOperationId: 'academic_frozen_operation_01',
        },
        'PATCH',
      )
    ).status,
    409,
  );
  const stored = await LessonPlan.findById(lesson.lessonPlanId);
  assert.equal(stored?.submissions.length, 1);
  assert.equal(
    (stored?.submissions[0].content as any).objectives,
    'Revised objectives',
  );
});
test('revocation removes read/edit authority immediately and another teacher cannot edit', async () => {
  const lesson = (await http('/teacher/academic/lessons', teacher, draft()))
    .json.data;
  const body = {
    revision: 1,
    clientOperationId: 'academic_submit_operation_01',
  };
  const path = `/teacher/academic/lessons/${lesson.lessonPlanId}/submit`;
  assert.equal((await http(path, other, body)).status, 404);
  await TeacherAssignment.updateOne(
    { _id: assignment._id },
    { $set: { isActive: false } },
  );
  assert.equal((await http(path, teacher, body)).status, 404);
  assert.equal(
    (await http(`/teacher/academic/context?${query()}`)).status,
    404,
  );
});
test('substitute occurrence alone grants no syllabus/planning authority', async () => {
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: id(),
    originalTeacherId: teacher.id,
    substituteTeacherId: other.id,
    date: '2026-11-01',
    startTime: '09:00',
    endTime: '10:00',
    room: 'A',
    status: 'approved',
    createdBy: admin.id,
    approvedBy: admin.id,
  });
  assert.equal(
    (await http(`/teacher/academic/context?${query()}`, other)).status,
    404,
  );
  assert.equal(
    (await http('/teacher/academic/lessons', other, draft())).status,
    404,
  );
});
test('student/principal teacher endpoints denied; syllabus management is Super Admin only', async () => {
  for (const person of [student, principal, admin])
    assert.equal(
      (await http(`/teacher/academic/context?${query()}`, person)).status,
      403,
    );
  for (const person of [teacher, student, principal])
    assert.equal(
      (
        await http(`/syllabuses/${syllabus.syllabusId}/publish`, person, {
          revision: 2,
        })
      ).status,
      403,
    );
});
test('invalid dates, expired date context, unsupported timetable and private fields rejected', async () => {
  for (const change of [
    { teachingDate: '2026-02-30' },
    { teachingDate: addScheduleDays(schoolToday(), 1000) },
    { periodId: id() },
    { teacherId: other.id },
    { topicIds: [] },
  ]) {
    assert.equal(
      (await http('/teacher/academic/lessons', teacher, draft(change))).status,
      400,
    );
  }
});
test('retirement prevents editing/submission; safe list retains existing planned content', async () => {
  const lesson = (await http('/teacher/academic/lessons', teacher, draft()))
    .json.data;
  await http(`/syllabuses/${syllabus.syllabusId}/retire`, admin, {
    revision: 2,
  });
  assert.equal(
    (
      await http(
        `/teacher/academic/lessons/${lesson.lessonPlanId}/submit`,
        teacher,
        { revision: 1, clientOperationId: 'academic_submit_operation_01' },
      )
    ).status,
    404,
  );
  assert.equal(
    (await http(`/teacher/academic/lessons?${query()}`)).json.data.length,
    1,
  );
});
test('domain permission removal fails closed', async () => {
  const saved = [...ROLE_PERMISSIONS.teacher];
  try {
    ROLE_PERMISSIONS.teacher = saved.filter(
      p => p !== PERMISSIONS.TEACHER_LESSONS_MANAGE,
    );
    assert.equal(
      (await http('/teacher/academic/lessons', teacher, draft())).status,
      403,
    );
  } finally {
    ROLE_PERMISSIONS.teacher = saved;
  }
});

test('actual foreign syllabus and its topics cannot be used under assigned Mathematics', async () => {
  const created = (
    await createSyllabus({ subjectId: String(otherSubject._id) })
  ).json.data;
  const foreignSyllabus = (
    await http(`/syllabuses/${created.syllabusId}/publish`, admin, {
      revision: 1,
    })
  ).json.data;
  assert.equal(
    (
      await http(
        '/teacher/academic/lessons',
        teacher,
        draft({
          syllabusId: foreignSyllabus.syllabusId,
          unitId: foreignSyllabus.units[0].unitId,
          topicIds: [foreignSyllabus.units[0].topics[0].topicId],
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        '/teacher/academic/lessons',
        teacher,
        draft({ topicIds: [foreignSyllabus.units[0].topics[0].topicId] }),
      )
    ).status,
    404,
  );
});

test('current session revocation and user branch reassignment invalidate academic authority', async () => {
  await Session.updateOne(
    { token: teacher.token },
    { $set: { isRevoked: true } },
  );
  assert.equal(
    (await http(`/teacher/academic/context?${query()}`)).status,
    401,
  );
  await Session.updateOne(
    { token: teacher.token },
    { $set: { isRevoked: false } },
  );
  await User.updateOne({ _id: teacher.id }, { $set: { branchId: foreign } });
  assert.equal(
    (await http(`/teacher/academic/context?${query()}`)).status,
    404,
  );
});

test('a retired higher publication cannot be replaced by a lower version', async () => {
  const higher = (await createSyllabus({ version: 3 })).json.data;
  await http(`/syllabuses/${higher.syllabusId}/publish`, admin, {
    revision: 1,
  });
  await http(`/syllabuses/${higher.syllabusId}/retire`, admin, { revision: 2 });
  const lower = (await createSyllabus({ version: 2 })).json.data;
  assert.equal(
    (
      await http(`/syllabuses/${lower.syllabusId}/publish`, admin, {
        revision: 1,
      })
    ).status,
    409,
  );
});

test('replacement assignment does not silently rebind an existing lesson', async () => {
  const lesson = (await http('/teacher/academic/lessons', teacher, draft()))
    .json.data;
  await TeacherAssignment.updateOne(
    { _id: assignment._id },
    { $set: { isActive: false } },
  );
  await TeacherAssignment.create({
    teacherId: teacher.id,
    branchId: branch,
    classId: schoolClass._id,
    sectionId: section._id,
    subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000),
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  assert.equal(
    (
      await http(
        `/teacher/academic/lessons/${lesson.lessonPlanId}/submit`,
        teacher,
        { revision: 1, clientOperationId: 'academic_submit_operation_01' },
      )
    ).status,
    404,
  );
});

test('date-effective assignment checks use the configured school civil day', async () => {
  // Ends 05:00 in Asia/Karachi: the selected civil day still overlaps authority.
  await TeacherAssignment.collection.updateOne(
    { _id: assignment._id },
    { $set: { validUntil: new Date(`${planningDate()}T00:00:00Z`) } },
  );
  assert.equal(
    (await http('/teacher/academic/lessons', teacher, draft())).status,
    200,
  );
  assert.equal(
    (
      await http(
        '/teacher/academic/lessons',
        teacher,
        draft({
          teachingDate: addScheduleDays(planningDate(), 1),
          clientOperationId: 'academic_outside_operation_01',
        }),
      )
    ).status,
    400,
  );
});

test('active management detail returns the authorized syllabus and no-store DTO', async () => {
  const result = await http(`/syllabuses/${syllabus.syllabusId}`, admin);
  assert.equal(result.status, 200);
  assert.equal(result.cache, 'no-store');
  assert.equal(result.json.data.syllabusId, syllabus.syllabusId);
  assert.equal(result.json.data.academicYear, schoolClass.academicYear);
  assert.deepEqual(result.json.data.units, syllabus.units);
});

const invalidManagementContexts = [
  {
    name: 'inactive branch',
    status: 403,
    change: () =>
      Branch.updateOne({ _id: branch }, { $set: { isActive: false } }),
  },
  {
    name: 'missing branch',
    status: 403,
    change: () => Branch.deleteOne({ _id: branch }),
  },
  {
    name: 'inactive class',
    status: 404,
    change: () =>
      SchoolClass.updateOne(
        { _id: schoolClass._id },
        { $set: { isActive: false } },
      ),
  },
  {
    name: 'missing class',
    status: 404,
    change: () => SchoolClass.deleteOne({ _id: schoolClass._id }),
  },
  {
    name: 'class moved to foreign branch',
    status: 404,
    change: () =>
      SchoolClass.collection.updateOne(
        { _id: schoolClass._id },
        { $set: { branchId: foreign } },
      ),
  },
  {
    name: 'syllabus with mismatched foreign branch',
    status: 404,
    change: () =>
      Syllabus.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(syllabus.syllabusId) },
        { $set: { branchId: foreign } },
      ),
  },
  {
    name: 'missing subject',
    status: 404,
    change: () => Subject.deleteOne({ _id: subject._id }),
  },
  {
    name: 'inactive subject',
    status: 404,
    change: () =>
      Subject.updateOne({ _id: subject._id }, { $set: { isActive: false } }),
  },
  {
    name: 'subject moved to foreign branch',
    status: 404,
    change: () =>
      Subject.collection.updateOne(
        { _id: subject._id },
        { $set: { branchId: foreign } },
      ),
  },
  {
    name: 'class academic year changed',
    status: 404,
    change: () =>
      SchoolClass.updateOne(
        { _id: schoolClass._id },
        { $set: { academicYear: 'different-year' } },
      ),
  },
  {
    name: 'syllabus academic year mismatched',
    status: 404,
    change: () =>
      Syllabus.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(syllabus.syllabusId) },
        { $set: { academicYear: 'different-year' } },
      ),
  },
];
for (const scenario of invalidManagementContexts) {
  test(`management read and mutation both deny ${scenario.name}`, async () => {
    await scenario.change();
    const path = `/syllabuses/${syllabus.syllabusId}`;
    const result = await http(path, admin);
    assert.equal(result.status, scenario.status);
    assert.equal(result.json.data, undefined);
    assert.equal(result.cache, 'no-store');
    const mutation = await http(path + '/retire', admin, {
      revision: syllabus.revision,
    });
    assert.equal(mutation.status, scenario.status);
    assert.equal(mutation.json.message, result.json.message);
    const stored = await Syllabus.findById(syllabus.syllabusId);
    assert.equal(stored?.status, 'published');
    assert.equal(stored?.revision, syllabus.revision);
  });
}

test('Teacher and Principal roles cannot use management detail, including foreign-branch actors', async () => {
  const foreignPrincipal = await actor('principal', foreign);
  for (const person of [
    teacher,
    foreignTeacher,
    principal,
    foreignPrincipal,
    student,
  ]) {
    assert.equal(
      (await http(`/syllabuses/${syllabus.syllabusId}`, person)).status,
      403,
    );
  }
});

test('management detail requires a registered current active administrator and explicit permission', async () => {
  const path = `/syllabuses/${syllabus.syllabusId}`;
  const grants = [...ROLE_PERMISSIONS.super_admin];
  try {
    ROLE_PERMISSIONS.super_admin = grants.filter(
      p => p !== PERMISSIONS.SYLLABUS_MANAGE,
    );
    assert.equal((await http(path, admin)).status, 403);
  } finally {
    ROLE_PERMISSIONS.super_admin = grants;
  }
  await User.updateOne({ _id: admin.id }, { $set: { isActive: false } });
  assert.equal((await http(path, admin)).status, 401);
  await User.updateOne(
    { _id: admin.id },
    { $set: { isActive: true, role: 'principal' } },
  );
  assert.equal((await http(path, admin)).status, 401);
  await User.updateOne({ _id: admin.id }, { $set: { role: 'super_admin' } });
  await Session.updateOne(
    { token: admin.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await http(path, admin)).status, 401);
  await Session.deleteOne({ token: admin.token });
  assert.equal((await http(path, admin)).status, 401);
});

test('shared management context preserves draft update, publication, replacement and retirement', async () => {
  const created = (await createSyllabus({ version: 2 })).json.data;
  const path = `/syllabuses/${created.syllabusId}`;
  assert.equal((await http(path, admin)).json.data.status, 'draft');
  const updated = await http(
    path,
    admin,
    {
      revision: 1,
      title: 'Updated curriculum',
      units: [
        {
          id: created.units[0].unitId,
          title: 'Numbers',
          topics: [
            { id: created.units[0].topics[0].topicId, title: 'Integers' },
          ],
        },
      ],
    },
    'PATCH',
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.revision, 2);
  assert.equal(
    updated.json.data.units[0].topics[0].topicId,
    created.units[0].topics[0].topicId,
  );
  assert.equal(
    (await http(path + '/publish', admin, { revision: 2 })).status,
    200,
  );
  assert.equal(
    (await Syllabus.findById(syllabus.syllabusId))?.status,
    'retired',
  );
  const teacherView = await http(`/teacher/academic/context?${query()}`);
  assert.equal(teacherView.status, 200);
  assert.equal(teacherView.json.data.syllabus.syllabusId, created.syllabusId);
  assert.equal(
    (await http(path + '/retire', admin, { revision: 3 })).status,
    200,
  );
  assert.equal(
    (await Syllabus.findById(created.syllabusId))?.status,
    'retired',
  );
  assert.equal(
    (await http(`/teacher/academic/context?${query()}`)).json.data.syllabus,
    null,
  );
});

test('persisted historical syllabus remains concealed after its management context is deactivated', async () => {
  assert.equal(
    (
      await http(`/syllabuses/${syllabus.syllabusId}/retire`, admin, {
        revision: syllabus.revision,
      })
    ).status,
    200,
  );
  await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
  assert.equal(
    (await http(`/syllabuses/${syllabus.syllabusId}`, admin)).status,
    403,
  );
  const stored = await Syllabus.findById(syllabus.syllabusId);
  assert.equal(stored?.status, 'retired');
  assert.equal(stored?.units[0].title, 'Numbers');
});

test('Teacher published reads still fail closed for inactive class, subject and branch', async () => {
  const path = `/teacher/academic/syllabuses/${syllabus.syllabusId}?${query()}`;
  assert.equal((await http(path)).status, 200);
  await SchoolClass.updateOne(
    { _id: schoolClass._id },
    { $set: { isActive: false } },
  );
  assert.equal((await http(path)).status, 404);
  await SchoolClass.updateOne(
    { _id: schoolClass._id },
    { $set: { isActive: true } },
  );
  await Subject.updateOne({ _id: subject._id }, { $set: { isActive: false } });
  assert.equal((await http(path)).status, 404);
  await Subject.updateOne({ _id: subject._id }, { $set: { isActive: true } });
  await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
  assert.equal((await http(path)).status, 403);
});
