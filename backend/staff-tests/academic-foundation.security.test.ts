import Room from '../src/staff/src/models/room';
import {AttendanceSession, PeriodAttendanceRecord, AttendanceOperation} from '../src/staff/src/models/periodAttendance';
import {AttendanceCorrection, StudentLeave, ensureAttendanceAmendmentIndexes} from '../src/staff/src/models/attendanceAmendment';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import {PERMISSIONS} from '../src/staff/src/constants/permissions';
import Student from '../src/staff/src/models/student';
import {LessonPlan} from '../src/staff/src/models/lessonPlan';
import {Homework} from '../src/staff/src/models/homework';
import {Syllabus} from '../src/staff/src/models/syllabus';
import {schoolToday, addScheduleDays, scheduleWeekday} from '../src/staff/src/services/school-date.service';
import {TimetablePeriod} from '../src/staff/src/models/timetable';
import {ClassSubject} from '../src/staff/src/models/classSubject';
import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import type {Server} from 'node:http';
import {fork, type ChildProcess} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import Branch from '../src/staff/src/models/branch';
import User, {type UserRole} from '../src/staff/src/models/user';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import {AcademicPeriod} from '../src/staff/src/models/academicPeriod';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ensureAcademicSetupIndexes} from '../src/staff/src/services/academic-setup.service';

