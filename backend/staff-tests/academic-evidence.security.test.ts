import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import type {Server} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, {type UserRole} from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import Student from '../src/staff/src/models/student';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import {Syllabus} from '../src/staff/src/models/syllabus';
import {LessonPlan} from '../src/staff/src/models/lessonPlan';
import {Homework} from '../src/staff/src/models/homework';
import {Quiz} from '../src/staff/src/models/quiz';
import {AcademicWorkAudience} from '../src/staff/src/models/academicWorkAudience';
import {HomeworkSubmission} from '../src/staff/src/models/homeworkSubmission';
import {QuizAttempt} from '../src/staff/src/models/quizAttempt';
import {AcademicRubric} from '../src/staff/src/models/academicRubric';
import {TeacherReview} from '../src/staff/src/models/teacherReview';
import {SubstituteAssignment, TimetablePeriod, TimetableVersion} from '../src/staff/src/models/timetable';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {addScheduleDays, schoolToday} from '../src/staff/src/services/school-date.service';
import {ensureAcademicEvidenceIndexes} from '../src/staff/src/services/academic-evidence.service';

let db: MongoMemoryReplSet, server: Server, base: string;
let branch: any, foreign: any, teacher: any, other: any, foreignTeacher: any, learner: any, outsider: any;
let schoolClass: any, section: any, subject: any, assignment: any, student: any;
let syllabus: any, plan: any, homework: any, quiz: any, homeworkAudience: any;
const oldSecret = process.env.JWT_SECRET, oldZone = process.env.SCHOOL_TIMEZONE;
const oid = () => new mongoose.Types.ObjectId();
const actor = async (role: UserRole, branchId = branch, name = 'Person') => {
  const user = await User.create({fullName: name, email: `${oid()}@test.invalid`, password: 'private', role, branchId});
  const token = generateAccessToken(String(user._id), role); await registerSession(String(user._id), token, role);
  return {id: user._id, token};
};
const http = async (path: string, person: any, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + path, {method, headers: {Authorization: `Bearer ${person.token}`, 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, json: await response.json() as any};
};
const hwSubmit = (extra = {}, person = learner) => http(`/student/evidence/homework/${homework._id}/submit`, person,
  {content: 'My immutable homework evidence', clientOperationId: 'homework_submit_operation_001', ...extra});
const start = (extra = {}, person = learner) => http(`/student/evidence/quiz/${quiz._id}/attempts/start`, person,
  {clientOperationId: 'quiz_start_operation_001', ...extra});
const answers = () => [
  {questionId: 'mcq', optionIds: ['a']}, {questionId: 'tf', booleanAnswer: false}, {questionId: 'short', textAnswer: 'My own response'},
];
const submitAttempt = (attempt: any, extra = {}, person = learner) =>
  http(`/student/evidence/quiz/${quiz._id}/attempts/${(attempt.json?.data ?? attempt).attemptId}/submit`, person,
    {answers: answers(), revision: (attempt.json?.data ?? attempt).revision, clientOperationId: 'quiz_submit_operation_001', ...extra});
const review = (target: string, evidenceId: string, body: any, person = teacher) =>
  http(`/teacher/reviews/${target}/${evidenceId}`, person, body);

before(async () => {
  process.env.JWT_SECRET = 'academic-evidence-security-secret'; process.env.SCHOOL_TIMEZONE = 'Asia/Karachi';
  db = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(db.getUri(), {dbName: 'academic_evidence_security', autoIndex: false});
  await ensureAcademicEvidenceIndexes(); server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as {port: number}).port}/api`;
});
beforeEach(async () => {
  for (const model of [TeacherReview, AcademicRubric, QuizAttempt, HomeworkSubmission, AcademicWorkAudience, Homework, Quiz,
    SubstituteAssignment, TimetablePeriod, TimetableVersion, LessonPlan, Syllabus, TeacherAssignment, Student, Subject, Section, SchoolClass, Session, User, Branch])
    await model.collection.deleteMany({});
  branch = (await Branch.create({name: 'Branch A', code: 'AA', address: 'private', city: 'Lahore'}))._id;
  foreign = (await Branch.create({name: 'Branch B', code: 'BB', address: 'private', city: 'Lahore'}))._id;
  teacher = await actor('teacher', branch, 'Ayesha Teacher'); other = await actor('teacher', branch, 'Other Teacher');
  foreignTeacher = await actor('teacher', foreign, 'Foreign Teacher');
  learner = await actor('student', branch, 'Learner One'); outsider = await actor('student', branch, 'Learner Two');
  schoolClass = await SchoolClass.create({branchId: branch, name: 'Grade 8', code: '8', academicYear: '2026–27'});
  section = await Section.create({branchId: branch, classId: schoolClass._id, name: 'A', code: 'A'});
  subject = await Subject.create({branchId: branch, name: 'Mathematics'});
  assignment = await TeacherAssignment.create({teacherId: teacher.id, branchId: branch, classId: schoolClass._id,
    sectionId: section._id, subjectId: subject._id, validFrom: new Date(Date.now() - 86400000),
    validUntil: new Date(Date.now() + 86400000 * 30), createdBy: teacher.id, updatedBy: teacher.id});
  student = await Student.create({userId: learner.id, branchId: branch, classId: schoolClass._id, sectionId: section._id, admissionNumber: 'A-1'});
  await Student.create({userId: outsider.id, branchId: branch, classId: schoolClass._id, sectionId: section._id, admissionNumber: 'A-2'});
  const topicId = oid(), unitId = oid();
  syllabus = await Syllabus.create({branchId: branch, classId: schoolClass._id, subjectId: subject._id, academicYear: '2026–27',
    title: 'Mathematics', version: 1, revision: 1, status: 'published', units: [{_id: unitId, title: 'Numbers', order: 1,
      topics: [{_id: topicId, title: 'Integers', order: 1, outcomes: []}]}], createdBy: teacher.id, updatedBy: teacher.id,
    publishedBy: teacher.id, publishedAt: new Date()});
  plan = await LessonPlan.create({branchId: branch, teacherId: teacher.id, assignmentId: assignment._id, classId: schoolClass._id,
    sectionId: section._id, subjectId: subject._id, academicYear: '2026–27', syllabusId: syllabus._id, unitId, topicIds: [topicId],
    teachingDate: schoolToday(), objectives: 'Learn', teachingActivities: 'Practice', state: 'approved', revision: 1,
    approvedRevision: 1, submissions: [{revision: 1, content: {topicIds: [topicId]}, submittedAt: new Date(), submittedBy: teacher.id}],
    createOperationId: 'lesson_create_operation_001', createFingerprint: 'fingerprint', createdBy: teacher.id, updatedBy: teacher.id});
  const common = {branchId: branch, teacherId: teacher.id, assignmentId: assignment._id, classId: schoolClass._id,
    sectionId: section._id, subjectId: subject._id, academicYear: '2026–27', syllabusId: syllabus._id, syllabusVersion: 1,
    lessonPlanId: plan._id, lessonPlanRevision: 1, topicIds: [topicId], status: 'published', revision: 1, publishedRevision: 1,
    publishedAt: new Date(), recipientCount: 1, createFingerprint: 'fingerprint', publishOperationId: 'publish_operation_001',
    publishFingerprint: 'publish_fingerprint'};
  homework = await Homework.create({...common, title: 'Practice', instructions: 'Complete it', dueAt: addScheduleDays(schoolToday(), 2),
    latePolicy: 'closed_after_due_date', createOperationId: 'homework_create_operation_001'});
  quiz = await Quiz.create({...common, title: 'Quiz', instructions: 'Answer it', availableFrom: schoolToday(),
    availableUntil: addScheduleDays(schoolToday(), 2), attemptLimit: 1, timeLimitMinutes: 20, shuffleQuestions: false,
    createOperationId: 'quiz_create_operation_001', questions: [
      {questionId: 'mcq', type: 'multiple_choice', text: 'Negative?', options: [{optionId: 'a', text: '-2'}, {optionId: 'b', text: '2'}], correctOptionIds: ['a']},
      {questionId: 'tf', type: 'true_false', text: 'Zero positive?', correctBoolean: false},
      {questionId: 'short', type: 'short_answer', text: 'Explain', expectedAnswer: 'Teacher only'},
    ]});
  homeworkAudience = await AcademicWorkAudience.create({branchId: branch, workType: 'homework', workId: homework._id,
    publishedRevision: 1, studentId: student._id, recipientUserId: learner.id, admissionNumber: 'A-1', studentName: 'Learner One', entitledAt: new Date()});
  await AcademicWorkAudience.create({branchId: branch, workType: 'quiz', workId: quiz._id,
    publishedRevision: 1, studentId: student._id, recipientUserId: learner.id, admissionNumber: 'A-1', studentName: 'Learner One', entitledAt: new Date()});
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); if (db) await db.stop();
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  if (oldZone === undefined) delete process.env.SCHOOL_TIMEZONE; else process.env.SCHOOL_TIMEZONE = oldZone;
});

test('entitlement, not current class membership, authorizes immutable Homework evidence', async () => {
  assert.equal((await hwSubmit()).status, 200);
  const denied = await hwSubmit({clientOperationId: 'outsider_submit_operation_01'}, outsider); assert.equal(denied.status, 404);
  assert.equal(await HomeworkSubmission.countDocuments({audienceEntitlementId: homeworkAudience._id}), 1);
});

test('draft/unpublished and foreign work are concealed from Student submission endpoints', async () => {
  const draft = await Homework.create({...homework.toObject(), _id: oid(), status: 'draft', publishedRevision: undefined,
    createOperationId: 'draft_homework_operation_001'});
  assert.equal((await http(`/student/evidence/homework/${draft._id}/submit`, learner,
    {content: 'Guess', clientOperationId: 'draft_submit_operation_001'})).status, 404);
  assert.equal((await http(`/student/evidence/homework/${oid()}/submit`, learner,
    {content: 'Guess', clientOperationId: 'foreign_submit_operation_01'})).status, 404);
});

test('Homework duplicate and concurrent submit are idempotent and preserve one revision', async () => {
  const [a, b] = await Promise.all([hwSubmit(), hwSubmit()]); assert.deepEqual([a.status, b.status].sort(), [200, 200]);
  const row = await HomeworkSubmission.findOne({homeworkId: homework._id}); assert.equal(row?.revisions.length, 1);
  assert.equal((await hwSubmit({content: 'Changed'})).status, 409);
});

test('Homework timing and missing state are server-derived without fake evidence', async () => {
  const empty = await http(`/student/evidence/homework/${homework._id}`, learner); assert.equal(empty.json.data.state, 'not_submitted');
  await Homework.updateOne({_id: homework._id}, {$set: {dueAt: addScheduleDays(schoolToday(), -1)}});
  const missing = await http(`/student/evidence/homework/${homework._id}`, learner); assert.equal(missing.json.data.state, 'missing');
  assert.equal(await HomeworkSubmission.countDocuments(), 0);
  assert.equal((await hwSubmit()).status, 409);
  await Homework.updateOne({_id: homework._id}, {$set: {dueAt: addScheduleDays(schoolToday(), 2)}});
  assert.equal((await hwSubmit({late: true})).status, 400);
  const receipt = await hwSubmit(); assert.equal(receipt.json.data.latest.timing, 'on_time');
});

test('resubmit requires explicit Teacher return and appends rather than overwrites', async () => {
  const first = await hwSubmit(); assert.equal((await hwSubmit({content: 'Unauthorized', clientOperationId: 'resubmit_denied_operation'})).status, 409);
  const returned = await review('homework_submission', first.json.data.submissionId, {action: 'return_for_resubmission', revision: 0,
    returnReason: 'Please add working.', resubmitAllowed: true, clientOperationId: 'return_submission_operation_01'});
  assert.equal(returned.status, 200);
  const second = await hwSubmit({content: 'Revised immutable evidence', clientOperationId: 'resubmit_homework_operation_01'});
  assert.equal(second.status, 200); assert.equal(second.json.data.submissionRevision, 2);
  const row = await HomeworkSubmission.findById(first.json.data.submissionId).lean();
  assert.deepEqual(row!.revisions.map(v => v.content), ['My immutable homework evidence', 'Revised immutable evidence']);
  assert.equal((await TeacherReview.findOne({evidenceId: row!._id}))!.history.length, 1);
});

test('Quiz start is idempotent, reconnect resumes, and attempt limit is enforced', async () => {
  const [first, replay] = await Promise.all([start(), start()]); assert.deepEqual([first.status, replay.status].sort(), [200, 200]);
  assert.equal(replay.json.data.attemptId, first.json.data.attemptId);
  const resumed = await start({clientOperationId: 'different_start_operation_01'}); assert.equal(resumed.json.data.attemptId, first.json.data.attemptId);
  const submitted = await submitAttempt(first); assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  assert.equal((await start({clientOperationId: 'second_attempt_operation_01'})).status, 409);
  assert.equal(await QuizAttempt.countDocuments({quizId: quiz._id}), 1);
});

test('Quiz timer and school-local release window are server authoritative', async () => {
  await Quiz.updateOne({_id: quiz._id}, {$set: {availableFrom: addScheduleDays(schoolToday(), 1)}});
  assert.equal((await start()).status, 409);
  await Quiz.updateOne({_id: quiz._id}, {$set: {availableFrom: schoolToday()}});
  const active = await start(); await QuizAttempt.collection.updateOne({_id: new mongoose.Types.ObjectId(active.json.data.attemptId)}, {$set: {expiresAt: new Date(Date.now() - 1000)}});
  const expired = await submitAttempt(active); assert.equal(expired.status, 409, JSON.stringify(expired.json));
});

test('Quiz submit is retry-safe, rule-scores objective items, and never exposes answer keys', async () => {
  const active = await start(), [submitted, replay] = await Promise.all([submitAttempt(active), submitAttempt(active)]);
  assert.deepEqual([submitted.status, replay.status].sort(), [200, 200], JSON.stringify([submitted.json, replay.json]));
  const serialized = JSON.stringify(submitted.json.data);
  for (const secret of ['correctOptionIds', 'correctBoolean', 'expectedAnswer', 'objectiveScore', 'objectiveMax']) assert.equal(serialized.includes(secret), false);
  const stored = await QuizAttempt.findById(active.json.data.attemptId).lean();
  assert.equal(stored!.objectiveScore, 2); assert.equal(stored!.objectiveMax, 2); assert.equal(stored!.requiresManualReview, true);
  assert.equal((await submitAttempt(active, {aiGrade: true, clientOperationId: 'ai_attempt_operation_001'})).status, 400);
});

test('Teacher review authority requires the exact current assignment and conceals guessed evidence', async () => {
  const submitted = await hwSubmit();
  assert.equal((await http(`/teacher/reviews/homework_submission/${submitted.json.data.submissionId}`, other)).status, 404);
  assert.equal((await http(`/teacher/reviews/homework_submission/${submitted.json.data.submissionId}`, foreignTeacher)).status, 404);
  await TeacherAssignment.updateOne({_id: assignment._id}, {$set: {isActive: false}});
  assert.equal((await http(`/teacher/reviews/homework_submission/${submitted.json.data.submissionId}`, teacher)).status, 404);
  assert.equal((await http(`/teacher/reviews/homework_submission/${oid()}`, teacher)).status, 404);
});

test('substitute review authority is limited to the exact occurrence-linked work', async () => {
  const version = await TimetableVersion.create({branchId: branch, versionNumber: 1, status: 'approved',
    effectiveFrom: addScheduleDays(schoolToday(), -1), effectiveUntil: addScheduleDays(schoolToday(), 2), periodCount: 1,
    createdBy: teacher.id, approvedBy: teacher.id});
  const period = await TimetablePeriod.create({branchId: branch, timetableVersionId: version._id, teacherId: teacher.id,
    classId: schoolClass._id, sectionId: section._id, subjectId: subject._id,
    dayOfWeek: new Date(`${schoolToday()}T12:00:00Z`).getUTCDay(), startTime: '00:00', endTime: '23:59', room: 'A'});
  await SubstituteAssignment.create({branchId: branch, periodId: period._id, originalTeacherId: teacher.id, substituteTeacherId: other.id,
    date: schoolToday(), startTime: '00:00', endTime: '23:59', room: 'A', status: 'approved', createdBy: teacher.id, approvedBy: teacher.id});
  const occurrencePlan = await LessonPlan.create({...plan.toObject(), _id: oid(), createOperationId: 'occurrence_plan_operation_001',
    occurrence: {periodId: period._id, timetableVersionId: version._id, date: schoolToday()}});
  const occurrenceWork = await Homework.create({...homework.toObject(), _id: oid(), teacherId: other.id, assignmentId: undefined,
    lessonPlanId: occurrencePlan._id, createOperationId: 'substitute_homework_operation_001'});
  const entitlement = await AcademicWorkAudience.create({branchId: branch, workType: 'homework', workId: occurrenceWork._id,
    publishedRevision: 1, studentId: student._id, recipientUserId: learner.id, admissionNumber: 'A-1', studentName: 'Learner One', entitledAt: new Date()});
  const submitted = await http(`/student/evidence/homework/${occurrenceWork._id}/submit`, learner,
    {content: 'Occurrence work', clientOperationId: 'occurrence_submit_operation_01'});
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json)); assert.equal(String((await HomeworkSubmission.findById(submitted.json.data.submissionId))!.audienceEntitlementId), String(entitlement._id));
  assert.equal((await http(`/teacher/reviews/homework_submission/${submitted.json.data.submissionId}`, other)).status, 200);
  assert.equal((await http(`/teacher/reviews/homework_submission/${submitted.json.data.submissionId}`, teacher)).status, 404);
  const normal = await hwSubmit({clientOperationId: 'normal_scope_submit_operation'});
  assert.equal((await http(`/teacher/reviews/homework_submission/${normal.json.data.submissionId}`, other)).status, 404);
});

test('rubric validation, draft privacy, finalization, explicit release, and safe DTOs are separated', async () => {
  const submitted = await hwSubmit(), evidenceId = submitted.json.data.submissionId;
  const draft = await review('homework_submission', evidenceId, {action: 'save_draft', revision: 0,
    criteria: [{criterionId: 'quality', title: 'Quality', description: 'Clear work', maxScore: 10}],
    scores: [{criterionId: 'quality', score: 7}], feedback: 'Draft feedback', privateNote: 'Teacher only',
    clientOperationId: 'review_draft_operation_001'});
  assert.equal(draft.status, 200); assert.equal((await http(`/student/evidence/homework/${homework._id}`, learner)).json.data.releasedReview, null);
  assert.equal((await review('homework_submission', evidenceId, {action: 'finalize', revision: 1,
    scores: [{criterionId: 'quality', score: 11}], feedback: 'Final feedback', clientOperationId: 'invalid_score_operation_001'})).status, 400);
  const final = await review('homework_submission', evidenceId, {action: 'finalize', revision: 1,
    scores: [{criterionId: 'quality', score: 9}], feedback: 'Final feedback', privateNote: 'Never Student-visible',
    clientOperationId: 'finalize_review_operation_01'});
  assert.equal(final.status, 200); assert.equal((await http(`/student/evidence/homework/${homework._id}`, learner)).json.data.releasedReview, null);
  const released = await review('homework_submission', evidenceId, {action: 'release_feedback', revision: 2,
    clientOperationId: 'release_feedback_operation_01'}); assert.equal(released.status, 200);
  const studentView = await http(`/student/evidence/homework/${homework._id}`, learner);
  assert.equal(studentView.json.data.releasedReview.feedback, 'Final feedback');
  assert.equal(JSON.stringify(studentView.json.data).includes('privateNote'), false);
});

test('stale and concurrent review writes conflict instead of last-write-wins', async () => {
  const submitted = await hwSubmit(), evidenceId = submitted.json.data.submissionId;
  const body = (op: string, feedback: string) => ({action: 'save_draft', revision: 0,
    criteria: [{criterionId: 'quality', title: 'Quality', description: '', maxScore: 10}], rubricRevision: undefined,
    scores: [{criterionId: 'quality', score: 5}], feedback, clientOperationId: op});
  const [a, b] = await Promise.all([review('homework_submission', evidenceId, body('concurrent_review_operation_1', 'One')),
    review('homework_submission', evidenceId, body('concurrent_review_operation_2', 'Two'))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await TeacherReview.findOne({evidenceId}))!.history.length, 1);
  assert.equal((await review('homework_submission', evidenceId, body('stale_review_operation_001', 'Stale'))).status, 409);
});

test('review queue includes safe submitted evidence and derives missing without fake submissions', async () => {
  const submitted = await hwSubmit();
  let queue = await http('/teacher/reviews', teacher); assert.equal(queue.status, 200, JSON.stringify(queue.json));
  assert.equal(queue.json.data.items.some((v: any) => v.evidenceId === submitted.json.data.submissionId), true);
  await HomeworkSubmission.deleteMany({}); await Homework.updateOne({_id: homework._id}, {$set: {dueAt: addScheduleDays(schoolToday(), -1)}});
  queue = await http('/teacher/reviews', teacher); const missing = queue.json.data.items.find((v: any) => v.submissionState === 'missing');
  assert.equal(missing.student.fullName, 'Learner One'); assert.equal(await HomeworkSubmission.countDocuments(), 0);
  assert.equal(JSON.stringify(queue.json.data).match(/guardian|address|password|answerKey|correctOption/), null);
});
