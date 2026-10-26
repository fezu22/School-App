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
import { Syllabus } from '../src/staff/src/models/syllabus';
import { LessonPlan } from '../src/staff/src/models/lessonPlan';
import { LessonDelivery } from '../src/staff/src/models/lessonDelivery';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import { Homework } from '../src/staff/src/models/homework';
import { Quiz } from '../src/staff/src/models/quiz';
import { AcademicWorkAudience } from '../src/staff/src/models/academicWorkAudience';
import { SubstituteAssignment, TimetablePeriod, TimetableVersion } from '../src/staff/src/models/timetable';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { addScheduleDays, schoolToday } from '../src/staff/src/services/school-date.service';
import { ensureAcademicWorkIndexes } from '../src/staff/src/services/academic-work.service';

let db: MongoMemoryReplSet, server: Server, base: string;
let branch: any, foreign: any, teacher: any, other: any, principal: any, admin: any, learner: any, outsider: any;
let schoolClass: any, section: any, sectionB: any, subject: any, otherSubject: any, assignment: any, syllabus: any;
const oldSecret = process.env.JWT_SECRET, oldAuthority = process.env.PRINCIPAL_APPROVAL_AUTHORITY, oldZone = process.env.SCHOOL_TIMEZONE;
const id = () => String(new mongoose.Types.ObjectId());
const actor = async (role: UserRole, branchId = branch, name = 'Test User') => {
  const user = await User.create({ fullName: name, email: `${id()}@test.invalid`, password: 'private', role, branchId });
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return { id: user._id, token };
};
const http = async (path: string, person = teacher, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${person.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() as any };
};
const tuple = (extra = {}) => ({
  classId: String(schoolClass._id), sectionId: String(section._id), subjectId: String(subject._id), ...extra,
});
const createSyllabus = () => http('/syllabuses', admin, {
  classId: String(schoolClass._id), subjectId: String(subject._id), version: 1, title: 'Mathematics',
  units: [
    { title: 'Numbers', topics: [{ title: 'Integers', outcomes: ['Compare integers'] }] },
    { title: 'Algebra', topics: [{ title: 'Expressions' }] },
  ],
});
before(async () => {
  process.env.JWT_SECRET = 'academic-work-security-secret';
  process.env.SCHOOL_TIMEZONE = 'Asia/Karachi';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { dbName: 'academic_work_security', autoIndex: false });
  await Promise.all([Syllabus.createIndexes(), LessonPlan.createIndexes(), LessonDelivery.createIndexes(), ensureAcademicWorkIndexes()]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
beforeEach(async () => {
  for (const model of [AcademicWorkAudience, Homework, Quiz, LessonDelivery, ApprovalRequest, SubstituteAssignment,
    TimetablePeriod, TimetableVersion, LessonPlan, Syllabus, TeacherAssignment, Student, Subject, Section,
    SchoolClass, Session, User, Branch]) await model.collection.deleteMany({});
  branch = (await Branch.create({ name: 'Branch A', code: 'AA', address: 'private', city: 'Lahore' }))._id;
  foreign = (await Branch.create({ name: 'Branch B', code: 'BB', address: 'private', city: 'Lahore' }))._id;
  teacher = await actor('teacher', branch, 'Ayesha Teacher');
  other = await actor('teacher', branch, 'Other Teacher');
  principal = await actor('principal', branch, 'Principal');
  admin = await actor('super_admin', branch, 'Admin');
  learner = await actor('student', branch, 'Learner One');
  outsider = await actor('student', branch, 'Learner Two');
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: { branchId: String(branch), types: ['lesson_plan'] },
  });
  schoolClass = await SchoolClass.create({ branchId: branch, name: 'Grade 8', code: '8', academicYear: '2026–27' });
  section = await Section.create({ branchId: branch, classId: schoolClass._id, name: 'A', code: 'A' });
  sectionB = await Section.create({ branchId: branch, classId: schoolClass._id, name: 'B', code: 'B' });
  subject = await Subject.create({ branchId: branch, name: 'Mathematics' });
  otherSubject = await Subject.create({ branchId: branch, name: 'Science' });
  assignment = await TeacherAssignment.create({
    teacherId: teacher.id, branchId: branch, classId: schoolClass._id, sectionId: section._id, subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000), validUntil: new Date(Date.now() + 365 * 86400000), createdBy: admin.id, updatedBy: admin.id,
  });
  await Student.create({ userId: learner.id, branchId: branch, classId: schoolClass._id, sectionId: section._id, admissionNumber: 'A-1' });
  await Student.create({ userId: outsider.id, branchId: branch, classId: schoolClass._id, sectionId: sectionB._id, admissionNumber: 'B-1' });
  await seedCurriculumFixtures();
  const created = await createSyllabus(); assert.equal(created.status, 200);
  const published = await http(`/syllabuses/${created.json.data.syllabusId}/publish`, admin, { revision: 1 });
  assert.equal(published.status, 200); syllabus = published.json.data;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect(); if (db) await db.stop();
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  if (oldAuthority === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY; else process.env.PRINCIPAL_APPROVAL_AUTHORITY = oldAuthority;
  if (oldZone === undefined) delete process.env.SCHOOL_TIMEZONE; else process.env.SCHOOL_TIMEZONE = oldZone;
});
const planDraft = (extra = {}) => ({
  ...tuple(), syllabusId: syllabus.syllabusId, unitId: syllabus.units[0].unitId,
  topicIds: [syllabus.units[0].topics[0].topicId], teachingDate: schoolToday(), objectives: 'Compare integers',
  teachingActivities: 'Practice', resources: '', notes: '', clientOperationId: 'create_plan_for_work_001', ...extra,
});
const createPlan = async (extra = {}, person = teacher) => {
  const response = await http('/teacher/academic/lessons', person, planDraft({
    clientOperationId: `create_plan_${id()}`,
    ...extra,
  }));
  assert.equal(response.status, 200, JSON.stringify(response.json)); return response.json.data;
};
const approvedPlan = async (extra = {}) => {
  const plan = await createPlan(extra);
  const submitted = await http(`/teacher/academic/lessons/${plan.lessonPlanId}/submit`, teacher,
    { revision: plan.revision, clientOperationId: `submit_plan_${plan.lessonPlanId}` });
  assert.equal(submitted.status, 200);
  const reviewed = await http(`/principal/academic-review/${submitted.json.data.approvalRequestId}/decision`, principal,
    { action: 'approved', revision: submitted.json.data.revision, reviewNote: '', clientOperationId: `review_plan_${plan.lessonPlanId}` });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json)); return reviewed.json.data.lesson;
};
const homeworkBody = (plan: any, extra = {}) => ({
  lessonPlanId: plan.lessonPlanId, topicIds: [syllabus.units[0].topics[0].topicId], title: 'Integer practice',
  instructions: 'Complete the assigned integer exercises.', dueAt: addScheduleDays(schoolToday(), 3),
  clientOperationId: 'create_homework_operation_001', ...extra,
});
const quizBody = (plan: any, extra = {}) => ({
  lessonPlanId: plan.lessonPlanId, topicIds: [syllabus.units[0].topics[0].topicId], title: 'Integer check',
  instructions: 'Answer every question.', availableFrom: schoolToday(), availableUntil: addScheduleDays(schoolToday(), 2),
  attemptLimit: 1, timeLimitMinutes: 20, shuffleQuestions: false, clientOperationId: 'create_quiz_operation_001',
  questions: [
    { questionId: 'q_mcq', type: 'multiple_choice', text: 'Which is negative?', options: [
      { optionId: 'a', text: '-2' }, { optionId: 'b', text: '2' },
    ], correctOptionIds: ['a'] },
    { questionId: 'q_tf', type: 'true_false', text: 'Zero is positive.', correctBoolean: false },
    { questionId: 'q_short', type: 'short_answer', text: 'Write an integer.', expectedAnswer: 'Any integer' },
  ], ...extra,
});
const createHomework = async (plan: any, extra = {}, person = teacher) =>
  http('/teacher/academic-work/homework', person, homeworkBody(plan, extra));