// Owned replica set only. Never read development connection strings or dotenv.
let db: MongoMemoryReplSet, server: Server, base: string;
let worker: ChildProcess, workerBase: string;
let branch: string, admin: string, principal: string, teacher: string, teacherId: string;
let periodId: string, classId: string, sectionId: string, subjectId: string;
const principalGrants = [...ROLE_PERMISSIONS.principal], adminGrants = [...ROLE_PERMISSIONS.super_admin];
const originalSecret = process.env.JWT_SECRET, originalAuthority = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
const actor = async (role: UserRole, branchId?: string) => {
  const user = await new User({fullName: 'Setup Actor', email: `${new mongoose.Types.ObjectId()}@test.invalid`, password: 'fixture-hash', role, branchId}).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return {id: String(user._id), token};
};
const http = async (path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', endpoint = base) => {
  const response = await fetch(endpoint + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const content = await response.text();
  return {status: response.status, json: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(content) as any : null};
};
const assignment = () => http('/teacher-assignments', principal, {teacherId, classId, sectionId, subjectId, validFrom: '2026-01-01T00:00:00Z'});
before(async () => {
  process.env.JWT_SECRET = 'owned-academic-setup-fixture';
  db = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(db.getUri(), {autoIndex: false});
  await ensureAcademicSetupIndexes();
  await ensureAttendanceAmendmentIndexes();
  await Promise.all([TeacherAssignment.createIndexes(), Syllabus.createIndexes(), LessonPlan.createIndexes(), Homework.createIndexes()]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
  worker = fork(resolvePath(__dirname, 'helpers/academic-setup-worker.ts'), [db.getUri()], {execArgv: ['--import', 'tsx'], silent: true});
  workerBase = await new Promise<string>((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Second API instance did not start')), 15000);
    worker.on('message', (message: any) => {
      if (message.type === 'ready') {clearTimeout(timer); ready(message.base);}
      if (message.type === 'failure') {clearTimeout(timer); reject(new Error(message.message));}
    });
    worker.once('error', error => {clearTimeout(timer); reject(error);});
  });
});
beforeEach(async () => {
  ROLE_PERMISSIONS.principal = [...principalGrants]; ROLE_PERMISSIONS.super_admin = [...adminGrants];
  for (const model of Object.values(mongoose.models)) await model.collection.deleteMany({});
  branch = String((await Branch.create({name: 'Main', code: 'MAIN', address: 'Fixture', city: 'Fixture'}))._id);
  await Branch.create({name: 'Other', code: 'OTHER', address: 'Fixture', city: 'Fixture'});
  const a = await actor('super_admin'); admin = a.token;
  principal = (await actor('principal', branch)).token;
  const t = await actor('teacher', branch); teacher = t.token; teacherId = t.id;
  periodId = String((await AcademicPeriod.create({branchId: branch, name: 'Current year', code: 'CURRENT', startDate: '2026-08-01', endDate: '2027-07-31', status: 'active', createdBy: a.id, updatedBy: a.id}))._id);
  classId = String((await new SchoolClass({branchId: branch, academicPeriodId: periodId, academicYear: 'CURRENT', name: 'Grade 8', code: 'G8'}).save())._id);
  sectionId = String((await new Section({branchId: branch, classId, name: 'A', code: 'A'}).save())._id);
  subjectId = String((await Subject.create({branchId: branch, name: 'Mathematics'}))._id);
  fixtureRoomId = String((await Room.create({branchId:branch,name:'101',code:'101',category:'classroom',createdBy:teacherId,updatedBy:teacherId}))._id);
});
after(async () => {
  ROLE_PERMISSIONS.principal = principalGrants; ROLE_PERMISSIONS.super_admin = adminGrants;
  if (worker?.connected) {
    const exited = new Promise<void>(done => worker.once('exit', () => done()));
    worker.send('shutdown'); await exited;
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect(); if (db) await db.stop();
  if (originalAuthority === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY; else process.env.PRINCIPAL_APPROVAL_AUTHORITY = originalAuthority;
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
const curriculum = (suffix = '', token = principal, body?: unknown, method?: string) => http('/academic-setup/classes/' + classId + '/subjects' + suffix, token, body, method);
const mapSubject = (id = subjectId) => curriculum('', principal, {subjectId: id});
const syllabusInput = () => ({classId, subjectId, version: 1, title: 'Mapped syllabus', units: [{title: 'Unit', topics: [{title: 'Topic'}]}]});
const day = () => schoolToday();
let fixtureRoomId: string;
const scheduleInput = () => ({branchId: branch, versionNumber: 1, effectiveFrom: day(), effectiveUntil: addScheduleDays(day(), 30), periods: [{teacherId, classId, sectionId, subjectId, dayOfWeek: scheduleWeekday(day()), startTime: '08:00', endTime: '09:00', roomId: fixtureRoomId, room: '101'}]});

async function prepared() {
  const mapping = (await mapSubject()).json.data;
  assert.equal((await assignment()).status, 201);
  const created = await http('/syllabuses', admin, syllabusInput());
  assert.equal(created.status, 200);
  const syllabus = (await http('/syllabuses/' + created.json.data.syllabusId + '/publish', admin, {revision: 1})).json.data;
  const lessonBody = (op = 'foundation-lesson-operation-001') => ({classId, sectionId, subjectId, syllabusId: syllabus.syllabusId, unitId: syllabus.units[0].unitId, topicIds: [syllabus.units[0].topics[0].topicId], teachingDate: day(), objectives: 'Verify academic chain', teachingActivities: 'Guided practice', resources: '', notes: '', clientOperationId: op});
  const plan = await http('/teacher/academic/lessons', teacher, lessonBody());
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  const reviewer = await User.findOne({role: 'principal'});
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[String(reviewer!._id)]: {branchId: branch, types: ['lesson_plan']}});
  const submitted = await http('/teacher/academic/lessons/' + plan.json.data.lessonPlanId + '/submit', teacher, {revision: plan.json.data.revision, clientOperationId: 'foundation-submit-lesson-operation'});
  assert.equal(submitted.status, 200);
  const approved = await http('/principal/academic-review/' + submitted.json.data.approvalRequestId + '/decision', principal, {action: 'approved', revision: submitted.json.data.revision, reviewNote: '', clientOperationId: 'foundation-review-lesson-operation'});
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  const workBody = (op = 'foundation-homework-operation-001') => ({lessonPlanId: plan.json.data.lessonPlanId, topicIds: lessonBody().topicIds, title: 'Foundation practice', instructions: 'Complete the practice', dueAt: addScheduleDays(day(), 3), clientOperationId: op});
  const homework = await http('/teacher/academic-work/homework', teacher, workBody());
  assert.equal(homework.status, 200, JSON.stringify(homework.json));
  const pupil = await actor('student', branch);
  const student = await Student.create({userId: pupil.id, branchId: branch, classId, sectionId, admissionNumber: 'FOUNDATION-001'});
  const enrolled = await http('/students/' + student._id + '/enrollments', principal, {academicPeriodId: periodId, classId, sectionId, operationId: 'foundation-enroll-operation-001', reason: 'Confirmed current placement'});
  assert.equal(enrolled.status, 200);
  const schedule = scheduleInput(); schedule.periods.push({...schedule.periods[0], startTime: '09:00', endTime: '10:00'});
  const version = await http('/timetables/versions', principal, schedule); assert.equal(version.status, 201);
  assert.equal((await http('/timetables/versions/' + version.json.data.versionId + '/approve', principal, {})).status, 200);
  const periods = await TimetablePeriod.find({timetableVersionId: version.json.data.versionId}).sort({startTime: 1}).lean();
  const open = await http('/teacher/attendance/occurrences/' + periods[0]._id + '?date=' + day(), teacher);
  assert.equal(open.status, 200, JSON.stringify(open.json));
  return {mapping, lessonBody, workBody, homework: homework.json.data, plan: plan.json.data, periods, attendance: open.json.data, student, pupil, enrollment: enrolled.json.data.enrollment};
}
for (const drift of ['missing mapping', 'inactive mapping', 'wrong period mapping', 'closed period', 'archived period', 'legacy Class'] as const) {
  test('new lesson/work/attendance fail closed after ' + drift + '; retained reads survive', async () => {
    const ctx = await prepared();
    if (drift === 'missing mapping') await ClassSubject.deleteMany({});
    else if (drift === 'inactive mapping') await ClassSubject.updateMany({}, {$set: {isActive: false}});
    else if (drift === 'wrong period mapping') await ClassSubject.collection.updateMany({}, {$set: {academicPeriodId: new mongoose.Types.ObjectId()}});
    else if (drift === 'legacy Class') await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$unset: {academicPeriodId: ''}});
    else {
      assert.equal((await http('/academic-setup/periods/' + periodId + '/close?branchId=' + branch, admin, {revision: 1})).status, 200);
      if (drift === 'archived period') assert.equal((await http('/academic-setup/periods/' + periodId + '/archive?branchId=' + branch, admin, {revision: 2})).status, 200);
    }
    assert.equal((await http('/teacher/academic/lessons', teacher, ctx.lessonBody('foundation-lesson-operation-002'))).status, 409);
    assert.equal((await http('/teacher/academic-work/homework', teacher, ctx.workBody('foundation-homework-operation-002'))).status, 409);
    assert.equal((await http('/teacher/academic-work/homework/' + ctx.homework.homeworkId + '/publish', teacher, {revision: ctx.homework.revision, clientOperationId: 'foundation-publish-operation-001'})).status, 409);
    assert.equal((await http('/teacher/attendance/occurrences/' + ctx.periods[1]._id + '?date=' + day(), teacher)).status, 409);
    assert.equal((await http('/teacher/attendance/sessions/' + ctx.attendance.sessionId + '/draft', teacher, {revision: ctx.attendance.revision, rosterVersion: ctx.attendance.rosterVersion, clientOperationId: 'foundation-attendance-operation-001', marks: [{studentId: String(ctx.student._id), status: 'present'}]})).status, 409);
    assert.equal((await http('/teacher/attendance/sessions/' + ctx.attendance.sessionId, teacher)).status, 200);
    assert.equal((await http('/syllabuses/' + ctx.lessonBody().syllabusId, admin)).status, 200);
    assert.equal((await http('/teacher/timetable?date=' + day(), teacher)).status, 200);
    assert.equal(await LessonPlan.countDocuments(), 1); assert.equal(await Homework.countDocuments(), 1);
  });
}
for (const operation of ['lesson', 'homework', 'attendance'] as const) for (const winner of ['operation', 'closure'] as const) test('two API processes: Period closure vs ' + operation + ', ' + winner + ' first', {timeout: 25000}, async () => {
  const ctx = await prepared(); const closurePath = '/academic-setup/periods/' + periodId + '/close?branchId=' + branch;
  const lessonPath = operation === 'lesson' ? '/teacher/academic/lessons' : operation === 'homework' ? '/teacher/academic-work/homework' : '/teacher/attendance/occurrences/' + ctx.periods[1]._id + '?date=' + day();
  const payload = operation === 'lesson' ? ctx.lessonBody('foundation-race-lesson-operation') : operation === 'homework' ? ctx.workBody('foundation-race-homework-operation') : undefined;
  const original = Branch.collection.updateOne; let entered!: () => void, release!: () => void;
  const acquired = new Promise<void>(done => {entered = done;}), gate = new Promise<void>(done => {release = done;});
  Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {const result = await original.apply(this, args); entered(); await gate; return result;} as typeof original;
  let arrived!: (value: any) => void; const contender = new Promise<void>(done => {arrived = value => {if (value.type === 'fence') done();}; worker.on('message', arrived);});
  try {
    const first = winner === 'operation' ? http(lessonPath, teacher, payload) : http(closurePath, admin, {revision: 1}); await acquired;
    const second = winner === 'operation' ? http(closurePath, admin, {revision: 1}, 'POST', workerBase) : http(lessonPath, teacher, payload, payload === undefined ? 'GET' : 'POST', workerBase);
    await contender; release(); const [a,b] = await Promise.all([first, second]);
    assert.deepEqual([a.status,b.status], winner === 'operation' ? [200,200] : [200,409]);
    assert.equal((await AcademicPeriod.findById(periodId))!.status, 'closed');
    assert.equal(await LessonPlan.countDocuments(), operation === 'lesson' && winner === 'operation' ? 2 : 1);
    assert.equal(await Homework.countDocuments(), operation === 'homework' && winner === 'operation' ? 2 : 1);
  } finally {release(); worker.removeListener('message', arrived); Branch.collection.updateOne = original;}
});
test('managed Section transfer changes new attendance roster without rewriting submitted attendance', async () => {
  const ctx = await prepared(); const a = ctx.attendance;
  assert.equal((await http('/teacher/attendance/sessions/' + a.sessionId + '/submit', teacher, {revision: a.revision, rosterVersion: a.rosterVersion, clientOperationId: 'foundation-attendance-submit-001', marks: [{studentId: String(ctx.student._id), status: 'present'}]})).status, 200);
  const destination = await new Section({branchId: branch, classId, name: 'B', code: 'B'}).save();
  assert.equal((await http('/students/' + ctx.student._id + '/enrollments/' + ctx.enrollment.id + '/transfer', principal, {academicPeriodId: periodId, classId, sectionId: String(destination._id), revision: 1, reason: 'Confirmed Section transfer', operationId: 'foundation-transfer-operation-001'})).status, 200);
  const fresh = await http('/teacher/attendance/occurrences/' + ctx.periods[1]._id + '?date=' + day(), teacher); assert.equal(fresh.status, 200); assert.equal(fresh.json.data.students.length, 0);
  const old = await http('/teacher/attendance/sessions/' + a.sessionId, teacher); assert.equal(old.status, 200); assert.equal(old.json.data.students[0].studentId, String(ctx.student._id)); assert.equal(old.json.data.students[0].status, 'present');
  assert.equal((await http('/student/results', ctx.pupil.token)).status, 200);
  assert.equal((await http('/teacher/classes/' + classId + '/sections/' + destination._id + '/subjects/' + subjectId + '/students', teacher)).status, 404);
});
test('published audience and own submissions survive Period closure without admitting another Student', async () => {
  const ctx = await prepared();
  const published = await http('/teacher/academic-work/homework/' + ctx.homework.homeworkId + '/publish', teacher, {revision: ctx.homework.revision, clientOperationId: 'foundation-publish-operation-001'});
  assert.equal(published.status, 200, JSON.stringify(published.json));
  assert.equal((await http('/academic-setup/periods/' + periodId + '/close?branchId=' + branch, admin, {revision: 1})).status, 200);
  assert.equal((await http('/student/academic-work/homework/' + ctx.homework.homeworkId, ctx.pupil.token)).status, 200);
  const other = await actor('student', branch); await Student.create({userId: other.id, branchId: branch, classId, sectionId, admissionNumber: 'OTHER-001'});
  assert.equal((await http('/student/academic-work/homework/' + ctx.homework.homeworkId, other.token)).status, 404);
  assert.equal((await http('/student/evidence/homework/' + ctx.homework.homeworkId + '/submit', ctx.pupil.token, {clientOperationId: 'foundation-student-submit-operation', content: 'Owned historical evidence'})).status, 200);
  assert.equal((await http('/student/evidence/homework/' + ctx.homework.homeworkId, ctx.pupil.token)).status, 200);
});
test('submitted attendance remains readable after authorized Timetable retirement', async () => {
  const ctx = await prepared(), a = ctx.attendance;
  const marks = [{studentId: String(ctx.student._id), status: 'present'}];
  const writeBody = {revision: a.revision, rosterVersion: a.rosterVersion, clientOperationId: 'foundation-history-submit-operation', marks};
  assert.equal((await http('/teacher/attendance/sessions/' + a.sessionId + '/submit', teacher, writeBody)).status, 200);
  const recordPath = '/teacher/attendance/sessions/' + a.sessionId;
  assert.equal((await http(recordPath, teacher)).status, 200);
  const reviewer = await User.findOne({role: 'principal'});
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[String(reviewer!._id)]: {branchId: branch, types: ['lesson_plan', 'attendance_correction', 'leave']}});
  const correctionPath = recordPath + '/students/' + ctx.student._id;
  const correctionBody = {requestedStatus: 'late', reason: 'Verified historical marking correction', submittedRevision: 1, effectiveRevision: 0, clientOperationId: 'foundation-history-correction-operation'};
  const requested = await http(correctionPath + '/corrections', teacher, correctionBody);
  assert.equal(requested.status, 200, JSON.stringify(requested.json));
  const approvalPath = '/attendance-review/' + requested.json.data.approvalId;
  assert.equal((await http(approvalPath, principal)).status, 200);
  const versionId = String(ctx.periods[0].timetableVersionId);
  const retired = await http('/timetables/versions/' + versionId + '/retire', principal, {});
  assert.equal(retired.status, 200);
  const snapshot = async () => Promise.all([AttendanceSession, PeriodAttendanceRecord, AttendanceOperation, AttendanceCorrection, StudentLeave, ApprovalRequest].map(model => model.collection.find({}).sort({_id: 1}).toArray()));
  const historyBefore = await snapshot();
  const history = await http(recordPath, teacher);
  assert.equal(history.status, 200, 'Submitted history must resolve its pinned timetable, not current operational winners');
  assert.equal(history.json.data.students[0].status, 'present');
  assert.equal(history.json.data.period.approvedVersion.versionId, versionId);
  assert.equal(history.json.data.period.periodId, String(ctx.periods[0]._id));
  assert.equal(history.json.data.canSave, false);
  assert.equal(history.json.data.period.canRequestIssue, false);
  assert.equal(history.json.data.period.canAcknowledgeSubstitute, false);
  const review = await http(correctionPath + '/review', teacher);
  assert.equal(review.status, 200); assert.equal(review.json.data.canRequestCorrection, false); assert.equal(review.json.data.canRequestLeave, false);
  const principalHistory = await http(approvalPath, principal);
  assert.equal(principalHistory.status, 200); assert.equal(principalHistory.json.data.canReview, false);
  assert.equal((await http(approvalPath + '/decision', principal, {action: 'approved', revision: 0, reviewNote: 'Verified correction request', clientOperationId: 'foundation-history-review-operation'})).status, 404);
  const unrelated = await actor('teacher', branch);
  assert.equal((await http('/teacher-assignments', principal, {teacherId: unrelated.id, classId, sectionId, subjectId, validFrom: '2026-01-01T00:00:00Z'})).status, 201);
  assert.equal((await http(recordPath, unrelated.token)).status, 404);
  const foreignBranch = (await Branch.findOne({code: 'OTHER'}))!._id;
  const foreignTeacher = await actor('teacher', String(foreignBranch)), foreignPrincipal = await actor('principal', String(foreignBranch));
  assert.equal((await http(recordPath, foreignTeacher.token)).status, 404);
  assert.equal((await http(approvalPath, foreignPrincipal.token)).status, 404);
  assert.equal((await http('/teacher/attendance/sessions/' + new mongoose.Types.ObjectId(), teacher)).status, 404);
  for (const period of ctx.periods) assert.equal((await http('/teacher/attendance/occurrences/' + period._id + '?date=' + day(), teacher)).status, 404);
  for (const action of ['draft', 'submit']) assert.equal((await http(recordPath + '/' + action, teacher, {...writeBody, revision: 1, clientOperationId: 'foundation-retired-write-operation'})).status, 404);
  assert.equal((await http(correctionPath + '/corrections', teacher, {...correctionBody, clientOperationId: 'foundation-retired-correction-operation'})).status, 404);
  assert.equal((await http(correctionPath + '/corrections', unrelated.token, correctionBody)).status, 404);
  const grants = [...ROLE_PERMISSIONS.teacher];
  try {ROLE_PERMISSIONS.teacher = grants.filter(p => p !== PERMISSIONS.TEACHER_ATTENDANCE_VIEW); assert.equal((await http(recordPath, teacher)).status, 403);} finally {ROLE_PERMISSIONS.teacher = grants;}
  await User.updateOne({_id: teacherId}, {$set: {isActive: false}}); assert.equal((await http(recordPath, teacher)).status, 401);
  await User.updateOne({_id: teacherId}, {$set: {isActive: true, branchId: foreignBranch}}); assert.equal((await http(recordPath, teacher)).status, 404);
  await User.updateOne({_id: teacherId}, {$set: {branchId: branch}});
  await TeacherAssignment.updateMany({teacherId}, {$set: {isActive: false}}); assert.equal((await http(recordPath, teacher)).status, 404);
  assert.deepEqual(await snapshot(), historyBefore, 'History reads and denied mutations must leave session, marks, receipts and amendment audit unchanged');
  assert.equal((await TimetablePeriod.find({timetableVersionId: versionId})).length, 2);
});
