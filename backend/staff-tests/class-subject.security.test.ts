import Room from '../src/staff/src/models/room';
import {Syllabus} from '../src/staff/src/models/syllabus';
import {schoolToday, addScheduleDays, scheduleWeekday} from '../src/staff/src/services/school-date.service';
import {TimetablePeriod, TimetableVersion} from '../src/staff/src/models/timetable';
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
import {PERMISSIONS} from '../src/staff/src/constants/permissions';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ensureAcademicSetupIndexes, type SetupKind} from '../src/staff/src/services/academic-setup.service';

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
const setup = (kind: SetupKind, suffix = '', token = principal, body?: unknown, method?: string) => http(`/academic-setup/${kind}${suffix}`, token, body, method);
const assignment = () => http('/teacher-assignments', principal, {teacherId, classId, sectionId, subjectId, validFrom: '2026-01-01T00:00:00Z'});
const deactivate = (kind: SetupKind, id: string) => setup(kind, `/${id}/deactivate`, principal, {revision: 1});
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
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
const curriculum = (suffix = '', token = principal, body?: unknown, method?: string) => http('/academic-setup/classes/' + classId + '/subjects' + suffix, token, body, method);
const mapSubject = (id = subjectId) => curriculum('', principal, {subjectId: id});
const mappingAction = (id: string, action: string, revision = 1) => curriculum('/' + id + '/' + action, principal, {revision});
const syllabusInput = () => ({classId, subjectId, version: 1, title: 'Mapped syllabus', units: [{title: 'Unit', topics: [{title: 'Topic'}]}]});
const day = () => schoolToday();
let fixtureRoomId: string;
const scheduleInput = () => ({branchId: branch, versionNumber: 1, effectiveFrom: day(), effectiveUntil: addScheduleDays(day(), 30), periods: [{teacherId, classId, sectionId, subjectId, dayOfWeek: scheduleWeekday(day()), startTime: '08:00', endTime: '09:00', roomId: fixtureRoomId, room: '101'}]});
const retainedAssignment = () => TeacherAssignment.create({teacherId, branchId: branch, classId, sectionId, subjectId, validFrom: new Date('2020-01-01'), createdBy: teacherId, updatedBy: teacherId});