const createQuiz = async (plan: any, extra = {}, person = teacher) =>
  http('/teacher/academic-work/quiz', person, quizBody(plan, extra));
const publish = (type: 'homework' | 'quiz', work: any, person = teacher, extra = {}) =>
  http(`/teacher/academic-work/${type}/${work[`${type}Id`]}/publish`, person,
    { revision: work.revision, clientOperationId: `publish_${type}_operation_001`, ...extra });

test('authorized Teacher creates lesson-grounded Homework draft and current roster preview', async () => {
  const plan = await approvedPlan(), created = await createHomework(plan);
  assert.equal(created.status, 200); assert.equal(created.json.data.status, 'draft');
  assert.deepEqual(created.json.data.topicIds, plan.topicIds);
  const preview = await http(`/teacher/academic-work/homework/${created.json.data.homeworkId}/preview`, teacher, {});
  assert.equal(preview.status, 200); assert.equal(preview.json.data.recipientCount, 1);
  assert.deepEqual(Object.keys(preview.json.data.students[0]).sort(), ['admissionNumber', 'fullName', 'studentId']);
});

test('unassigned, foreign-branch and cross-context Teachers cannot create academic work', async () => {
  const plan = await approvedPlan();
  assert.equal((await createHomework(plan, {}, other)).status, 404);
  const foreignTeacher = await actor('teacher', foreign, 'Foreign');
  assert.equal((await createHomework(plan, {}, foreignTeacher)).status, 404);
  await TeacherAssignment.collection.updateOne({ _id: assignment._id }, { $set: { sectionId: sectionB._id } });
  assert.equal((await createHomework(plan)).status, 404);
});

