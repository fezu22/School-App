import {ClassSubject} from '../src/staff/src/models/classSubject';
import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import type {Server} from 'node:http';
import {fork, type ChildProcess} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';
import mongoose from 'mongoose';
import {MongoMemoryReplSet, MongoMemoryServer} from 'mongodb-memory-server';
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
import {withAcademicCatalogLock} from '../src/staff/src/services/academic-catalog-lock.service';
import {createStudent} from '../src/staff/src/services/student.service';

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
const periodBody = (code = 'NEXT') => ({name: 'Next year', code, startDate: '2027-08-01', endDate: '2028-07-31'});
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
  await seedCurriculumFixtures(true);
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
test('authentication, role and all eight central permissions fail closed', async () => {
  assert.equal((await http('/academic-setup/periods')).status, 401);
  assert.equal((await setup('periods', '', teacher)).status, 403);
  for (const kind of ['periods', 'classes', 'sections', 'subjects'] as const) {
    const prefix = `academic.${kind}.`;
    ROLE_PERMISSIONS.super_admin = adminGrants.filter(p => p !== `${prefix}view`);
    assert.equal((await setup(kind, `?branchId=${branch}${kind === 'sections' ? `&classId=${classId}` : ''}`, admin)).status, 403);
    ROLE_PERMISSIONS.super_admin = adminGrants.filter(p => p !== `${prefix}manage`);
    assert.equal((await setup(kind, `?branchId=${branch}`, admin, {})).status, 403);
  }
});
test('Principal can read only its DB Branch; supplied Branch never grants authority', async () => {
  const result = await setup('periods'); assert.equal(result.status, 200);
  assert.equal(result.json.data.current.id, periodId);
  assert.deepEqual(Object.keys(result.json.data.current).sort(), ['id', 'name', 'code', 'startDate', 'endDate', 'status', 'revision'].sort());
  assert.equal((await setup('periods', `?branchId=${foreign}`)).status, 404);
  assert.equal((await setup('classes', `?branchId=${foreign}`, principal, {name: 'X', code: 'X', academicPeriodId: periodId})).status, 403);
  assert.equal((await setup('periods', '', principal, periodBody())).status, 403);
  ROLE_PERMISSIONS.principal.push(PERMISSIONS.ACADEMIC_PERIODS_MANAGE);
  assert.equal((await setup('periods', '', principal, periodBody())).status, 403);
  const user = await User.findOne({role: 'principal'}); assert.ok(user);
  await User.updateOne({_id: user._id}, {$set: {branchId: foreign}});
  assert.equal((await setup('periods')).json.data.current, null);
  assert.equal((await setup('classes', `/${classId}`)).status, 404);
});
test('Super Admin bootstrap creates a draft; activation uses status only, with one active per Branch', async () => {
  const created = await setup('periods', `?branchId=${foreign}`, admin, periodBody());
  assert.equal(created.status, 201); assert.equal(created.json.data.status, 'draft');
  const id = created.json.data.id;
  assert.equal((await setup('periods', `/${id}/activate?branchId=${foreign}`, admin, {revision: 1})).status, 200);
  assert.equal((await setup('periods', `?branchId=${foreign}`, admin)).json.data.current.id, id);
  assert.equal((await setup('periods', `/${id}/activate?branchId=${foreign}`, admin, {revision: 2})).status, 409);
  assert.equal((await http(`/academic-setup/periods/${id}?branchId=${foreign}`, admin, undefined, 'DELETE')).status, 404);
});
test('invalid period dates, duplicate and concurrent duplicate are deterministic', async () => {
  for (const dates of [{startDate: '2027-02-30'}, {endDate: '2026-01-01'}, {startDate: 'bad'}, {endDate: '2027-08-01'}]) {
    assert.equal((await setup('periods', `?branchId=${branch}`, admin, {...periodBody(), ...dates})).status, 400);
  }
  const results = await Promise.all([1, 2].map(() => setup('periods', `?branchId=${branch}`, admin, periodBody('next'))));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await setup('periods', `?branchId=${branch}`, admin, periodBody('NEXT'))).status, 409);
});
test('period lifecycle retains used Classes/history, freezes edits and rejects stale revisions', async () => {
  assert.equal((await setup('periods', `/${periodId}/archive?branchId=${branch}`, admin, {revision: 1})).status, 409);
  assert.equal((await setup('periods', `/${periodId}?branchId=${branch}`, admin, {...periodBody(), revision: 1}, 'PATCH')).status, 400); // immutable code rejected
  assert.equal((await setup('periods', `/${periodId}/close?branchId=${branch}`, admin, {revision: 1})).status, 200);
  assert.equal((await setup('periods')).json.data.current, null);
  assert.equal((await setup('classes', `/${classId}`)).status, 200);
  assert.equal((await setup('periods', `/${periodId}/archive?branchId=${branch}`, admin, {revision: 1})).status, 409);
  assert.equal((await setup('periods', `/${periodId}/archive?branchId=${branch}`, admin, {revision: 2})).status, 200);
  assert.equal((await setup('classes', '', principal, {name: 'New', code: 'NEW', academicPeriodId: periodId})).status, 409);
  assert.equal((await assignment()).status, 409);
});
test('draft period edits require the latest revision and active period dates are immutable', async () => {
  const created = await setup('periods', `?branchId=${foreign}`, admin, periodBody());
  const id = created.json.data.id;
  const body = {name: 'Revised year', startDate: '2027-08-02', endDate: '2028-07-31', revision: 1};
  assert.equal((await setup('periods', `/${id}?branchId=${foreign}`, admin, body, 'PATCH')).status, 200);
  assert.equal((await setup('periods', `/${id}?branchId=${foreign}`, admin, body, 'PATCH')).status, 409);
  assert.equal((await setup('periods', `/${id}/activate?branchId=${foreign}`, admin, {revision: 2})).status, 200);
  assert.equal((await setup('periods', `/${id}?branchId=${foreign}`, admin, {...body, revision: 3}, 'PATCH')).status, 409);
  assert.equal((await setup('periods', `/${id}/close?branchId=${foreign}`, admin, {revision: 3})).status, 200);
  assert.equal((await setup('periods', `/${id}/activate?branchId=${foreign}`, admin, {revision: 4})).status, 409);
});
test('simultaneous activation of different drafts cannot create two active periods', async () => {
  const ids = [];
  for (const code of ['A', 'B']) ids.push((await setup('periods', `?branchId=${foreign}`, admin, periodBody(code))).json.data.id);
  const results = await Promise.all(ids.map(id => setup('periods', `/${id}/activate?branchId=${foreign}`, admin, {revision: 1})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await AcademicPeriod.countDocuments({branchId: foreign, status: 'active'}), 1);
});
test('Classes validate exact period and allow safe edits and lifecycle with revisions', async () => {
  const body = {name: 'Grade 9', code: 'G9', academicPeriodId: periodId};
  assert.equal((await setup('classes', '', principal, {...body, branchId: foreign})).status, 400);
  const foreignPeriod = (await setup('periods', `?branchId=${foreign}`, admin, periodBody())).json.data.id;
  assert.equal((await setup('classes', '', principal, {...body, academicPeriodId: foreignPeriod})).status, 403);
  const draft = (await setup('periods', `?branchId=${branch}`, admin, periodBody())).json.data.id;
  assert.equal((await setup('classes', '', principal, {...body, academicPeriodId: draft})).status, 409);
  const results = await Promise.all([1, 2].map(() => setup('classes', '', principal, body)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const id = results.find(r => r.status === 201)!.json.data.id;
  assert.equal((await setup('classes', `/${id}`, principal, {name: 'Grade Nine', code: 'G9', revision: 1}, 'PATCH')).status, 200);
  assert.equal((await deactivate('classes', id)).status, 409);
  assert.equal((await setup('classes', `/${id}/deactivate`, principal, {revision: 2})).status, 200);
  assert.equal((await setup('classes', `/${id}/reactivate`, principal, {revision: 3})).status, 200);
  assert.equal((await deactivate('classes', classId)).status, 409); // child Section retained
  assert.equal((await setup('classes', `/${id}?branchId=${foreign}`, principal, {name: 'X', code: 'X', revision: 4}, 'PATCH')).status, 403);
});
test('legacy Classes remain readable and cannot be implicitly migrated', async () => {
  const legacy = await new SchoolClass({branchId: branch, name: 'Legacy', code: 'OLD', academicYear: '2025'}).save();
  const id = String(legacy._id);
  assert.equal((await setup('classes', `/${id}`)).json.data.legacy, true);
  assert.equal((await setup('classes', `/${id}`, principal, {name: 'Changed', code: 'OLD', revision: 1}, 'PATCH')).status, 409);
  assert.equal((await setup('sections', '', principal, {name: 'X', code: 'X', classId: id})).status, 409);
});
test('Sections enforce exact parent, concurrent uniqueness, edit and inactive parent rules', async () => {
  const otherClass = await new SchoolClass({branchId: foreign, name: 'Other', code: 'OTHER', academicYear: '2026'}).save();
  assert.equal((await setup('sections', '', principal, {name: 'X', code: 'X', classId: String(otherClass._id)})).status, 403);
  assert.equal((await setup('sections', `?classId=${otherClass._id}`)).status, 404);
  const results = await Promise.all([1, 2].map(() => setup('sections', '', principal, {name: 'B', code: 'B', classId})));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const id = results.find(r => r.status === 201)!.json.data.id;
  assert.equal((await setup('sections', `/${id}?classId=${classId}`)).status, 200);
  assert.equal((await setup('sections', `/${id}`, principal, {name: 'Blue', code: 'B', revision: 1}, 'PATCH')).status, 200);
  assert.equal((await setup('sections', `/${id}/deactivate`, principal, {revision: 2})).status, 200);
  await SchoolClass.collection.updateOne({_id: new mongoose.Types.ObjectId(classId)}, {$set: {isActive: false}});
  assert.equal((await setup('sections', '', principal, {name: 'C', code: 'C', classId})).status, 409);
});
test('Subjects have case-insensitive Branch uniqueness and safe revisioned edits', async () => {
  const results = await Promise.all(['Science', 'sCIENCE'].map(name => setup('subjects', '', principal, {name})));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const id = results.find(r => r.status === 201)!.json.data.id;
  assert.equal((await setup('subjects', `/${id}`, principal, {name: 'Physics', revision: 1}, 'PATCH')).status, 200);
  assert.equal((await deactivate('subjects', id)).status, 409);
  assert.equal((await setup('subjects', `/${id}/deactivate`, principal, {revision: 2})).status, 200);
  assert.equal((await setup('subjects', `/${id}?branchId=${foreign}`)).status, 404);
  assert.equal((await setup('subjects', `?branchId=${foreign}`, admin, {name: 'Physics'})).status, 201);
});
test('every catalog mutation conceals foreign IDs and rejects branch/parent/year injection', async () => {
  const fp = (await setup('periods', `?branchId=${foreign}`, admin, periodBody())).json.data;
  assert.equal((await setup('periods', `/${fp.id}/activate?branchId=${foreign}`, admin, {revision: 1})).status, 200);
  const fc = (await setup('classes', `?branchId=${foreign}`, admin, {name: 'Foreign', code: 'FC', academicPeriodId: fp.id})).json.data;
  const fs = (await setup('sections', `?branchId=${foreign}`, admin, {name: 'Foreign', code: 'FS', classId: fc.id})).json.data;
  const fu = (await setup('subjects', `?branchId=${foreign}`, admin, {name: 'Foreign'})).json.data;
  for (const [kind, id] of [['classes', fc.id], ['sections', fs.id], ['subjects', fu.id]] as const) {
    const fields = {name: 'Forged', ...(kind === 'subjects' ? {} : {code: 'FORGED'}), revision: 1};
    const foreignResult = await setup(kind, `/${id}`, principal, fields, 'PATCH');
    const missingResult = await setup(kind, `/${new mongoose.Types.ObjectId()}`, principal, fields, 'PATCH');
    assert.equal(foreignResult.status, 403); assert.deepEqual(foreignResult.json, missingResult.json);
    for (const action of ['deactivate', 'reactivate']) assert.equal((await setup(kind, `/${id}/${action}`, principal, {revision: 1})).status, 403);
    assert.equal((await setup(kind, `?branchId=${foreign}`, principal, {name: 'Forged'})).status, 403);
    assert.equal((await setup(kind, '', principal, {name: 'Forged', branchId: foreign})).status, 400);
  }
  assert.equal((await setup('classes', '', principal, {name: 'Forged', code: 'X', academicPeriodId: periodId, academicYear: 'INJECTED'})).status, 400);
  assert.equal((await setup('classes', `/${classId}`, principal, {name: 'Forged', code: 'X', academicPeriodId: fp.id, revision: 1}, 'PATCH')).status, 400);
  assert.equal((await setup('sections', `/${sectionId}`, principal, {name: 'Forged', code: 'X', classId: fc.id, revision: 1}, 'PATCH')).status, 400);
  assert.equal((await setup('sections', `/${fs.id}?classId=${classId}`)).status, 404);
  const ownOtherClass = (await setup('classes', '', principal, {name: 'Own other', code: 'OWN', academicPeriodId: periodId})).json.data;
  assert.equal((await setup('sections', `/${sectionId}?classId=${ownOtherClass.id}`)).status, 404);
  assert.equal((await setup('classes', `/${classId}`)).json.data.academicYear, 'CURRENT');
});
test('Principal mutation revalidates account state, role, session and each catalog permission', async () => {
  for (const [kind, grant] of [['classes', PERMISSIONS.ACADEMIC_CLASSES_MANAGE], ['sections', PERMISSIONS.ACADEMIC_SECTIONS_MANAGE], ['subjects', PERMISSIONS.ACADEMIC_SUBJECTS_MANAGE]] as const) {
    ROLE_PERMISSIONS.principal = principalGrants.filter(p => p !== grant);
    assert.equal((await setup(kind, '', principal, {})).status, 403);
  }
  ROLE_PERMISSIONS.principal = [...principalGrants];
  const p = await User.findOne({role: 'principal'}); assert.ok(p);
  for (const change of [{isActive: false}, {role: 'teacher'}]) {
    await User.updateOne({_id: p._id}, {$set: change});
    assert.equal((await setup('subjects', '', principal, {name: 'Forbidden'})).status, 401);
    await User.updateOne({_id: p._id}, {$set: {isActive: true, role: 'principal'}});
  }
  await mongoose.connection.collection('sessions').updateOne({token: principal}, {$set: {isRevoked: true}});
  assert.equal((await setup('subjects', '', principal, {name: 'Forbidden'})).status, 401);
  for (const kind of ['periods', 'classes', 'sections', 'subjects'] as const) assert.equal((await setup(kind, '', teacher, {})).status, 403);
});
for (const collection of ['students', 'teacherassignments', 'timetableperiods', 'syllabuses', 'attendances', 'attendancesessions', 'homeworks', 'quizzes', 'catchupitems', 'academicresults']) {
  test(`deactivation retains ${collection} references and returns 409`, async () => {
    await ClassSubject.updateMany({}, {$set: {isActive: false}});
    const key = collection === 'students' ? 'sectionId' : 'subjectId';
    const id = key === 'sectionId' ? sectionId : subjectId;
    await mongoose.connection.collection(collection).insertOne({[key]: new mongoose.Types.ObjectId(id), isActive: false});
    assert.equal((await deactivate(key === 'sectionId' ? 'sections' : 'subjects', id)).status, 409);
    await mongoose.connection.collection(collection).deleteMany({});
  });
}
for (const change of ['branch', 'inactive', 'role', 'session', 'permission'] as const) {
  test(`setup revalidates ${change} changed after initial authorization while transaction is pending`, async () => {
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void, calls = 0;
    const acquired = new Promise<void>(done => {entered = done;});
    const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {
      const first = ++calls === 1;
      const result = await original.apply(this, args);
      if (first) {entered(); await gate;}
      return result;
    } as typeof original;
    try {
      const pending = setup('subjects', '', principal, {name: 'Pending unauthorized'});
      await acquired;
      if (change === 'session') await mongoose.connection.collection('sessions').updateOne({token: principal}, {$set: {isRevoked: true}});
      else if (change === 'permission') ROLE_PERMISSIONS.principal = principalGrants.filter(p => p !== PERMISSIONS.ACADEMIC_SUBJECTS_MANAGE);
      else await User.updateOne({role: 'principal'}, {$set: change === 'branch' ? {branchId: foreign} : change === 'inactive' ? {isActive: false} : {role: 'teacher'}});
      release();
      const result = await pending;
      assert.equal(result.status, change === 'branch' ? 403 : change === 'permission' ? 403 : 401);
      assert.equal(await Subject.countDocuments({name: 'Pending unauthorized'}), 0);
    } finally {release(); Branch.collection.updateOne = original;}
  });
}

// Pause the winner after its *real* database fence write. Start the loser on a
// different HTTP connection while that transaction is uncommitted, then release.
// No process mutex is part of the production mechanism being tested.
for (const kind of ['subjects', 'sections', 'classes'] as const) for (const winner of ['assignment', 'deactivation'] as const) {
  test(`${kind}: ${winner} acquires Branch fence first; no invalid assignment can commit`, async () => {
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void, competing!: () => void;
    const acquired = new Promise<void>(resolve => {entered = resolve;});
    const gate = new Promise<void>(resolve => {release = resolve;});
    const attempted = new Promise<void>(resolve => {competing = resolve;});
    let calls = 0;
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {
      const call = ++calls;
      if (call === 2) competing();
      const result = await original.apply(this, args);
      if (call === 1) {entered(); await gate;}
      return result;
    } as typeof original;
    try {
      const id = kind === 'subjects' ? subjectId : kind === 'sections' ? sectionId : classId;
      const first = winner === 'assignment' ? assignment() : deactivate(kind, id);
      await acquired;
      const second = winner === 'assignment' ? deactivate(kind, id) : assignment();
      await attempted; release();
      const [a, b] = await Promise.all([first, second]);
      if (kind !== 'sections' || winner === 'assignment') {
        assert.equal(winner === 'assignment' ? a.status : b.status, 201);
        assert.equal(winner === 'deactivation' ? a.status : b.status, 409);
      } else {assert.equal(a.status, 200); assert.equal(b.status, 404);}
      for (const row of await TeacherAssignment.find().lean()) {
        assert.ok(await SchoolClass.exists({isActive: true}).where('_id').equals(row.classId));
        assert.ok(await Section.exists({isActive: true}).where('_id').equals(row.sectionId));
        assert.ok(await Subject.exists({_id: row.subjectId, isActive: true}));
      }
    } finally {release(); Branch.collection.updateOne = original;}
  });
}
test('enrollment revalidates Class/Section inside the shared Branch fence', async () => {
  assert.equal((await deactivate('sections', sectionId)).status, 200);
  await assert.rejects(createStudent({createdBy: teacherId, userId: teacherId, branchId: branch, classId, sectionId, admissionNumber: 'NEW'}));
});
for (const winner of ['enrollment', 'deactivation'] as const) {
  test(`Student enrollment vs Section deactivation: ${winner} commits first`, async () => {
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void, competing!: () => void;
    const acquired = new Promise<void>(resolve => {entered = resolve;});
    const gate = new Promise<void>(resolve => {release = resolve;});
    const attempted = new Promise<void>(resolve => {competing = resolve;});
    let calls = 0;
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {
      const call = ++calls;
      if (call === 2) competing();
      const result = await original.apply(this, args);
      if (call === 1) {entered(); await gate;}
      return result;
    } as typeof original;
    const pupil = await actor('student', branch);
    const admissionActor = await User.findOne({role: 'principal'});
    const enroll = () => createStudent({createdBy: String(admissionActor!._id), userId: pupil.id, branchId: branch, classId, sectionId, admissionNumber: 'RACE'}).then(() => 201, (error: any) => error.status ?? 500);
    try {
      const first = winner === 'enrollment' ? enroll() : deactivate('sections', sectionId).then(r => r.status);
      await acquired;
      const second = winner === 'enrollment' ? deactivate('sections', sectionId).then(r => r.status) : enroll();
      await attempted; release();
      const results = await Promise.all([first, second]);
      assert.deepEqual(results, winner === 'enrollment' ? [201, 409] : [200, 409]);
    } finally {release(); Branch.collection.updateOne = original;}
  });
}
test('transaction rollback leaves fence and catalog unchanged', async () => {
  const beforeRow = await Branch.findById(branch).lean();
  await assert.rejects(withAcademicCatalogLock(branch, async session => {
    await Subject.updateOne({_id: subjectId}, {$set: {isActive: false}}, {session}); throw new Error('abort');
  }), /abort/);
  assert.equal((await Subject.findById(subjectId))!.isActive, true);
  assert.equal((await Branch.findById(branch).lean())!.__v, beforeRow!.__v);
});
test('transient transaction retry rolls back the first insert and commits exactly one', async () => {
  let attempts = 0;
  const start = (await Branch.findById(branch))!.__v;
  await withAcademicCatalogLock(branch, async session => {
    await Subject.create([{branchId: branch, name: 'Retry subject'}], {session});
    if (++attempts === 1) {
      const transient = new mongoose.mongo.MongoServerError({message: 'injected write conflict', code: 112});
      transient.addErrorLabel('TransientTransactionError'); throw transient;
    }
  });
  assert.equal(attempts, 2);
  assert.equal(await Subject.countDocuments({branchId: branch, name: 'Retry subject'}), 1);
  assert.equal((await Branch.findById(branch))!.__v, start + 1);
});
test('non-retryable transaction failure returns sanitized failure without success or partial writes', async () => {
  const original = Branch.collection.updateOne;
  Branch.collection.updateOne = async () => {throw new Error('private database failure');};
  try {
    const response = await setup('subjects', '', principal, {name: 'Must not exist'});
    assert.equal(response.status, 500); assert.equal(response.json.success, false);
    assert.equal(JSON.stringify(response.json).includes('private database failure'), false);
    assert.equal(await Subject.countDocuments({name: 'Must not exist'}), 0);
  } finally {Branch.collection.updateOne = original;}
});
for (const kind of ['classes', 'sections', 'subjects'] as const) for (const winner of ['assignment', 'deactivation'] as const) {
  test(`separate Node instances: ${kind}, ${winner} wins fence`, {timeout: 20000}, async () => {
    const original = Branch.collection.updateOne;
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(done => {entered = done;});
    const gate = new Promise<void>(done => {release = done;});
    Branch.collection.updateOne = async function (this: typeof Branch.collection, ...args: Parameters<typeof original>) {
      const result = await original.apply(this, args); entered(); await gate; return result;
    } as typeof original;
    let arrived!: (message: any) => void;
    const contender = new Promise<void>(done => {arrived = message => {if (message.type === 'fence') done();}; worker.on('message', arrived);});
    try {
      const id = kind === 'classes' ? classId : kind === 'sections' ? sectionId : subjectId;
      const first = winner === 'assignment' ? assignment() : deactivate(kind, id);
      await acquired;
      const second = winner === 'assignment'
        ? http(`/academic-setup/${kind}/${id}/deactivate`, principal, {revision: 1}, 'POST', workerBase)
        : http('/teacher-assignments', principal, {teacherId, classId, sectionId, subjectId, validFrom: '2026-01-01T00:00:00Z'}, 'POST', workerBase);
      await contender; release();
      const [a, b] = await Promise.all([first, second]);
      assert.deepEqual([a.status, b.status], winner === 'assignment' ? [201, 409] : kind !== 'sections' ? [409, 201] : [200, 404]);
      assert.equal(await TeacherAssignment.countDocuments(), winner === 'assignment' || kind !== 'sections' ? 1 : 0);
    } finally {release(); worker.removeListener('message', arrived); Branch.collection.updateOne = original;}
  });
}
test('standalone MongoDB fails closed without partial catalog writes', async () => {
  const standalone = await MongoMemoryServer.create();
  try {
    await mongoose.disconnect(); await mongoose.connect(standalone.getUri(), {autoIndex: false});
    const b = await Branch.create({name: 'Standalone', code: 'ST', city: 'Fixture', address: 'Fixture'});
    await assert.rejects(withAcademicCatalogLock(String(b._id), async () => {throw new Error('must not reach callback');}), (error: any) => error.status === 503);
    assert.equal((await Branch.findById(b._id))!.__v, 0);
  } finally {await mongoose.disconnect(); await standalone.stop(); await mongoose.connect(db.getUri(), {autoIndex: false});}
});


test('period date-only strings survive create, Mongo storage, read and edit without conversion', async () => {
  const ranges = [['2026-04-01', '2027-03-31'], ['2028-02-29', '2028-03-01'], ['2000-02-29', '2000-03-01'], ['0096-02-29', '0096-03-01']];
  for (const [index, [startDate, endDate]] of ranges.entries()) {
    const created = await setup('periods', '?branchId=' + branch, admin, {...periodBody('DATE' + index), startDate, endDate});
    assert.equal(created.status, 201);
    const id = created.json.data.id;
    const stored = await AcademicPeriod.collection.findOne({_id: new mongoose.Types.ObjectId(id)});
    assert.ok(stored); assert.equal(stored.startDate, startDate); assert.equal(stored.endDate, endDate);
    const read = await setup('periods', '/' + id + '?branchId=' + branch, admin);
    assert.equal(read.status, 200); assert.equal(read.json.data.startDate, startDate); assert.equal(read.json.data.endDate, endDate);
    const body = {name: 'Edited dates', startDate, endDate, revision: 1};
    assert.equal((await setup('periods', '/' + id + '?branchId=' + branch, admin, body, 'PATCH')).status, 200);
    const edited = await AcademicPeriod.collection.findOne({_id: new mongoose.Types.ObjectId(id)});
    assert.ok(edited); assert.equal(edited.startDate, startDate); assert.equal(edited.endDate, endDate);
  }
});
test('period date contract rejects locale formats, impossible calendar days, year zero and non-increasing ranges', async () => {
  const invalid = ['0000-01-01', '1900-02-29', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-04-00', '01-04-2026', '04/01/2026', '2026-4-1', '2026-04-01T00:00:00Z'];
  for (const value of invalid) {
    for (const field of ['startDate', 'endDate']) {
      assert.equal((await setup('periods', '?branchId=' + branch, admin, {...periodBody('INVALID'), [field]: value})).status, 400);
    }
  }
  for (const endDate of ['2027-08-01', '2027-07-31']) {
    assert.equal((await setup('periods', '?branchId=' + branch, admin, {...periodBody('INVALID'), endDate})).status, 400);
  }
  assert.equal(await AcademicPeriod.countDocuments({code: 'INVALID'}), 0);
});

const roomBody = (extra: Record<string,unknown> = {}) => ({name:'Science Lab 1',code:'LAB1',category:'science_lab',...extra});
test('Rooms: create normalized catalog, safe DTO, literal name/code search and revisioned edit', async()=>{
  const created=await setup('rooms','',principal,roomBody({code:'lab1'})); assert.equal(created.status,201);
  const r=created.json.data; assert.equal(r.code,'LAB1'); assert.equal(r.category,'science_lab');
  assert.deepEqual(Object.keys(r).sort(),['id','name','code','category','isActive','revision'].sort());
  assert.equal((await setup('rooms','?q=lab1')).json.data.total,1);
  assert.equal((await setup('rooms','?q=SCIENCE')).json.data.total,1);
  assert.equal((await setup('rooms','?q=.*')).json.data.total,0);
  assert.equal((await setup('rooms','/'+r.id,principal,roomBody({name:'Chemistry Lab',revision:1}),'PATCH')).status,200);
  assert.equal((await setup('rooms','/'+r.id,principal,roomBody({revision:1}),'PATCH')).status,409);
});
test('Rooms: duplicate codes and case-insensitive names cannot race within Branch; other Branch is independent', async()=>{
  const results=await Promise.all([setup('rooms','',principal,roomBody()),setup('rooms','',principal,roomBody())]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await setup('rooms','',principal,roomBody({name:'science lab 1',code:'OTHER'}))).status,409);
  assert.equal((await setup('rooms','?branchId='+foreign,admin,roomBody())).status,201);
});
test('Rooms: unused Room deactivate/reactivate retains identity and requires latest revision', async()=>{
  const r=(await setup('rooms','',principal,roomBody())).json.data;
  assert.equal((await deactivate('rooms',r.id)).status,200);
  assert.equal((await setup('rooms')).json.data.items[0].isActive,false);
  assert.equal((await setup('rooms','/'+r.id+'/reactivate',principal,{revision:2})).status,200);
  assert.equal((await setup('rooms','/'+r.id,principal,undefined,'DELETE')).status,404);
});
for(const collection of ['timetableperiods','substituteassignments'])test('Rooms: deactivation retains referenced '+collection,async()=>{
  const r=(await setup('rooms','',principal,roomBody())).json.data;
  await mongoose.connection.collection(collection).insertOne({roomId:new mongoose.Types.ObjectId(r.id)});
  assert.equal((await deactivate('rooms',r.id)).status,409);
});
test('Rooms: role, central grants, explicit global SA Branch and Principal cross-Branch fail closed',async()=>{
  assert.equal((await setup('rooms','',teacher)).status,403);
  assert.equal((await setup('rooms','',admin)).status,400);
  const r=(await setup('rooms','?branchId='+foreign,admin,roomBody())).json.data;
  assert.equal((await setup('rooms','?branchId='+foreign,principal,roomBody())).status,403);
  assert.equal((await setup('rooms','/'+r.id,principal,roomBody({revision:1}),'PATCH')).status,403);
  const scoped=await actor('super_admin',branch);
  assert.equal((await setup('rooms','?branchId='+foreign,scoped.token)).status,403);
  ROLE_PERMISSIONS.principal=principalGrants.filter(p=>p!==PERMISSIONS.ACADEMIC_ROOMS_MANAGE);
  assert.equal((await setup('rooms','',principal,roomBody())).status,403);
  ROLE_PERMISSIONS.principal=principalGrants.filter(p=>p!==PERMISSIONS.ACADEMIC_ROOMS_VIEW);
  assert.equal((await setup('rooms')).status,403);
});
test('Rooms: invalid category, injected authority and inactive Branch are rejected',async()=>{
  assert.equal((await setup('rooms','',principal,roomBody({category:'zego'}))).status,400);
  assert.equal((await setup('rooms','',principal,roomBody({branchId:foreign}))).status,400);
  await Branch.collection.updateOne({_id:new mongoose.Types.ObjectId(branch)},{$set:{isActive:false}});
  assert.equal((await setup('rooms','',principal,roomBody())).status,403);
});
test('Rooms: pagination is bounded and repeatable',async()=>{
  const Room=(await import('../src/staff/src/models/room')).default;
  await Room.insertMany(Array.from({length:51},(_,i)=>({branchId:branch,name:'Room '+String(i).padStart(2,'0'),code:'R'+i,createdBy:teacherId,updatedBy:teacherId})));
  const first=(await setup('rooms')).json.data, next=(await setup('rooms','?offset=50')).json.data;
  assert.equal(first.items.length,50);assert.equal(first.nextOffset,50);assert.equal(next.items.length,1);assert.equal(next.nextOffset,null);
});