test('mapping auth and role policy are enforced by API and service permissions', async () => {
  assert.equal((await http('/academic-setup/classes/' + classId + '/subjects')).status, 401);
  assert.equal((await curriculum('', teacher)).status, 403);
  assert.equal((await curriculum('', teacher, {subjectId})).status, 403);
  ROLE_PERMISSIONS.principal = principalGrants.filter(p => p !== PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_MANAGE);
  assert.equal((await mapSubject()).status, 403);
  ROLE_PERMISSIONS.principal = principalGrants.filter(p => p !== PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_VIEW);
  assert.equal((await curriculum()).status, 403);
});
test('Principal creates exact period/Class/Subject identity; DTO exposes safe summaries only', async () => {
  const result = await mapSubject(); assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.json.data).sort(), ['class', 'period', 'id', 'subject', 'isActive', 'revision'].sort());
  assert.equal(result.json.data.class.id, classId); assert.equal(result.json.data.period.id, periodId);
  const row = await ClassSubject.findById(result.json.data.id).lean(); assert.ok(row);
  assert.equal(String(row.branchId), branch); assert.equal(String(row.academicPeriodId), periodId);
  assert.equal((await curriculum()).json.data.items.length, 1);
  assert.equal(JSON.stringify(result.json).includes('createdBy'), false);
});
test('foreign Branch/Class/Subject/period and injected authority cannot establish a mapping', async () => {
  const foreignClass = await new SchoolClass({branchId: foreign, academicPeriodId: periodId, academicYear: 'CURRENT', name: 'Foreign', code: 'F'}).save();
  const foreignSubject = await Subject.create({branchId: foreign, name: 'Foreign'});
  assert.equal((await curriculum('?branchId=' + foreign, principal, {subjectId})).status, 404);
  assert.equal((await http('/academic-setup/classes/' + foreignClass._id + '/subjects', principal, {subjectId})).status, 404);
  assert.equal((await mapSubject(String(foreignSubject._id))).status, 404);
  for (const suffix of ['', '/options']) {
    assert.equal((await curriculum(suffix + '?branchId=' + foreign)).status, 404);
    assert.equal((await http('/academic-setup/classes/' + foreignClass._id + '/subjects' + suffix, principal)).status, 404);
  }
  for (const forged of [{branchId: foreign}, {academicPeriodId: periodId}, {academicYear: 'FORGED'}, {classId: String(foreignClass._id)}]) assert.equal((await curriculum('', principal, {subjectId, ...forged})).status, 400);
  await AcademicPeriod.collection.updateOne({_id: new mongoose.Types.ObjectId(periodId)}, {$set: {branchId: new mongoose.Types.ObjectId(foreign)}});
  assert.equal((await mapSubject()).status, 404);
});
test('Super Admin can manage an explicit target Branch without widening Principal scope', async () => {
  assert.equal((await curriculum('?branchId=' + branch, admin, {subjectId})).status, 201);
  assert.equal((await curriculum('', admin, {subjectId})).status, 400);
});
test('inactive Class, Subject and non-active period reject new mappings', async () => {
  await Subject.updateOne({_id: subjectId}, {$set: {isActive: false}}); assert.equal((await mapSubject()).status, 404);
  await Subject.updateOne({_id: subjectId}, {$set: {isActive: true}});
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$set: {isActive: false}}); assert.equal((await mapSubject()).status, 409);
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$set: {isActive: true}});
  for (const status of ['draft', 'closed', 'archived']) {await AcademicPeriod.updateOne({_id: periodId}, {$set: {status}}); assert.equal((await mapSubject()).status, 409);}
});
test('duplicate and concurrent duplicate mapping have one identity and deterministic 409', async () => {
  const results = await Promise.all([mapSubject(), mapSubject()]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await ClassSubject.countDocuments(), 1); assert.equal((await mapSubject()).status, 409);
  const indexes = await ClassSubject.collection.indexes(); assert.ok(indexes.some(index => index.name === 'unique_class_subject_identity' && index.unique));
});
test('database unique index also rejects duplicate writers without the service fence', async () => {
  const actorId = (await User.findOne({role: 'super_admin'}))!._id;
  const values = {branchId: branch, academicPeriodId: periodId, classId, subjectId, createdBy: actorId, updatedBy: actorId};
  const results = await Promise.allSettled([ClassSubject.create(values), ClassSubject.create(values)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.some(result => result.status === 'rejected' && result.reason.code === 11000));
});
test('safe deactivation retains history, stale revision fails, reactivation reuses identity', async () => {
  const row = (await mapSubject()).json.data;
  assert.equal((await mappingAction(row.id, 'deactivate')).status, 200);
  const history = (await curriculum()).json.data.items; assert.equal(history.length, 1); assert.equal(history[0].isActive, false);
  assert.equal((await mappingAction(row.id, 'reactivate')).status, 409);
  assert.equal((await mappingAction(row.id, 'reactivate', 2)).status, 200);
  assert.equal(await ClassSubject.countDocuments(), 1);
  assert.equal((await http('/academic-setup/classes/' + classId + '/subjects/' + row.id, principal, undefined, 'DELETE')).status, 404);
});
test('options exclude foreign, inactive and previously mapped Subjects; inactive rows use reactivation', async () => {
  const a = await Subject.create({branchId: branch, name: 'Science'});
  await Subject.create({branchId: branch, name: 'Inactive', isActive: false}); await Subject.create({branchId: foreign, name: 'Foreign'});
  const mapped = (await mapSubject()).json.data;
  assert.deepEqual((await curriculum('/options')).json.data.items.map((row: any) => row.name), ['Science']);
  await mappingAction(mapped.id, 'deactivate');
  assert.deepEqual((await curriculum('/options')).json.data.items.map((row: any) => row.id), [String(a._id)]);
});
test('new TeacherAssignment requires exact active mapping; legacy assignment reads do not', async () => {
  assert.equal((await assignment()).status, 409);
  const legacy = await retainedAssignment();
  assert.equal((await http('/teacher/classes', teacher)).json.data.length, 1);
  await TeacherAssignment.updateOne({_id: legacy._id}, {$set: {isActive: false}});
  const mapping = (await mapSubject()).json.data;
  assert.equal((await assignment()).status, 201);
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 409);
  await TeacherAssignment.updateMany({}, {$set: {isActive: false}});
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 200);
  assert.equal((await assignment()).status, 409);
  assert.equal((await http('/teacher-assignments/teachers/' + teacherId, principal)).status, 200);
});
test('mapping for another Class or foreign Branch is insufficient', async () => {
  const owner = (await User.findOne({role: 'super_admin'}))!._id;
  for (const extra of [{classId: new mongoose.Types.ObjectId()}, {branchId: new mongoose.Types.ObjectId(foreign)}, {academicPeriodId: new mongoose.Types.ObjectId()}]) {
    await ClassSubject.deleteMany({});
    await ClassSubject.create({branchId: branch, academicPeriodId: periodId, classId, subjectId, createdBy: owner, updatedBy: owner, ...extra});
    assert.equal((await assignment()).status, 409);
    assert.equal((await http('/syllabuses', admin, syllabusInput())).status, 409);
  }
});
test('active mapping blocks parent Subject deactivation', async () => {
  await mapSubject(); assert.equal((await deactivate('subjects', subjectId)).status, 409);
});
test('new timetable requires mapping even for a legacy assignment; approval rechecks it', async () => {
  await retainedAssignment(); assert.equal((await http('/timetables/versions', principal, scheduleInput())).status, 409);
  await mapSubject(); const version = await http('/timetables/versions', principal, scheduleInput()); assert.equal(version.status, 201);
  await ClassSubject.updateMany({}, {$set: {isActive: false}}); // simulate pre-existing/imported inconsistency
  assert.equal((await http('/timetables/versions/' + version.json.data.versionId + '/approve', principal, {})).status, 409);
  assert.equal((await http('/timetables/versions', principal, {...scheduleInput(), versionNumber: 2})).status, 409);
});
test('approved timetable history remains readable without retroactive mapping requirements', async () => {
  await retainedAssignment(); await mapSubject(); const version = await http('/timetables/versions', principal, scheduleInput());
  assert.equal((await http('/timetables/versions/' + version.json.data.versionId + '/approve', principal, {})).status, 200);
  await ClassSubject.updateMany({}, {$set: {isActive: false}});
  const visible = await http('/teacher/timetable?date=' + day(), teacher); assert.equal(visible.status, 200);
  assert.ok(JSON.stringify(visible.json).includes('08:00'));
});
test('published Syllabus blocks deactivation; retired history remains readable', async () => {
  assert.equal((await http('/syllabuses', admin, syllabusInput())).status, 409);
  const mapping = (await mapSubject()).json.data;
  const created = await http('/syllabuses', admin, syllabusInput()); assert.equal(created.status, 200);
  const id = created.json.data.syllabusId;
  assert.equal(created.json.data.academicYear, 'CURRENT');
  assert.equal((await http('/syllabuses/' + id + '/publish', admin, {revision: 1})).status, 200);
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 409);
  assert.equal((await http('/syllabuses/' + id + '/retire', admin, {revision: 2})).status, 200);
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 200);
  assert.equal((await http('/syllabuses/' + id, admin)).status, 200);
  assert.equal((await http('/syllabuses', admin, {...syllabusInput(), version: 2})).status, 409);
});
test('draft syllabus update/publication rechecks inactive mapping; retirement remains available', async () => {
  const mapping = (await mapSubject()).json.data;
  const created = await http('/syllabuses', admin, syllabusInput()); const id = created.json.data.syllabusId;
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 200);
  assert.equal((await http('/syllabuses/' + id + '/publish', admin, {revision: 1})).status, 409);
  assert.equal((await http('/syllabuses/' + id, admin, {title: 'Changed', units: syllabusInput().units, revision: 1}, 'PATCH')).status, 409);
});
test('current/future approved timetable independently guards mapping after assignment revocation', async () => {
  const mapping = (await mapSubject()).json.data;
  await retainedAssignment(); const version = await http('/timetables/versions', principal, scheduleInput());
  await http('/timetables/versions/' + version.json.data.versionId + '/approve', principal, {});
  await TeacherAssignment.updateMany({}, {$set: {isActive: false}});
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 409);
  assert.equal((await http('/timetables/versions/' + version.json.data.versionId + '/retire', principal, {})).status, 200);
  assert.equal((await mappingAction(mapping.id, 'deactivate')).status, 200);
  assert.equal(await TimetablePeriod.countDocuments(), 1);
});
test('legacy Class without authoritative period cannot receive new mapping or assignment', async () => {
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$unset: {academicPeriodId: ''}});
  assert.equal((await curriculum()).status, 200); assert.equal((await mapSubject()).status, 409); assert.equal((await assignment()).status, 409);
});
for (const winner of ['assignment', 'deactivation'] as const) {
  test('two Node processes: mapping vs assignment, ' + winner + ' first', {timeout: 20000}, async () => {
    const mapping = (await mapSubject()).json.data;
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(done => {entered = done;}); const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {const result = await original.apply(this, args); entered(); await gate; return result; } as typeof original;
    let arrived!: (value: any) => void;
    const competing = new Promise<void>(done => {arrived = value => {if (value.type === 'fence') done();};worker.on('message', arrived);});
    try {
      const first = winner === 'assignment' ? assignment() : mappingAction(mapping.id, 'deactivate'); await acquired;
      const second = winner === 'assignment' ? http('/academic-setup/classes/' + classId + '/subjects/' + mapping.id + '/deactivate', principal, {revision: 1}, 'POST', workerBase) : http('/teacher-assignments', principal, {teacherId, classId, sectionId, subjectId, validFrom: '2026-01-01T00:00:00Z'}, 'POST', workerBase);
      await competing; release(); const [a,b] = await Promise.all([first,second]);
      assert.deepEqual([a.status,b.status], winner === 'assignment' ? [201,409] : [200,409]);
      assert.equal(await TeacherAssignment.countDocuments({isActive: true}), winner === 'assignment' ? 1 : 0);
      assert.equal((await ClassSubject.findById(mapping.id))!.isActive, winner === 'assignment');
    } finally {release();worker.removeListener('message',arrived);Branch.collection.updateOne=original;}
  });
}
test('current Principal Branch, inactive account and changed role cannot retain curriculum authority', async () => {
  const principalRow = await User.findOne({role: 'principal'}); assert.ok(principalRow);
  await User.updateOne({_id: principalRow._id}, {$set: {branchId: foreign}});
  assert.equal((await mapSubject()).status, 404);
  await User.updateOne({_id: principalRow._id}, {$set: {branchId: branch, isActive: false}});
  assert.equal((await mapSubject()).status, 401);
  await User.updateOne({_id: principalRow._id}, {$set: {isActive: true, role: 'teacher'}});
  assert.equal((await mapSubject()).status, 401);
});
test('legacy published Syllabus remains readable without a mapping or period migration', async () => {
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$unset: {academicPeriodId: ''}});
  const row = await Syllabus.create({...syllabusInput(), units: [{title: 'Unit', order: 1, topics: [{title: 'Topic', order: 1}]}], branchId: branch, academicYear: 'CURRENT', status: 'published', createdBy: teacherId, updatedBy: teacherId});
  assert.equal((await http('/syllabuses/' + row._id, admin)).status, 200);
});
for (const winner of ['publication', 'deactivation'] as const) {
  test('two Node processes: Syllabus publication vs mapping, ' + winner + ' first', {timeout: 20000}, async () => {
    const mapping = (await mapSubject()).json.data;
    const syllabus = (await http('/syllabuses', admin, syllabusInput())).json.data;
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(done => {entered = done;}); const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {const result = await original.apply(this, args); entered(); await gate; return result;} as typeof original;
    let arrived!: (value: any) => void;
    const competing = new Promise<void>(done => {arrived = value => {if (value.type === 'fence') done();}; worker.on('message', arrived);});
    try {
      const publishPath = '/syllabuses/' + syllabus.syllabusId + '/publish';
      const mappingPath = '/academic-setup/classes/' + classId + '/subjects/' + mapping.id + '/deactivate';
      const first = winner === 'publication' ? http(publishPath, admin, {revision: 1}) : mappingAction(mapping.id, 'deactivate'); await acquired;
      const second = winner === 'publication' ? http(mappingPath, principal, {revision: 1}, 'POST', workerBase) : http(publishPath, admin, {revision: 1}, 'POST', workerBase);
      await competing; release(); const [a,b] = await Promise.all([first,second]); assert.deepEqual([a.status,b.status], [200,409]);
      assert.equal((await ClassSubject.findById(mapping.id))!.isActive, winner === 'publication');
      assert.equal((await Syllabus.findById(syllabus.syllabusId))!.status, winner === 'publication' ? 'published' : 'draft');
    } finally {release(); worker.removeListener('message',arrived); Branch.collection.updateOne=original;}
  });
}