test('foreign syllabus topics and lesson/topic cross-products are concealed', async () => {
  const plan = await approvedPlan();
  assert.equal((await createHomework(plan, { topicIds: [id()] })).status, 404);
  assert.equal((await createHomework(plan, { topicIds: [syllabus.units[1].topics[0].topicId] })).status, 404);
  assert.equal((await createHomework(plan, { subjectId: String(otherSubject._id) })).status, 400);
});

test('draft may be prepared while planning but publication requires approved lesson', async () => {
  const plan = await createPlan(), created = await createHomework(plan);
  assert.equal(created.status, 200);
  assert.equal((await publish('homework', created.json.data)).status, 409);
});

test('revoked Teacher cannot edit, preview or publish a retained draft', async () => {
  const plan = await approvedPlan(), created = await createHomework(plan);
  await TeacherAssignment.updateOne({ _id: assignment._id }, { $set: { isActive: false } });
  assert.equal((await publish('homework', created.json.data)).status, 404);
  assert.equal((await http(`/teacher/academic-work/homework/${created.json.data.homeworkId}/preview`, teacher, {})).status, 404);
});

test('publication rejects recipient injection and re-resolves changed roster', async () => {
  const plan = await approvedPlan(), created = await createHomework(plan);
  assert.equal((await http(`/teacher/academic-work/homework/${created.json.data.homeworkId}/preview`, teacher,
    { recipientIds: [String((await Student.findOne({ userId: outsider.id }))!._id)] })).status, 400);
  await Student.updateOne({ userId: outsider.id }, { $set: { sectionId: section._id } });
  const published = await publish('homework', created.json.data);
  assert.equal(published.status, 200); assert.equal(published.json.data.recipientCount, 2);
  assert.equal(await AcademicWorkAudience.countDocuments({ workId: created.json.data.homeworkId }), 2);
});

test('published audience snapshot survives later roster changes', async () => {
  const plan = await approvedPlan(), created = await createHomework(plan), published = await publish('homework', created.json.data);
  assert.equal(published.status, 200);
  await Student.updateOne({ userId: learner.id }, { $set: { sectionId: sectionB._id } });
  const rows = await AcademicWorkAudience.find({ workId: created.json.data.homeworkId }).lean();
  assert.equal(rows.length, 1); assert.equal(rows[0].admissionNumber, 'A-1'); assert.equal(rows[0].studentName, 'Learner One');
});

