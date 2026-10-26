import Fee from '../src/staff/src/models/fee';
import {getBranchFeeSummary} from '../src/staff/src/services/fee.service';
import {Homework} from '../src/staff/src/models/homework';
import {Quiz} from '../src/staff/src/models/quiz';
import {AcademicWorkAudience} from '../src/staff/src/models/academicWorkAudience';
import {HomeworkSubmission} from '../src/staff/src/models/homeworkSubmission';
import {AcademicResult} from '../src/staff/src/models/academicResult';
import {CatchUpItem} from '../src/staff/src/models/catchUpItem';
import {AttendanceSession, PeriodAttendanceRecord} from '../src/staff/src/models/periodAttendance';
import Student from '../src/staff/src/models/student';
import {StudentEnrollment, EnrollmentOperation} from '../src/staff/src/models/studentEnrollment';
import {resolveAcademicWorkRecipients} from '../src/staff/src/services/academic-work.service';
import {enrollmentMembership} from '../src/staff/src/services/enrollment-membership.service';
import {schoolToday, addScheduleDays, scheduleWeekday} from '../src/staff/src/services/school-date.service';
import {TimetablePeriod, TimetableVersion} from '../src/staff/src/models/timetable';
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
import {PERMISSIONS} from '../src/staff/src/constants/permissions';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ensureAcademicSetupIndexes} from '../src/staff/src/services/academic-setup.service';