test('guessed mapping identities cannot cross Branch, Class or period lifecycle boundaries', async () => {
  const own = (await mapSubject()).json.data;
  const owner = (await User.findOne({role: 'super_admin'}))!._id;
  const otherClass = await new SchoolClass({branchId: branch, academicPeriodId: periodId, academicYear: 'CURRENT', name: 'Other Class', code: 'OTHER'}).save();
  const foreignRow = await ClassSubject.create({branchId: foreign, academicPeriodId: periodId, classId, subjectId, createdBy: owner, updatedBy: owner});
  const wrongPeriod = await ClassSubject.create({branchId: branch, academicPeriodId: new mongoose.Types.ObjectId(), classId, subjectId, createdBy: owner, updatedBy: owner});
  for (const action of ['deactivate', 'reactivate']) {
    for (const id of [String(new mongoose.Types.ObjectId()), String(foreignRow._id), String(wrongPeriod._id)]) assert.equal((await mappingAction(id, action)).status, 404);
    assert.equal((await http('/academic-setup/classes/' + otherClass._id + '/subjects/' + own.id + '/' + action, principal, {revision: 1})).status, 404);
  }
  assert.equal((await ClassSubject.findById(own.id))!.revision, 1);
  assert.equal((await curriculum()).json.data.items.length, 1);
  assert.equal((await curriculum('?academicPeriodId=' + wrongPeriod.academicPeriodId)).status, 400);
});