test('duplicate and concurrent Homework publication creates one immutable entitlement set', async () => {
  const plan = await approvedPlan(), created = await createHomework(plan);
  const [first, second] = await Promise.all([publish('homework', created.json.data), publish('homework', created.json.data)]);
  assert.deepEqual([first.status, second.status].sort(), [200, 200]);
  assert.equal(await AcademicWorkAudience.countDocuments({ workId: created.json.data.homeworkId }), 1);
  const changed = await publish('homework', created.json.data, teacher, { clientOperationId: 'publish_homework_operation_001', revision: created.json.data.revision + 1 });
  assert.equal(changed.status, 409);
});

test('published Homework is frozen and due-date policy uses school-local date', async () => {
  const plan = await approvedPlan();
  assert.equal((await createHomework(plan, { dueAt: schoolToday() })).status, 200);
  const invalid = await Homework.findOne({ title: 'Integer practice' });
  assert.equal((await publish('homework', { homeworkId: String(invalid!._id), revision: invalid!.revision })).status, 400);
  const created = await createHomework(plan, { clientOperationId: 'create_homework_operation_002' });
  const published = await publish('homework', created.json.data, teacher, { clientOperationId: 'publish_homework_operation_002' });
  assert.equal(published.status, 200);
  const edit = await http(`/teacher/academic-work/homework/${created.json.data.homeworkId}`, teacher,
    { ...homeworkBody(plan), revision: created.json.data.revision, clientOperationId: 'edit_published_homework_01' }, 'PATCH');
  assert.equal(edit.status, 409);
});

test('Quiz draft validates MCQ, true/false and short-answer contracts', async () => {
  const plan = await approvedPlan(), valid = await createQuiz(plan);
  assert.equal(valid.status, 200); assert.equal(valid.json.data.questions.length, 3);
  const tooFew = quizBody(plan, { clientOperationId: 'invalid_quiz_operation_01', questions: [
    { questionId: 'q', type: 'multiple_choice', text: 'Bad', options: [{ optionId: 'a', text: 'Only' }], correctOptionIds: ['a'] },
  ] });
  assert.equal((await http('/teacher/academic-work/quiz', teacher, tooFew)).status, 400);
  const foreignAnswer = quizBody(plan, { clientOperationId: 'invalid_quiz_operation_02', questions: [
    { questionId: 'q', type: 'multiple_choice', text: 'Bad', options: [{ optionId: 'a', text: 'One' }, { optionId: 'b', text: 'Two' }], correctOptionIds: ['x'] },
  ] });
  assert.equal((await http('/teacher/academic-work/quiz', teacher, foreignAnswer)).status, 400);
});

test('Quiz window, attempt settings and private fields are strictly validated', async () => {
  const plan = await approvedPlan();
  assert.equal((await createQuiz(plan, { availableFrom: addScheduleDays(schoolToday(), 2), availableUntil: schoolToday() })).status, 400);
  assert.equal((await createQuiz(plan, { attemptLimit: 0 })).status, 400);
  assert.equal((await createQuiz(plan, { recipientIds: [id()] })).status, 400);
  assert.equal((await createQuiz(plan, { aiGenerated: true })).status, 400);
});

test('published Quiz is frozen and duplicate publication is idempotent', async () => {
  const plan = await approvedPlan(), created = await createQuiz(plan), first = await publish('quiz', created.json.data);
  assert.equal(first.status, 200);
  const replay = await publish('quiz', created.json.data); assert.equal(replay.status, 200);
  assert.equal(await AcademicWorkAudience.countDocuments({ workType: 'quiz', workId: created.json.data.quizId }), 1);
  const edit = await http(`/teacher/academic-work/quiz/${created.json.data.quizId}`, teacher,
    { ...quizBody(plan), revision: created.json.data.revision, clientOperationId: 'edit_published_quiz_001' }, 'PATCH');
  assert.equal(edit.status, 409);
});