// Owned replica set only. Never read development connection strings or dotenv.
let db: MongoMemoryReplSet, server: Server, base: string;
let worker: ChildProcess, workerBase: string;
let branch: string, foreign: string, admin: string, principal: string, teacher: string, teacherId: string;
let periodId: string, classId: string, sectionId: string, subjectId: string;
const principalGrants = [...ROLE_PERMISSIONS.principal], adminGrants = [...ROLE_PERMISSIONS.super_admin];
const originalSecret = process.env.JWT_SECRET;
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
before(async () => {
  process.env.JWT_SECRET = 'owned-academic-setup-fixture';
  db = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(db.getUri(), {autoIndex: false});
  await ensureAcademicSetupIndexes();
  await TeacherAssignment.createIndexes();
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
  foreign = String((await Branch.create({name: 'Other', code: 'OTHER', address: 'Fixture', city: 'Fixture'}))._id);
  const a = await actor('super_admin'); admin = a.token;
  principal = (await actor('principal', branch)).token;
  const t = await actor('teacher', branch); teacher = t.token; teacherId = t.id;
  periodId = String((await AcademicPeriod.create({branchId: branch, name: 'Current year', code: 'CURRENT', startDate: '2026-08-01', endDate: '2027-07-31', status: 'active', createdBy: a.id, updatedBy: a.id}))._id);
  classId = String((await new SchoolClass({branchId: branch, academicPeriodId: periodId, academicYear: 'CURRENT', name: 'Grade 8', code: 'G8'}).save())._id);
  sectionId = String((await new Section({branchId: branch, classId, name: 'A', code: 'A'}).save())._id);
  subjectId = String((await Subject.create({branchId: branch, name: 'Mathematics'}))._id);
});
after(async () => {
  ROLE_PERMISSIONS.principal = principalGrants; ROLE_PERMISSIONS.super_admin = adminGrants;
  if (worker?.connected) {
    const exited = new Promise<void>(done => worker.once('exit', () => done()));
    worker.send('shutdown'); await exited;
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect(); if (db) await db.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
let studentId: string, studentToken: string, otherSectionId: string;
beforeEach(async () => {
  const pupil = await actor('student', branch); studentToken = pupil.token;
  studentId = String((await Student.create({userId: pupil.id, branchId: branch, classId, sectionId, admissionNumber: 'A-100'}))._id);
  otherSectionId = String((await new Section({branchId: branch, classId, name: 'B', code: 'B'}).save())._id);
});
const path = () => '/students/' + studentId + '/enrollments';
const target = () => ({academicPeriodId: periodId, classId, sectionId});
const body = (operationId = 'owned-enrollment-operation-001', extra: Record<string, unknown> = {}) => ({operationId, reason: 'Principal confirms placement', ...target(), ...extra});
const enroll = (operationId = 'owned-enrollment-operation-001', extra: Record<string, unknown> = {}) => http(path(), principal, body(operationId, extra));
const detail = () => http(path(), principal);
const change = (id: string, action: string, extra: Record<string, unknown> = {}, endpoint = base) => http(path() + '/' + id + '/' + action, principal, action === 'withdraw' ? {operationId: 'withdraw-operation-001', revision: 1, reason: 'Family requested withdrawal', ...extra} : body(action + '-operation-001', {revision: 1, sectionId: otherSectionId, ...extra}), 'POST', endpoint);
async function nextPeriod() {
  await AcademicPeriod.updateOne({_id: periodId}, {$set: {status: 'closed'}});
  const owner = (await User.findOne({role: 'super_admin'}))!._id;
  const period = await AcademicPeriod.create({branchId: branch, name: 'Next year', code: 'NEXT', startDate: '2027-08-01', endDate: '2028-07-31', status: 'active', createdBy: owner, updatedBy: owner});
  const cls = await new SchoolClass({branchId: branch, academicPeriodId: period._id, academicYear: 'NEXT', name: 'Grade 9', code: 'G9'}).save();
  const sec = await new Section({branchId: branch, classId: cls._id, name: 'A', code: 'A'}).save();
  return {academicPeriodId: String(period._id), classId: String(cls._id), sectionId: String(sec._id)};
}
test('authentication, role and each narrow permission protect enrollment APIs', async () => {
  assert.equal((await http(path())).status, 401);
  for (const token of [teacher, studentToken]) {assert.equal((await http(path(), token)).status, 403); assert.equal((await http(path(), token, body())).status, 403);}
  for (const permission of [PERMISSIONS.ENROLLMENT_VIEW, PERMISSIONS.ENROLLMENT_MANAGE, PERMISSIONS.ENROLLMENT_PROMOTE, PERMISSIONS.ENROLLMENT_WITHDRAW]) {
    ROLE_PERMISSIONS.principal = principalGrants.filter(p => p !== permission);
    const result = permission === PERMISSIONS.ENROLLMENT_VIEW ? await detail() : permission === PERMISSIONS.ENROLLMENT_MANAGE ? await enroll() : await change(String(new mongoose.Types.ObjectId()), permission === PERMISSIONS.ENROLLMENT_PROMOTE ? 'promote' : 'withdraw');
    assert.equal(result.status, 403); ROLE_PERMISSIONS.principal = [...principalGrants];
  }
});
test('explicit first enrollment preserves permanent identity and returns actor-free contextual DTO', async () => {
  assert.equal((await detail()).json.data.legacy, true);
  assert.equal(await StudentEnrollment.countDocuments(), 0);
  const created = await enroll(); assert.equal(created.status, 200);
  assert.equal(created.json.data.enrollment.period.id, periodId);
  const current = (await detail()).json.data; assert.equal(current.history.length, 1); assert.equal(current.student.id, studentId); assert.equal(current.current.section.id, sectionId);
  assert.equal(JSON.stringify(created.json).includes('createdBy'), false); assert.equal(await Student.countDocuments(), 1);
});
test('Principal rejects foreign Branch reads and crafted body authority', async () => {
  assert.equal((await http(path() + '?branchId=' + foreign, principal)).status, 404);
  assert.equal((await http('/students?branchId=' + foreign, principal)).status, 404);
  assert.equal((await http('/students/enrollment-options?branchId=' + foreign, principal)).status, 404);
  for (const extra of [{branchId: foreign}, {studentId}, {status: 'active'}, {createdBy: teacherId}, {effectiveFrom: '2020-01-01'}]) assert.equal((await enroll(undefined, extra)).status, 400);
});
for (const reference of ['student', 'period', 'class', 'section', 'class-section'] as const) test('foreign or mismatched ' + reference + ' fails concealed', async () => {
  const owner = (await User.findOne({role: 'super_admin'}))!._id;
  const period = await AcademicPeriod.create({branchId: foreign, name: 'Foreign', code: 'F', startDate: '2026-08-01', endDate: '2027-07-31', status: 'active', createdBy: owner, updatedBy: owner});
  const cls = await new SchoolClass({branchId: foreign, academicPeriodId: period._id, academicYear: 'F', name: 'Foreign', code: 'F'}).save();
  const sec = await new Section({branchId: foreign, classId: cls._id, name: 'F', code: 'F'}).save();
  const extra = reference === 'period' ? {academicPeriodId: String(period._id)} : reference === 'class' ? {classId: String(cls._id)} : {sectionId: String(sec._id)};
  if (reference === 'student') await Student.collection.updateOne({_id: new mongoose.Types.ObjectId(studentId)}, {$set: {branchId: new mongoose.Types.ObjectId(foreign)}});
  if (reference === 'class-section') await Section.collection.updateOne({_id: new mongoose.Types.ObjectId(otherSectionId)}, {$set: {classId: new mongoose.Types.ObjectId()}});
  assert.equal((await enroll(undefined, reference === 'student' ? {} : reference === 'class-section' ? {sectionId: otherSectionId} : extra)).status, 404);
  assert.equal(await StudentEnrollment.countDocuments(), 0);
});
test('same-Branch Class belonging to another period is insufficient', async () => {
  const other = await nextPeriod(); assert.equal((await enroll(undefined, {academicPeriodId: other.academicPeriodId})).status, 404);
});
for (const parent of ['student', 'identity', 'branch', 'period', 'class', 'section'] as const) test('inactive ' + parent + ' blocks initial enrollment without partial state', async () => {
  if (parent === 'student') await Student.updateOne({_id: studentId}, {$set: {isActive: false}});
  if (parent === 'identity') {const pupil = await Student.findById(studentId); await User.collection.updateOne({_id: new mongoose.Types.ObjectId(String(pupil!.userId))}, {$set: {isActive: false}});}
  if (parent === 'branch') await Branch.updateOne({_id: branch}, {$set: {isActive: false}});
  if (parent === 'period') await AcademicPeriod.updateOne({_id: periodId}, {$set: {status: 'closed'}});
  if (parent === 'class') await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$set: {isActive: false}});
  if (parent === 'section') await Section.collection.updateOne({_id: new mongoose.Types.ObjectId(sectionId)}, {$set: {isActive: false}});
  assert.ok([404, 409].includes((await enroll()).status)); assert.equal(await StudentEnrollment.countDocuments(), 0);
});
test('Super Admin requires an explicit target Branch; Principal DB identity changes take effect', async () => {
  assert.equal((await http(path(), admin, body())).status, 400);
  assert.equal((await http(path() + '?branchId=' + branch, admin, body())).status, 200);
  const row = await User.findOne({role: 'principal'}); await User.updateOne({_id: row!._id}, {$set: {branchId: foreign}});
  assert.equal((await detail()).status, 404);
  await User.updateOne({_id: row!._id}, {$set: {branchId: branch, isActive: false}}); assert.equal((await detail()).status, 401);
});
test('duplicate requests replay once and operation reuse rejects a changed payload', async () => {
  const [a,b] = await Promise.all([enroll(), enroll()]); assert.equal(a.status, 200); assert.deepEqual(a.json, b.json);
  assert.equal(await StudentEnrollment.countDocuments(), 1); assert.equal(await EnrollmentOperation.countDocuments(), 1);
  assert.equal((await enroll('different-operation-001')).status, 409);
  assert.equal((await enroll(undefined, {reason: 'Different request'})).status, 409);
});
test('native unique indexes reject conflicting active enrollment without service prechecks', async () => {
  const values = {studentId, branchId: branch, ...target(), status: 'active', effectiveFrom: new Date(), reason: 'Owned fixture', createdBy: teacherId, updatedBy: teacherId};
  const results = await Promise.allSettled([StudentEnrollment.create(values), StudentEnrollment.create(values)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.ok(results.some(r => r.status === 'rejected' && r.reason.code === 11000));
});
test('Section transfer retains old interval and current authority ignores forged compatibility fields', async () => {
  const current = (await enroll()).json.data.enrollment;
  const moved = await change(current.id, 'transfer'); assert.equal(moved.status, 200);
  const data = (await detail()).json.data; assert.equal(data.history.length, 2); assert.equal(data.current.section.id, otherSectionId); assert.equal(data.history.find((r: any) => r.id === current.id).status, 'transferred');
  await Student.collection.updateOne({_id: new mongoose.Types.ObjectId(studentId)}, {$set: {sectionId: new mongoose.Types.ObjectId(sectionId)}});
  assert.equal((await Student.aggregate(enrollmentMembership(branch, classId, sectionId))).length, 0);
  assert.equal((await Student.aggregate(enrollmentMembership(branch, classId, otherSectionId))).length, 1);
  assert.equal((await resolveAcademicWorkRecipients(branch, {classId, sectionId})).length, 0);
  assert.equal((await resolveAcademicWorkRecipients(branch, {classId, sectionId: otherSectionId})).length, 1);
});
test('foreign/guessed enrollment mutation IDs are concealed; stale own membership conflicts', async () => {
  const current = (await enroll()).json.data.enrollment;
  assert.equal((await change(String(new mongoose.Types.ObjectId()), 'transfer')).status, 404);
  assert.equal((await change(current.id, 'transfer', {revision: 9})).status, 409);
  assert.equal((await change(current.id, 'transfer', {sectionId})).status, 409);
  assert.equal((await http(path() + '/' + current.id, principal, {}, 'DELETE')).status, 404);
});
test('promotion creates next-period membership, preserves old identity and leaves academic/finance collections untouched', async () => {
  const current = (await enroll()).json.data.enrollment; const next = await nextPeriod();
  for (const name of ['academicresults', 'homeworksubmissions', 'catchupitems', 'payments', 'invoices']) await mongoose.connection.collection(name).insertOne({studentId: new mongoose.Types.ObjectId(studentId), marker: 'retain'});
  const retainedBefore = await Promise.all(['academicresults', 'homeworksubmissions', 'catchupitems', 'payments', 'invoices'].map(name => mongoose.connection.collection(name).find().toArray()));
  assert.equal((await change(current.id, 'promote', next)).status, 200);
  const data = (await detail()).json.data; assert.equal(data.history.length, 2); assert.equal(data.current.period.id, next.academicPeriodId); assert.equal(data.history.find((r: any) => r.id === current.id).status, 'promoted'); assert.equal(await Student.countDocuments(), 1);
  const afterRows = await Promise.all(['academicresults', 'homeworksubmissions', 'catchupitems', 'payments', 'invoices'].map(name => mongoose.connection.collection(name).find().toArray())); assert.deepEqual(afterRows, retainedBefore);
});
test('withdrawal excludes future audiences without deleting identity/history; readmission creates a fresh record', async () => {
  const current = (await enroll()).json.data.enrollment; assert.equal((await change(current.id, 'withdraw')).status, 200);
  const data = (await detail()).json.data; assert.equal(data.current, null); assert.equal(data.history[0].status, 'withdrawn'); assert.equal((await Student.findById(studentId))!.isActive, true);
  assert.equal((await resolveAcademicWorkRecipients(branch, {classId, sectionId})).length, 0);
  assert.equal((await enroll('readmission-operation-001')).status, 200); assert.equal(await StudentEnrollment.countDocuments(), 2);
});
test('effective attendance membership resolves historical interval after transfer', async () => {
  const current = (await enroll()).json.data.enrollment;
  await StudentEnrollment.collection.updateOne({_id: new mongoose.Types.ObjectId(current.id)}, {$set: {effectiveFrom: new Date('2020-01-01')}});
  await change(current.id, 'transfer');
  assert.equal((await Student.aggregate(enrollmentMembership(branch, classId, sectionId, '2025-01-01'))).length, 1);
  assert.equal((await Student.aggregate(enrollmentMembership(branch, classId, otherSectionId, '2025-01-01'))).length, 0);
});
test('Class and Section lifecycle guards reject active managed enrollment even if compatibility fields drift', async () => {
  await enroll(); await Student.collection.updateOne({_id: new mongoose.Types.ObjectId(studentId)}, {$set: {classId: new mongoose.Types.ObjectId(), sectionId: new mongoose.Types.ObjectId()}});
  for (const [kind,id] of [['classes',classId],['sections',sectionId]]) {const result = await http('/academic-setup/' + kind + '/' + id + '/deactivate', principal, {revision: 1}); assert.equal(result.status, 409); assert.ok(result.json.message.includes('Student Enrollments'));}
});
test('bounded list/search/status and options expose only Branch-owned summaries', async () => {
  await enroll(); const list = await http('/students?search=A-100&status=active', principal); assert.equal(list.status, 200); assert.equal(list.json.data.total, 1);
  assert.equal((await http('/students?search=missing', principal)).json.data.total, 0);
  const options = await http('/students/enrollment-options?classId=' + classId, principal); assert.equal(options.json.data.sections.length, 2);
  assert.equal((await http('/students?offset=-1', principal)).status, 400);
});

for (const scenario of ['enrollment', 'transfer', 'promotion', 'withdrawal-promotion', 'section-enrollment', 'class-promotion', 'section-transfer', 'transfer-promotion', 'withdrawal-transfer', 'section-promotion', 'class-enrollment'] as const) for (const reversed of [false, true]) {
  test('two API processes: ' + scenario + (reversed ? ' reverse ordering' : ' forward ordering'), {timeout: 25000}, async () => {
    let firstPath = path(), secondPath = path(), firstBody: any = body('race-operation-first-001'), secondBody: any = body('race-operation-second-001');
    let current: any;
    if (scenario !== 'enrollment' && scenario !== 'section-enrollment' && scenario !== 'class-enrollment') current = (await enroll()).json.data.enrollment;
    if (scenario === 'transfer' || scenario === 'section-transfer' || scenario === 'withdrawal-transfer') {firstPath += '/' + current.id + '/transfer'; secondPath = firstPath; firstBody = body('race-transfer-first-001', {revision: 1, sectionId: otherSectionId}); secondBody = body('race-transfer-second-001', {revision: 1, sectionId: otherSectionId});}
    if (scenario === 'transfer') {const alternative = await new Section({branchId: branch, classId, name: 'C', code: 'C'}).save(); secondBody.sectionId = String(alternative._id);}
    if (scenario === 'withdrawal-transfer') {secondPath = path() + '/' + current.id + '/withdraw'; secondBody = {operationId: 'race-withdraw-transfer-001', revision: 1, reason: 'Withdraw instead of transfer'};}
    if (['promotion', 'withdrawal-promotion', 'class-promotion', 'transfer-promotion', 'section-promotion'].includes(scenario)) {
      const next = await nextPeriod(); firstPath += '/' + current.id + '/promote'; secondPath = firstPath; firstBody = body('race-promotion-first-001', {revision: 1, ...next}); secondBody = body('race-promotion-second-001', {revision: 1, ...next});
      if (scenario === 'promotion') {const cls = await new SchoolClass({branchId: branch, academicPeriodId: next.academicPeriodId, academicYear: 'NEXT', name: 'Alternative Class', code: 'ALT'}).save(); const sec = await new Section({branchId: branch, classId: cls._id, name: 'A', code: 'A'}).save(); secondBody.classId = String(cls._id); secondBody.sectionId = String(sec._id);}
      if (scenario === 'section-promotion') {secondPath = '/academic-setup/sections/' + next.sectionId + '/deactivate'; secondBody = {revision: 1};}
      if (scenario === 'withdrawal-promotion') {secondPath = path() + '/' + current.id + '/withdraw'; secondBody = {operationId: 'race-withdrawal-operation-001', revision: 1, reason: 'Withdraw instead of promotion'};}
      if (scenario === 'class-promotion') {secondPath = '/academic-setup/classes/' + next.classId + '/deactivate'; secondBody = {revision: 1};}
    }
    if (scenario === 'transfer-promotion') {secondPath = path() + '/' + current.id + '/transfer'; secondBody = body('race-transfer-old-period-001', {revision: 1, sectionId: otherSectionId});}
    if (scenario === 'section-transfer') {secondPath = '/academic-setup/sections/' + otherSectionId + '/deactivate'; secondBody = {revision: 1};}
    if (scenario === 'class-enrollment') {secondPath = '/academic-setup/classes/' + classId + '/deactivate'; secondBody = {revision: 1};}
    if (scenario === 'section-enrollment') {firstBody.sectionId = otherSectionId; secondPath = '/academic-setup/sections/' + otherSectionId + '/deactivate'; secondBody = {revision: 1};}
    if (reversed) {[firstPath,secondPath] = [secondPath,firstPath]; [firstBody,secondBody] = [secondBody,firstBody];}
    const original = Branch.collection.updateOne; let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(done => {entered = done;}); const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {const result = await original.apply(this, args); entered(); await gate; return result;} as typeof original;
    let arrived!: (value: any) => void; const contender = new Promise<void>(done => {arrived = value => {if(value.type === 'fence') done();}; worker.on('message', arrived);});
    try {
      const first = http(firstPath, principal, firstBody); await acquired; const second = http(secondPath, principal, secondBody, 'POST', workerBase); await contender; release();
      const [a,b] = await Promise.all([first,second]);
      if (scenario === 'class-promotion' || scenario === 'transfer-promotion' || scenario === 'class-enrollment') assert.deepEqual([a.status,b.status], reversed ? [409,200] : [200,409]);
      else if (['section-enrollment', 'section-transfer', 'section-promotion'].includes(scenario) && reversed) assert.deepEqual([a.status,b.status], [200,404]);
      else assert.deepEqual([a.status,b.status], [200,409]);
      const active = await StudentEnrollment.find({studentId, status: 'active'}).lean(); assert.ok(active.length <= 1);
      for(const row of active) {assert.ok(await SchoolClass.exists({isActive:true}).where('_id').equals(row.classId)); assert.ok(await Section.exists({isActive:true}).where('_id').equals(row.sectionId));}
      if(scenario === 'transfer' || scenario === 'promotion') assert.equal(await StudentEnrollment.countDocuments({studentId}), 2);
    } finally {release(); worker.removeListener('message', arrived); Branch.collection.updateOne = original;}
  });
}

test('promotion and withdrawal retain real Student portal work, submissions, results, catch-up and submitted attendance', async () => {
  const enrollment = (await enroll()).json.data.enrollment;
  const pupil = await Student.findById(studentId); const userId = String(pupil!.userId);
  const oid = () => new mongoose.Types.ObjectId();
  const day = schoolToday();
  const version = await TimetableVersion.create({branchId: branch, versionNumber: 1, effectiveFrom: day, effectiveUntil: addScheduleDays(day, 30), periodCount: 1, status: 'approved', createdBy: teacherId});
  const period = await TimetablePeriod.create({branchId: branch, timetableVersionId: version._id, teacherId, classId, sectionId, subjectId, dayOfWeek: scheduleWeekday(day), startTime: '08:00', endTime: '09:00', room: '101'});
  await TeacherAssignment.create({teacherId, branchId: branch, classId, sectionId, subjectId, validFrom: new Date('2020-01-01'), createdBy: teacherId, updatedBy: teacherId});
  const attendance = await AttendanceSession.create({branchId: branch, periodId: period._id, timetableVersionId: version._id, date: day, classId, sectionId, subjectId, responsibleTeacherId: teacherId, rosterVersion: 'published-fixture', rosterStudentIds: [studentId], state: 'submitted', revision: 1});
  const record = await PeriodAttendanceRecord.create({branchId: branch, attendanceSessionId: attendance._id, studentId, status: 'absent', markedBy: teacherId, markedAt: new Date(), revision: 1});
  const common = {branchId: branch, teacherId, classId, sectionId, subjectId, academicYear: 'CURRENT', syllabusId: oid(), syllabusVersion: 1, lessonPlanId: oid(), lessonPlanRevision: 1, topicIds: [oid()], title: 'Historic practice', instructions: 'Answer the question', status: 'published', revision: 1, publishedRevision: 1, publishedAt: new Date(), createFingerprint: 'owned-fixture'};
  const homework = await Homework.create({...common, createOperationId: 'history-homework-fixture-001', dueAt: addScheduleDays(day, 30), latePolicy: 'closed_after_due_date'});
  const quiz = await Quiz.create({...common, createOperationId: 'history-quiz-fixture-001', availableFrom: day, availableUntil: addScheduleDays(day, 30), attemptLimit: 1, timeLimitMinutes: 30, shuffleQuestions: false, questions: [{questionId: 'q1', type: 'true_false', text: 'Two is even?', correctBoolean: true}]});
  for(const [workType, workId] of [['homework', homework._id], ['quiz', quiz._id]] as const) await AcademicWorkAudience.create({branchId: branch, workType, workId, publishedRevision: 1, studentId, recipientUserId: userId, admissionNumber: 'A-100', studentName: 'Student', entitledAt: new Date()});
  const submission = await http('/student/evidence/homework/' + homework._id + '/submit', studentToken, {clientOperationId: 'enrollment-homework-submit-001', content: 'Original evidence'}); assert.equal(submission.status, 200);
  const resultId = oid();
  await AcademicResult.collection.insertOne({_id: resultId, branchId: new mongoose.Types.ObjectId(branch), studentId: new mongoose.Types.ObjectId(studentId), recipientUserId: new mongoose.Types.ObjectId(userId), classId: new mongoose.Types.ObjectId(classId), sectionId: new mongoose.Types.ObjectId(sectionId), subjectId: new mongoose.Types.ObjectId(subjectId), status: 'published', sourceReviewId: oid(), assessmentSourceType: 'homework_submission', assessmentTitle: 'Published historic marks', sourcePublishedRevision: 1, currentRevision: 1, revisions: [{revision: 1, awardedMarks: 8, maxMarks: 10}], publishedAt: new Date()});
  const catchUp = await CatchUpItem.create({branchId: branch, studentId, recipientUserId: userId, classId, sectionId, subjectId, attendanceSessionId: attendance._id, attendanceRecordId: record._id, originalAttendanceStatus: 'absent', effectiveAbsenceVersion: 0, occurrenceId: period._id, occurrenceDate: day, timetableVersionId: version._id, assignedAt: new Date(), dueAt: addScheduleDays(day, 30), status: 'pending', sourceFingerprint: 'owned-fixture'});
  const resultsBefore = await AcademicResult.collection.findOne({_id: resultId});
  const catchUpBefore = await CatchUpItem.findById(catchUp._id).lean();
  const next = await nextPeriod(); const promoted = await change(enrollment.id, 'promote', next); assert.equal(promoted.status, 200);
  const assertHistory = async () => {
    const work = await http('/student/academic-work', studentToken); assert.equal(work.status, 200); assert.equal(work.json.data.length, 2);
    assert.equal((await http('/student/evidence/homework/' + homework._id, studentToken)).status, 200);
    const result = await http('/student/results/' + resultId, studentToken); assert.equal(result.status, 200); assert.equal(result.json.data.awardedMarks, 8);
    const catchup = await http('/student/catch-ups/' + catchUp._id, studentToken); assert.equal(catchup.status, 200); assert.equal(catchup.json.data.academic.classId, classId);
    const priorAttendance = await http('/teacher/attendance/sessions/' + attendance._id, teacher); assert.equal(priorAttendance.status, 200); assert.equal(priorAttendance.json.data.students[0].studentId, studentId); assert.equal(priorAttendance.json.data.students[0].status, 'absent');
    assert.deepEqual(await AcademicResult.collection.findOne({_id: resultId}), resultsBefore);
    assert.deepEqual(await CatchUpItem.findById(catchUp._id).lean(), catchUpBefore);
    assert.equal(await HomeworkSubmission.countDocuments(), 1);
  };
  await assertHistory();
  const attempt = await http('/student/evidence/quiz/' + quiz._id + '/attempts/start', studentToken, {clientOperationId: 'enrollment-history-quiz-start'}); assert.equal(attempt.status, 200);
  assert.equal((await change(promoted.json.data.enrollment.id, 'withdraw')).status, 200);
  await assertHistory();
  const roster = await http('/teacher/classes/' + classId + '/sections/' + sectionId + '/subjects/' + subjectId + '/students', teacher); assert.equal(roster.status, 200); assert.equal(roster.json.data.students.length, 0);
});

test('transaction failure after source closure rolls back enrollment, projection and retry receipt', async () => {
  const current = (await enroll()).json.data.enrollment;
  const original = StudentEnrollment.create;
  StudentEnrollment.create = async () => {throw new Error('private storage failure');};
  try {
    const result = await change(current.id, 'transfer'); assert.equal(result.status, 500); assert.equal(JSON.stringify(result.json).includes('private storage'), false);
  } finally {StudentEnrollment.create = original;}
  assert.equal((await currentEnrollmentForTest())!.status, 'active');
  assert.equal(String((await Student.findById(studentId))!.sectionId), sectionId);
  assert.equal(await StudentEnrollment.countDocuments({studentId}), 1);
  assert.equal(await EnrollmentOperation.countDocuments({studentId}), 1);
});
const currentEnrollmentForTest = () => StudentEnrollment.findOne({studentId, status: 'active'}).lean();
test('retry receipts are actor-scoped and current sessions are required', async () => {
  await enroll(); const peer = await actor('principal', branch);
  assert.equal((await http(path(), peer.token, body())).status, 409);
  const sessionModel = mongoose.models.Session;
  await sessionModel.updateMany({token: principal}, {$set: {isRevoked: true}});
  assert.equal((await detail()).status, 401);
});

test('actual Fee documents and Branch outstanding balance survive promotion and withdrawal', async () => {
  const current = (await enroll()).json.data.enrollment;
  const fee = await Fee.create({branchId: branch, studentId, academicYear: 'CURRENT', invoiceNumber: 'OWNED-FEE-001', amount: 1000, paidAmount: 100, dueDate: new Date('2026-09-01'), status: 'partial'});
  const original = await Fee.findById(fee._id).lean(); const summary = await getBranchFeeSummary(branch);
  const next = await nextPeriod(); const promoted = await change(current.id, 'promote', next); assert.equal(promoted.status, 200);
  assert.equal((await change(promoted.json.data.enrollment.id, 'withdraw')).status, 200);
  assert.deepEqual(await Fee.findById(fee._id).lean(), original);
  assert.deepEqual(await getBranchFeeSummary(branch), summary); assert.equal(summary.outstandingAmount, 900);
  assert.equal(await Fee.countDocuments({studentId}), 1);
});

test('model rejects contradictory lifecycle intervals and future scheduling', async () => {
  const baseRow = {studentId, branchId: branch, ...target(), reason: 'Owned interval fixture', createdBy: teacherId, updatedBy: teacherId, effectiveFrom: new Date('2020-01-01')};
  for (const extra of [{effectiveTo: new Date()}, {effectiveFrom: new Date(Date.now() + 86400000)}, {status: 'withdrawn'}, {status: 'transferred', effectiveTo: new Date('2019-01-01')}]) await assert.rejects(StudentEnrollment.create({...baseRow, ...extra}), /Enrollment/);
  assert.equal(await StudentEnrollment.countDocuments(), 0);
});
for (const corruption of ['future-start', 'ended-active', 'missing-start'] as const) test('current detail/list/roster/audience consistently reject native ' + corruption + ' corruption', async () => {
  const current = (await enroll()).json.data.enrollment;
  const changeTo = corruption === 'future-start' ? {$set: {effectiveFrom: new Date(Date.now() + 86400000)}} : corruption === 'ended-active' ? {$set: {effectiveTo: new Date()}} : {$unset: {effectiveFrom: ''}};
  await StudentEnrollment.collection.updateOne({_id: new mongoose.Types.ObjectId(current.id)}, changeTo);
  // Current resolution must fail closed without resurrecting the legacy snapshot.
  assert.equal((await detail()).status, 409);
  const list = await http('/students?status=active', principal); assert.equal(list.json.data.total, 0);
  assert.equal((await Student.aggregate(enrollmentMembership(branch, classId, sectionId))).length, 0);
  assert.equal((await resolveAcademicWorkRecipients(branch, {classId, sectionId})).length, 0);
  assert.equal((await change(current.id, 'transfer')).status, 409);
});
test('same-period Class transfer and cross-Branch lifecycle targets are rejected', async () => {
  const current = (await enroll()).json.data.enrollment;
  const other = await new SchoolClass({branchId: branch, academicPeriodId: periodId, academicYear: 'CURRENT', name: 'Another Class', code: 'AC'}).save();
  const otherSection = await new Section({branchId: branch, classId: other._id, name: 'A', code: 'A'}).save();
  assert.equal((await change(current.id, 'transfer', {classId: String(other._id), sectionId: String(otherSection._id)})).status, 409);
  const owner = (await User.findOne({role: 'super_admin'}))!._id;
  const foreignPeriod = await AcademicPeriod.create({branchId: foreign, name: 'Foreign period', code: 'F', startDate: '2027-08-01', endDate: '2028-07-31', status: 'active', createdBy: owner, updatedBy: owner});
  const foreignClass = await new SchoolClass({branchId: foreign, academicPeriodId: foreignPeriod._id, academicYear: 'F', name: 'Foreign Class', code: 'F'}).save();
  const foreignSection = await new Section({branchId: foreign, classId: foreignClass._id, name: 'F', code: 'F'}).save();
  const foreignTarget = {academicPeriodId: String(foreignPeriod._id), classId: String(foreignClass._id), sectionId: String(foreignSection._id)};
  for (const action of ['transfer', 'promote']) assert.equal((await change(current.id, action, foreignTarget)).status, 404);
  assert.equal((await change(current.id, 'withdraw', {branchId: foreign})).status, 400);
  assert.equal((await http(path() + '/' + current.id + '/withdraw?branchId=' + foreign, principal, {revision: 1, reason: 'Foreign attempt', operationId: 'foreign-withdrawal-operation'})).status, 404);
});
test('readmission and all lifecycle receipts safely replay and reject changed payloads', async () => {
  const first = (await enroll()).json.data.enrollment;
  const transferred = await change(first.id, 'transfer'); assert.equal(transferred.status, 200);
  assert.deepEqual((await change(first.id, 'transfer')).json, transferred.json);
  assert.equal((await change(first.id, 'transfer', {reason: 'Changed replay'})).status, 409);
  const next = await nextPeriod(); const promoted = await change(transferred.json.data.enrollment.id, 'promote', next); assert.equal(promoted.status, 200);
  assert.deepEqual((await change(transferred.json.data.enrollment.id, 'promote', next)).json, promoted.json);
  assert.equal((await change(transferred.json.data.enrollment.id, 'promote', {...next, reason: 'Changed replay'})).status, 409);
  const withdrawn = await change(promoted.json.data.enrollment.id, 'withdraw'); assert.equal(withdrawn.status, 200);
  assert.deepEqual((await change(promoted.json.data.enrollment.id, 'withdraw')).json, withdrawn.json);
  assert.equal((await change(promoted.json.data.enrollment.id, 'withdraw', {reason: 'Changed replay'})).status, 409);
  const a = await enroll('readmission-retry-operation', next), b = await enroll('readmission-retry-operation', next);
  assert.equal(a.status, 200); assert.deepEqual(a.json,b.json); assert.equal((await enroll('readmission-retry-operation', {...next, reason: 'Changed replay'})).status, 409);
  assert.equal(await StudentEnrollment.countDocuments({studentId}), 4); assert.equal(await StudentEnrollment.countDocuments({studentId, status: 'active'}), 1);
});
test('actual Teacher roster reflects transfer-in/out and ignores forged compatibility fields', async () => {
  const current = (await enroll()).json.data.enrollment;
  for (const sec of [sectionId, otherSectionId]) await TeacherAssignment.create({teacherId, branchId: branch, classId, sectionId: sec, subjectId, validFrom: new Date('2020-01-01'), createdBy: teacherId, updatedBy: teacherId});
  const roster = (sec: string) => http('/teacher/classes/' + classId + '/sections/' + sec + '/subjects/' + subjectId + '/students', teacher);
  assert.equal((await roster(sectionId)).json.data.students.length, 1); assert.equal((await roster(otherSectionId)).json.data.students.length, 0);
  assert.equal((await change(current.id, 'transfer')).status, 200);
  await Student.collection.updateOne({_id: new mongoose.Types.ObjectId(studentId)}, {$set: {sectionId: new mongoose.Types.ObjectId(sectionId)}});
  assert.equal((await roster(sectionId)).json.data.students.length, 0); assert.equal((await roster(otherSectionId)).json.data.students.length, 1);
});