test('parent lifecycle blocks all new operational writes while mapping history remains visible', async () => {
  await mapSubject(); await retainedAssignment();
  const assertDenied = async () => {
    assert.equal((await curriculum()).status, 200);
    assert.ok([404, 409].includes((await assignment()).status));
    assert.ok([404, 409].includes((await http('/timetables/versions', principal, scheduleInput())).status));
    assert.ok([404, 409].includes((await http('/syllabuses', admin, syllabusInput())).status));
  };
  await AcademicPeriod.updateOne({_id: periodId}, {$set: {status: 'closed'}}); await assertDenied();
  await AcademicPeriod.updateOne({_id: periodId}, {$set: {status: 'active'}});
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$set: {isActive: false}}); await assertDenied();
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$set: {isActive: true}});
  await Subject.updateOne({_id: subjectId}, {$set: {isActive: false}}); await assertDenied();
});

test('legacy assignments expose revoke only; extension, copying and replacement cannot bypass mapping', async () => {
  const legacy = await retainedAssignment();
  const path = '/teacher-assignments/' + legacy._id;
  assert.equal((await http(path, principal, {validUntil: '2028-01-01'}, 'PATCH')).status, 404);
  assert.equal((await http(path + '/extend', principal, {validUntil: '2028-01-01'})).status, 404);
  assert.equal((await http(path + '/copy', principal, {})).status, 404);
  assert.equal((await http(path + '/revoke', principal, {}, 'PATCH')).status, 200);
  assert.equal((await assignment()).status, 409);
  assert.equal(await TeacherAssignment.countDocuments({isActive: true}), 0);
});

