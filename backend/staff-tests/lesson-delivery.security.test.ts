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
import { LessonDelivery } from '../src/staff/src/models/lessonDelivery';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import {
  SubstituteAssignment,
  TimetableVersion,
  TimetablePeriod,
} from '../src/staff/src/models/timetable';
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
const originalAuthority = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
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
    LessonDelivery.createIndexes(),
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
    LessonDelivery,
    ApprovalRequest,
    TimetableVersion,
    TimetablePeriod,
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
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: {
      branchId: String(branch),
      types: ['lesson_plan'],
    },
  });
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
    validFrom: new Date(Date.now() - 90 * 86400000),
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
  if (originalAuthority === undefined)
    delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = originalAuthority;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTimezone === undefined) delete process.env.SCHOOL_TIMEZONE;
  else process.env.SCHOOL_TIMEZONE = originalTimezone;
});

const createPlan = async (extra = {}) => {
  const r = await http(
    '/teacher/academic/lessons',
    teacher,
    draft({ teachingDate: schoolToday(), ...extra }),
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const submitPlan = async (extra = {}) => {
  const plan = await createPlan(extra);
  const r = await http(
    `/teacher/academic/lessons/${plan.lessonPlanId}/submit`,
    teacher,
    { revision: plan.revision, clientOperationId: 'submit_delivery_plan_001' },
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const decide = (plan: any, extra = {}, person = principal) =>
  http(
    `/principal/academic-review/${plan.approvalRequestId}/decision`,
    person,
    {
      action: 'approved',
      revision: plan.revision,
      reviewNote: '',
      clientOperationId: 'review_delivery_plan_001',
      ...extra,
    },
  );
const approvedPlan = async (extra = {}) => {
  const plan = await submitPlan(extra),
    r = await decide(plan);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data.lesson;
};
const deliveryBody = (plan: any, extra = {}) => ({
  lessonPlanRevision: plan.approvedRevision,
  revision: 0,
  clientOperationId: 'record_delivery_operation_001',
  deliveryStatus: 'delivered',
  actualTeachingDate: plan.teachingDate,
  topics: plan.topicIds.map((topicId: string) => ({
    topicId,
    state: 'completed',
    evidence:
      'Teacher observed independent practice demonstrating the objective.',
  })),
  teacherNotes: '',
  correctionReason: '',
  ...extra,
});
const record = (plan: any, extra = {}, person = teacher) =>
  http(
    `/teacher/academic/lessons/${plan.lessonPlanId}/deliveries`,
    person,
    deliveryBody(plan, extra),
  );
const coverage = async () => {
  const r = await http(`/teacher/academic/coverage?${query()}`);
  assert.equal(r.status, 200);
  return r.json.data;
};
const linkedPlan = async (date = schoolToday()) => {
  const version = await TimetableVersion.create({
    branchId: branch,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: addScheduleDays(date, -2),
    effectiveUntil: addScheduleDays(date, 3),
    periodCount: 1,
    createdBy: admin.id,
    approvedBy: principal.id,
  });
  const period = await TimetablePeriod.create({
    branchId: branch,
    timetableVersionId: version._id,
    teacherId: teacher.id,
    ...tuple(),
    dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay(),
    startTime: '00:00',
    endTime: '00:01',
    room: 'A',
  });
  const plan = await approvedPlan({
    teachingDate: date,
    occurrence: {
      periodId: String(period._id),
      timetableVersionId: String(version._id),
      date,
    },
  });
  return { plan, period };
};
const substitute = async (period: any, date: string) =>
  SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: teacher.id,
    substituteTeacherId: other.id,
    date,
    startTime: '00:00',
    endTime: '00:01',
    room: 'A',
    status: 'approved',
    createdBy: admin.id,
    approvedBy: principal.id,
  });

test('typed review is queued in existing inbox and records a real independent decision', async () => {
  const plan = await submitPlan();
  const inbox = await http('/approval-requests/pending', principal);
  assert.equal(inbox.status, 200);
  assert.match(JSON.stringify(inbox.json), /lesson_plan/);
  const r = await decide(plan);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const stored = await LessonPlan.findById(plan.lessonPlanId);
  assert.equal(stored!.state, 'approved');
  assert.equal(stored!.approvedRevision, plan.revision);
  assert.equal(String(stored!.reviews[0].reviewedBy), String(principal.id));
  assert.equal(await LessonDelivery.countDocuments(), 0);
  assert.equal(
    (await ApprovalRequest.findById(plan.approvalRequestId))!.status,
    'approved',
  );
});
test('Teacher, Student and Super Admin cannot use Principal review endpoints', async () => {
  const plan = await submitPlan();
  for (const person of [teacher, student, admin])
    assert.equal((await decide(plan, {}, person)).status, 403);
  assert.equal(
    (await LessonPlan.findById(plan.lessonPlanId))!.state,
    'submitted',
  );
});
test('foreign Principal and branch reassignment are concealed', async () => {
  const plan = await submitPlan(),
    foreignPrincipal = await actor('principal', foreign);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(foreignPrincipal.id)]: {
      branchId: String(foreign),
      types: ['lesson_plan'],
    },
  });
  assert.equal((await decide(plan, {}, foreignPrincipal)).status, 404);
});
test('explicit category grant, permission, registered session and active identity required', async () => {
  const plan = await submitPlan();
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = '{}';
  assert.equal((await decide(plan)).status, 403);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: {
      branchId: String(branch),
      types: ['lesson_plan'],
    },
  });
  await Session.updateMany(
    { userId: principal.id },
    { $set: { isRevoked: true } },
  );
  assert.equal((await decide(plan)).status, 401);
});
test('inactive reviewer and ungranted management permission fail closed', async () => {
  const plan = await submitPlan();
  const old = [...ROLE_PERMISSIONS.principal];
  try {
    ROLE_PERMISSIONS.principal = old.filter(
      p => p !== PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
    );
    assert.equal((await decide(plan)).status, 403);
  } finally {
    ROLE_PERMISSIONS.principal = old;
  }
  await User.updateOne({ _id: principal.id }, { $set: { isActive: false } });
  assert.equal((await decide(plan)).status, 401);
});
test('stale review rejected and double decisions cannot race', async () => {
  const plan = await submitPlan();
  assert.equal((await decide(plan, { revision: 999 })).status, 409);
  const results = await Promise.all([
    decide(plan),
    decide(plan, {
      action: 'rejected',
      reviewNote: 'Needs changes',
      clientOperationId: 'second_review_operation_01',
    }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(
    (await LessonPlan.findById(plan.lessonPlanId))!.reviews.length,
    1,
  );
});
test('duplicate review retry is safe and a conflicting operation is rejected', async () => {
  const plan = await submitPlan();
  assert.equal((await decide(plan)).status, 200);
  assert.equal((await decide(plan)).status, 200);
  assert.equal((await decide(plan, { reviewNote: 'Different' })).status, 409);
  const secondReviewer = await actor('principal');
  const grants = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  grants[String(secondReviewer.id)] = {
    branchId: String(branch),
    types: ['lesson_plan'],
  };
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(grants);
  assert.equal((await decide(plan, {}, secondReviewer)).status, 409);
  assert.equal(
    (await LessonPlan.findById(plan.lessonPlanId))!.reviews.length,
    1,
  );
});
test('generic decision and delegation cannot bypass typed lesson workflow', async () => {
  const plan = await submitPlan();
  const r = await http(
    `/approval-requests/${plan.approvalRequestId}`,
    principal,
    { action: 'approved' },
    'PATCH',
  );
  assert.equal(r.status, 400);
  assert.equal(
    (
      await http(
        `/approval-requests/${plan.approvalRequestId}/eligible-delegates`,
        principal,
      )
    ).status,
    400,
  );
  assert.equal(
    (await LessonPlan.findById(plan.lessonPlanId))!.state,
    'submitted',
  );
});
test('needs revision preserves v1; new submitted revision is independently approved', async () => {
  let plan = await submitPlan();
  const first = (await LessonPlan.findById(
    plan.lessonPlanId,
  ))!.submissions[0].toObject();
  assert.equal(
    (
      await decide(plan, {
        action: 'needs_revision',
        reviewNote: 'Add guided examples',
      })
    ).status,
    200,
  );
  let stored = (await LessonPlan.findById(plan.lessonPlanId))!;
  const revised = await http(
    `/teacher/academic/lessons/${plan.lessonPlanId}/revise`,
    teacher,
    {
      revision: stored.revision,
      clientOperationId: 'revise_delivery_plan_001',
    },
  );
  assert.equal(revised.status, 200);
  assert.equal(revised.json.data.state, 'draft');
  const updated = await http(
    `/teacher/academic/lessons/${plan.lessonPlanId}`,
    teacher,
    {
      ...draft(),
      objectives: 'Revised objective',
      revision: revised.json.data.revision,
      clientOperationId: 'update_delivery_plan_002',
      classId: undefined,
      sectionId: undefined,
      subjectId: undefined,
      syllabusId: undefined,
    },
    'PATCH',
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  const submitted = await http(
    `/teacher/academic/lessons/${plan.lessonPlanId}/submit`,
    teacher,
    {
      revision: updated.json.data.revision,
      clientOperationId: 'submit_delivery_plan_002',
    },
  );
  assert.equal(submitted.status, 200);
  plan = submitted.json.data;
  assert.equal(
    (await decide(plan, { clientOperationId: 'review_delivery_plan_002' }))
      .status,
    200,
  );
  stored = (await LessonPlan.findById(plan.lessonPlanId))!;
  assert.deepEqual(stored.submissions[0].toObject(), first);
  assert.equal(stored.submissions.length, 2);
  assert.equal(stored.reviews[0].note, 'Add guided examples');
  assert.equal(await ApprovalRequest.countDocuments(), 2);
});
test('submitted and rejected plans cannot be edited or delivered', async () => {
  const plan = await submitPlan();
  assert.equal(
    (await record({ ...plan, approvedRevision: plan.revision })).status,
    409,
  );
  assert.equal(
    (
      await decide(plan, {
        action: 'rejected',
        reviewNote: 'Invalid activities',
      })
    ).status,
    200,
  );
  const row = (await LessonPlan.findById(plan.lessonPlanId))!;
  assert.equal(
    (
      await http(
        `/teacher/academic/lessons/${plan.lessonPlanId}/revise`,
        teacher,
        {
          revision: row.revision,
          clientOperationId: 'cannot_revise_rejection_01',
        },
      )
    ).status,
    409,
  );
  assert.equal(await LessonDelivery.countDocuments(), 0);
});
test('revoked assignments and retired syllabus prevent review', async () => {
  const plan = await submitPlan();
  await TeacherAssignment.updateOne(
    { _id: assignment._id },
    { $set: { isActive: false } },
  );
  assert.equal((await decide(plan)).status, 404);
  await TeacherAssignment.updateOne(
    { _id: assignment._id },
    { $set: { isActive: true } },
  );
  await Syllabus.updateOne(
    { _id: syllabus.syllabusId },
    { $set: { status: 'retired' } },
  );
  assert.equal((await decide(plan)).status, 404);
});
test('authorized Teacher records evidence; safe DTO omits credentials and internal operation data', async () => {
  const plan = await approvedPlan(),
    r = await record(plan);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.delivery.history[0].topics[0].state, 'completed');
  assert.doesNotMatch(
    JSON.stringify(r.json),
    /password|email|fingerprint|clientOperationId|private/,
  );
  assert.equal(r.cache, 'no-store');
  assert.equal(await LessonDelivery.countDocuments(), 1);
  assert.equal((await coverage()).completedTopics, 1);
});
test('unassigned, foreign branch, Student and Principal cannot record Teacher evidence', async () => {
  const plan = await approvedPlan();
  for (const [person, status] of [
    [other, 404],
    [foreignTeacher, 404],
    [student, 403],
    [principal, 403],
  ] as any[])
    assert.equal((await record(plan, {}, person)).status, status);
  assert.equal(await LessonDelivery.countDocuments(), 0);
});
test('wrong section, subject, inactive branch and revoked assignment fail closed', async () => {
  const plan = await approvedPlan();
  await TeacherAssignment.collection.updateOne(
    { _id: assignment._id },
    { $set: { sectionId: sectionB._id } },
  );
  assert.equal((await record(plan)).status, 404);
  await TeacherAssignment.collection.updateOne(
    { _id: assignment._id },
    { $set: { sectionId: section._id, subjectId: otherSubject._id } },
  );
  assert.equal((await record(plan)).status, 404);
  await TeacherAssignment.updateOne(
    { _id: assignment._id },
    { $set: { subjectId: subject._id, isActive: false } },
  );
  assert.equal((await record(plan)).status, 404);
  await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
  assert.equal((await record(plan)).status, 403);
});
test('active substitute alone has occurrence delivery authority and approved occurrence entry', async () => {
  const { plan, period } = await linkedPlan();
  await User.updateOne(
    { _id: other.id },
    { $set: { fullName: 'Substitute Teacher' } },
  );
  await substitute(period, plan.teachingDate);
  assert.equal((await record(plan)).status, 404);
  const list = await http(
    `/teacher/academic/occurrences/${period._id}/lessons?date=${plan.teachingDate}`,
    other,
  );
  assert.equal(list.status, 200);
  assert.equal(list.json.data[0].lessonPlanId, plan.lessonPlanId);
  const r = await record(plan, {}, other);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const stored = (await LessonDelivery.findOne())!;
  assert.equal(String(stored.history[0].recordedBy), String(other.id));
  assert.equal(stored.history[0].recordedByName, 'Substitute Teacher');
  assert.ok(stored.occurrence?.substituteId);
});
test('future date and occurrence cannot be recorded', async () => {
  const { plan } = await linkedPlan(planningDate());
  assert.equal((await record(plan)).status, 400);
  assert.equal(await LessonDelivery.countDocuments(), 0);
});
test('date-based catch-up permits later actual school date, never earlier or future', async () => {
  const plan = await approvedPlan({
    teachingDate: addScheduleDays(schoolToday(), -2),
  });
  assert.equal(
    (
      await record(plan, {
        actualTeachingDate: addScheduleDays(schoolToday(), -3),
      })
    ).status,
    400,
  );
  assert.equal(
    (await record(plan, { actualTeachingDate: planningDate() })).status,
    400,
  );
  assert.equal(
    (await record(plan, { actualTeachingDate: schoolToday() })).status,
    200,
  );
});
test('foreign and unplanned cross-product topic evidence is concealed', async () => {
  const plan = await approvedPlan();
  for (const topicId of [id(), syllabus.units[1].topics[0].topicId])
    assert.equal(
      (
        await record(plan, {
          topics: [{ topicId, state: 'completed', evidence: 'Evidence' }],
        })
      ).status,
      404,
    );
  assert.equal(await LessonDelivery.countDocuments(), 0);
});
test('missing evidence, duplicate topic and contradictory overall status are rejected', async () => {
  const plan = await approvedPlan();
  const t = deliveryBody(plan).topics[0];
  assert.equal(
    (await record(plan, { topics: [{ ...t, evidence: '' }] })).status,
    400,
  );
  assert.equal((await record(plan, { topics: [t, t] })).status, 404);
  assert.equal(
    (await record(plan, { deliveryStatus: 'not_delivered' })).status,
    400,
  );
});
test('duplicate delivery requests are idempotent and conflicting operation payloads fail', async () => {
  const plan = await approvedPlan();
  const results = await Promise.all([record(plan), record(plan)]);
  assert.deepEqual(
    results.map(r => r.status),
    [200, 200],
  );
  assert.equal(await LessonDelivery.countDocuments(), 1);
  assert.equal((await LessonDelivery.findOne())!.history.length, 1);
  assert.equal(
    (await record(plan, { teacherNotes: 'Conflicting payload' })).status,
    409,
  );
});
test('conflicting delivery race commits one effective revision', async () => {
  const plan = await approvedPlan();
  const results = await Promise.all([
    record(plan),
    record(plan, {
      clientOperationId: 'competing_delivery_op_001',
      teacherNotes: 'Other payload',
    }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await LessonDelivery.findOne())!.revision, 1);
});
test('correction appends evidence history, checks revision, and replaces effective contribution', async () => {
  const plan = await approvedPlan();
  await record(plan);
  const original = (await LessonDelivery.findOne())!.history[0].toObject();
  const change = {
    revision: 1,
    clientOperationId: 'correct_delivery_op_001',
    deliveryStatus: 'not_delivered',
    topics: [
      {
        topicId: plan.topicIds[0],
        state: 'not_covered',
        evidence: 'Correction: session was cancelled',
      },
    ],
    correctionReason: 'Incorrect original entry',
  };
  assert.equal((await record(plan, change)).status, 200);
  assert.equal(
    (
      await record(plan, {
        ...change,
        clientOperationId: 'stale_correction_op_001',
      })
    ).status,
    409,
  );
  const stored = (await LessonDelivery.findOne())!;
  assert.equal(stored.history.length, 2);
  assert.deepEqual(stored.history[0].toObject(), original);
  assert.equal((await coverage()).completedTopics, 0);
});
test('plans and approvals alone leave all canonical topics pending', async () => {
  await createPlan();
  assert.equal((await coverage()).completedTopics, 0);
  await approvedPlan({ clientOperationId: 'second_plan_operation_01' });
  const c = await coverage();
  assert.equal(c.completedTopics, 0);
  assert.equal(c.pendingTopics, 2);
});
test('partial followed by completed across lessons counts a unique topic once', async () => {
  const first = await approvedPlan();
  assert.equal(
    (
      await record(first, {
        deliveryStatus: 'partially_delivered',
        topics: [
          {
            topicId: first.topicIds[0],
            state: 'partial',
            evidence: 'First guided examples only',
          },
        ],
      })
    ).status,
    200,
  );
  let c = await coverage();
  assert.equal(c.partialTopics, 1);
  assert.equal(c.completedPercentage, 0);
  const next = await approvedPlan({
    clientOperationId: 'another_lesson_create_01',
  });
  await record(next);
  c = await coverage();
  assert.equal(c.completedTopics, 1);
  assert.equal(c.partialTopics, 0);
  assert.equal(c.totalTopics, 2);
  assert.equal(c.completedPercentage, 50);
});
test('voided or stale approval evidence never contributes to coverage', async () => {
  const plan = await approvedPlan();
  await record(plan);
  await LessonDelivery.updateOne({}, { $set: { state: 'voided' } });
  assert.equal((await coverage()).completedTopics, 0);
  await LessonDelivery.updateOne({}, { $set: { state: 'recorded' } });
  await LessonPlan.updateOne(
    { _id: plan.lessonPlanId },
    { $set: { approvedRevision: 999 } },
  );
  assert.equal((await coverage()).completedTopics, 0);
});
test('replacement preserves old evidence while new published version starts pending', async () => {
  const plan = await approvedPlan();
  await record(plan);
  const old = (await LessonDelivery.findOne())!.toObject();
  const next = (await createSyllabus({ version: 2 })).json.data;
  assert.equal(
    (
      await http(`/syllabuses/${next.syllabusId}/publish`, admin, {
        revision: 1,
      })
    ).status,
    200,
  );
  const c = await coverage();
  assert.equal(c.version, 2);
  assert.equal(c.completedTopics, 0);
  assert.deepEqual((await LessonDelivery.findOne())!.toObject(), old);
  assert.equal((await record(plan)).status, 404);
});
test('section coverage is isolated from another authorized section', async () => {
  const plan = await approvedPlan();
  await record(plan);
  await TeacherAssignment.create({
    teacherId: teacher.id,
    branchId: branch,
    classId: schoolClass._id,
    sectionId: sectionB._id,
    subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000),
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  const r = await http(
    `/teacher/academic/coverage?${query({ sectionId: String(sectionB._id) })}`,
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.data.completedTopics, 0);
});
test('Phase 1 submitted snapshot can explicitly enter typed review without rewriting content', async () => {
  const submitted = await submitPlan();
  await ApprovalRequest.deleteMany({});
  await LessonPlan.updateOne(
    { _id: submitted.lessonPlanId },
    { $unset: { approvalRequestId: 1 }, $set: { operations: [] } },
  );
  const first = (await LessonPlan.findById(
    submitted.lessonPlanId,
  ))!.submissions[0].toObject();
  const queued = await http(
    `/teacher/academic/lessons/${submitted.lessonPlanId}/submit`,
    teacher,
    {
      revision: submitted.revision,
      clientOperationId: 'queue_legacy_review_001',
    },
  );
  assert.equal(queued.status, 200);
  assert.equal(queued.json.data.revision, submitted.revision);
  assert.deepEqual(
    (await LessonPlan.findById(
      submitted.lessonPlanId,
    ))!.submissions[0].toObject(),
    first,
  );
  assert.equal((await decide(queued.json.data)).status, 200);
});
test('Principal reviewed history is branch scoped and contains coverage entry after inbox removal', async () => {
  const plan = await approvedPlan();
  await record(plan);
  const history = await http('/principal/academic-review/history', principal);
  assert.equal(history.status, 200);
  assert.equal(history.json.data.length, 1);
  assert.equal(history.json.data[0].status, 'approved');
  const detail = await http(
    `/principal/academic-review/${history.json.data[0]._id}`,
    principal,
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.coverage.completedTopics, 1);
  assert.equal(detail.json.data.canReview, false);
  assert.doesNotMatch(
    JSON.stringify(detail.json),
    /password|email|fingerprint/,
  );
});
test('invalid academic class and timetable replacement block review/delivery', async () => {
  const { plan, period } = await linkedPlan();
  await TimetableVersion.updateOne(
    { _id: period.timetableVersionId },
    { $set: { status: 'retired' } },
  );
  assert.equal((await record(plan)).status, 404);
  assert.equal(
    (
      await http(
        `/principal/academic-review/${plan.approvalRequestId}`,
        principal,
      )
    ).status,
    404,
  );
});