test('Student reads only exact entitlements and Quiz answer keys never leak', async () => {
  const plan = await approvedPlan(), homework = await createHomework(plan), quiz = await createQuiz(plan);
  await publish('homework', homework.json.data); await publish('quiz', quiz.json.data);
  const list = await http('/student/academic-work', learner);
  assert.equal(list.status, 200); assert.equal(list.json.data.length, 2);
  const serialized = JSON.stringify(list.json.data);
  for (const forbidden of ['correctOptionIds', 'correctBoolean', 'expectedAnswer', 'createFingerprint', 'publishFingerprint'])
    assert.equal(serialized.includes(forbidden), false);
  const denied = await http(`/student/academic-work/quiz/${quiz.json.data.quizId}`, outsider);
  assert.equal(denied.status, 404);
});

test('Teacher drafts are invisible to Students and future quiz release is server gated', async () => {
  const plan = await approvedPlan(), draftHomework = await createHomework(plan), futureQuiz = await createQuiz(plan, {
    availableFrom: addScheduleDays(schoolToday(), 1), availableUntil: addScheduleDays(schoolToday(), 2),
  });
  assert.equal((await http('/student/academic-work', learner)).json.data.length, 0);
  await publish('quiz', futureQuiz.json.data);
  const list = await http('/student/academic-work', learner);
  assert.equal(list.json.data.length, 0);
  assert.equal((await http(`/student/academic-work/homework/${draftHomework.json.data.homeworkId}`, learner)).status, 404);
});

test('substitute authority is exact-occurrence only and does not grant broad class work', async () => {
  const version = await TimetableVersion.create({ branchId: branch, versionNumber: 1, status: 'approved',
    effectiveFrom: addScheduleDays(schoolToday(), -1), effectiveUntil: addScheduleDays(schoolToday(), 2), periodCount: 1,
    createdBy: admin.id, approvedBy: principal.id });
  const period = await TimetablePeriod.create({ branchId: branch, timetableVersionId: version._id, teacherId: teacher.id,
    ...tuple(), dayOfWeek: new Date(`${schoolToday()}T12:00:00Z`).getUTCDay(), startTime: '00:00', endTime: '23:59', room: 'A' });
  const plan = await approvedPlan({ occurrence: { periodId: String(period._id), timetableVersionId: String(version._id), date: schoolToday() } });
  await SubstituteAssignment.create({ branchId: branch, periodId: period._id, originalTeacherId: teacher.id,
    substituteTeacherId: other.id, date: schoolToday(), startTime: '00:00', endTime: '23:59', room: 'A', status: 'approved',
    createdBy: admin.id, approvedBy: principal.id });
  const substituteDraft = await createHomework(plan, { clientOperationId: 'substitute_homework_001' }, other);
  assert.equal(substituteDraft.status, 200);
  assert.equal((await publish('homework', substituteDraft.json.data, other, { clientOperationId: 'substitute_publish_001' })).status, 200);
  assert.equal((await createHomework(plan, { clientOperationId: 'original_after_substitute' }, teacher)).status, 404);
  const unrelated = await approvedPlan();
  assert.equal((await createHomework(unrelated, { clientOperationId: 'substitute_broad_attempt' }, other)).status, 404);
});

test('safe DTOs expose no credentials, operation fingerprints or arbitrary private roster data', async () => {
  const plan = await approvedPlan(), created = await createQuiz(plan), published = await publish('quiz', created.json.data);
  assert.equal(published.status, 200);
  const context = await http(`/teacher/academic-work/context?lessonPlanId=${plan.lessonPlanId}`);
  const serialized = JSON.stringify(context.json.data);
  for (const forbidden of ['password', 'guardianPhone', 'address', 'createOperationId', 'createFingerprint', 'publishOperationId', 'publishFingerprint'])
    assert.equal(serialized.includes(forbidden), false);
});