test('imported legacy draft timetable and syllabus cannot acquire current authority without mapping', async () => {
  await retainedAssignment();
  const input = scheduleInput(); const {periods, ...versionInput} = input;
  const version = await TimetableVersion.create({...versionInput, periodCount: 1, createdBy: teacherId});
  await TimetablePeriod.create({...periods[0], branchId: branch, timetableVersionId: version._id});
  assert.equal((await http('/timetables/versions/' + version._id + '/approve', principal, {})).status, 409);
  assert.equal((await http('/timetables/versions/' + version._id, principal, {}, 'PATCH')).status, 404);
  const legacy = await Syllabus.create({...syllabusInput(), units: [{title: 'Unit', order: 1, topics: [{title: 'Topic', order: 1}]}], branchId: branch, academicYear: 'CURRENT', createdBy: teacherId, updatedBy: teacherId});
  assert.equal((await http('/syllabuses/' + legacy._id, admin)).status, 200);
  assert.equal((await http('/syllabuses/' + legacy._id, admin, {revision: 1, title: 'Changed', units: syllabusInput().units}, 'PATCH')).status, 409);
  assert.equal((await http('/syllabuses/' + legacy._id + '/publish', admin, {revision: 1})).status, 409);
  assert.equal((await http('/syllabuses', admin, {...syllabusInput(), version: 2})).status, 409);
  assert.equal((await TimetableVersion.findById(version._id))!.status, 'draft');
  assert.equal((await Syllabus.findById(legacy._id))!.revision, 1);
});

for (const stage of ['create', 'approval'] as const) for (const winner of ['timetable', 'deactivation'] as const) {
  test('two Node processes: timetable ' + stage + ' vs mapping, ' + winner + ' first', {timeout: 20000}, async () => {
    const mapping = (await mapSubject()).json.data; await retainedAssignment();
    const version = stage === 'approval' ? (await http('/timetables/versions', principal, scheduleInput())).json.data : null;
    const path = stage === 'create' ? '/timetables/versions' : '/timetables/versions/' + version.versionId + '/approve';
    const body = stage === 'create' ? scheduleInput() : {};
    const mappingPath = '/academic-setup/classes/' + classId + '/subjects/' + mapping.id + '/deactivate';
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(done => {entered = done;}); const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {const result = await original.apply(this, args); entered(); await gate; return result;} as typeof original;
    let arrived!: (value: any) => void;
    const competing = new Promise<void>(done => {arrived = value => {if (value.type === 'fence') done();}; worker.on('message', arrived);});
    try {
      const first = winner === 'timetable' ? http(path, principal, body) : mappingAction(mapping.id, 'deactivate'); await acquired;
      const second = winner === 'timetable' ? http(mappingPath, principal, {revision: 1}, 'POST', workerBase) : http(path, principal, body, 'POST', workerBase);
      await competing; release(); const [a, b] = await Promise.all([first, second]);
      const success = stage === 'create' ? 201 : 200;
      // The active teaching responsibility independently reserves curriculum,
      // so even deactivation-first must fail; this is the intended guard.
      assert.deepEqual([a.status, b.status], winner === 'timetable' ? [success, 409] : [409, success]);
      assert.equal((winner === 'timetable' ? b : a).json.message.includes('Teacher Assignments'), true);
      assert.equal((await ClassSubject.findById(mapping.id))!.isActive, true);
      assert.equal(await TimetableVersion.countDocuments({status: stage === 'create' ? 'draft' : 'approved'}), 1);
      assert.equal(await TimetablePeriod.countDocuments(), 1);
    } finally {release(); worker.removeListener('message', arrived); Branch.collection.updateOne = original;}
  });
}

for (const stage of ['create', 'update'] as const) for (const winner of ['syllabus', 'deactivation'] as const) {
  test('two Node processes: Syllabus ' + stage + ' vs mapping, ' + winner + ' first', {timeout: 20000}, async () => {
    const mapping = (await mapSubject()).json.data;
    const draft = stage === 'update' ? (await http('/syllabuses', admin, syllabusInput())).json.data : null;
    const path = stage === 'create' ? '/syllabuses' : '/syllabuses/' + draft.syllabusId;
    const body = stage === 'create' ? syllabusInput() : {revision: 1, title: 'Updated before deactivation', units: syllabusInput().units};
    const method = stage === 'create' ? 'POST' : 'PATCH';
    const mappingPath = '/academic-setup/classes/' + classId + '/subjects/' + mapping.id + '/deactivate';
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(done => {entered = done;}); const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {const result = await original.apply(this, args); entered(); await gate; return result;} as typeof original;
    let arrived!: (value: any) => void;
    const competing = new Promise<void>(done => {arrived = value => {if (value.type === 'fence') done();}; worker.on('message', arrived);});
    try {
      const first = winner === 'syllabus' ? http(path, admin, body, method) : mappingAction(mapping.id, 'deactivate'); await acquired;
      const second = winner === 'syllabus' ? http(mappingPath, principal, {revision: 1}, 'POST', workerBase) : http(path, admin, body, method, workerBase);
      await competing; release(); const [a, b] = await Promise.all([first, second]);
      // A draft is deliberately non-operational: a completed draft write may
      // precede deactivation, but any later publication must revalidate mapping.
      assert.deepEqual([a.status, b.status], winner === 'syllabus' ? [200, 200] : [200, 409]);
      assert.equal((await ClassSubject.findById(mapping.id))!.isActive, false);
      const row = await Syllabus.findOne();
      assert.equal(await Syllabus.countDocuments(), stage === 'create' && winner === 'deactivation' ? 0 : 1);
      if (row) {
        assert.equal(row.status, 'draft');
        assert.equal(row.revision, stage === 'update' && winner === 'syllabus' ? 2 : 1);
        assert.equal((await http('/syllabuses/' + row._id + '/publish', admin, {revision: row.revision})).status, 409);
      }
    } finally {release(); worker.removeListener('message', arrived); Branch.collection.updateOne = original;}
  });
}
