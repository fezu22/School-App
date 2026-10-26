import {seedCurriculumFixtures} from './helpers/curriculum-fixtures';
import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import {request as nodeRequest, type Server} from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, {type UserRole} from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import Session from '../src/staff/src/models/session';
import Student from '../src/staff/src/models/student';
import {getTeacherRoster, type TeacherRosterStudent} from '../src/staff/src/services/teacher-roster.service';
import {generateAccessToken} from '../src/staff/src/services/jwt.service';
import {registerSession} from '../src/staff/src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {PERMISSIONS} from '../src/staff/src/constants/permissions';
import type {TeacherAssignmentTuple} from '../src/staff/src/services/teacher-scope.service';
import {createTeacherAssignment} from '../src/staff/src/services/teacher-assignment.service';

// Only an owned ephemeral MongoDB is used; never import dotenv/config or read
// MONGODB_URI. Real indexes are enabled and exercised by concurrent HTTP writes.
type Id = mongoose.Types.ObjectId;
type Actor = {id: Id; token: string; role: UserRole};
type Mutation = {assignmentId: string; isActive: boolean};
const secret = 'isolated-teacher-security-test-secret';
const previousSecret = process.env.JWT_SECRET;
const permissionSnapshot = Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => [role, [...permissions]]));
let database: MongoMemoryReplSet, server: Server, base: string;
let branchA: Id, branchB: Id;
let teacherA: Actor, teacherB: Actor, foreignTeacher: Actor, principal: Actor, foreignPrincipal: Actor, admin: Actor, student: Actor;
let class8: Id, class9: Id, class10: Id, foreignClass: Id;
let section8A: Id, section8B: Id, section9B: Id, section10A: Id, foreignSection: Id;
let math: Id, physics: Id, foreignSubject: Id;
let assignment8: string, assignment9: string;
const past = () => new Date(Date.now() - 86400000).toISOString();
const future = () => new Date(Date.now() + 86400000).toISOString();

before(async () => {
  process.env.JWT_SECRET = secret;
  database = await MongoMemoryReplSet.create({replSet: {count: 1}});
  await mongoose.connect(database.getUri(), {dbName: 'teacher_scope_tests', autoIndex: false});
  await Promise.all([Subject.createIndexes(), TeacherAssignment.createIndexes()]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

const actor = async (name: string, role: UserRole, branchId?: Id): Promise<Actor> => {
  const user = await new User({fullName: name, email: `${name}@test.invalid`, password: 'private-password-hash', role, branchId}).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return {id: user._id, token, role};
};

const http = async <T = TeacherAssignmentTuple[]>(path: string, person: Actor | undefined, method = 'GET', body?: unknown) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{status: number; data: T; message: string; raw: string; cache: string | string[] | undefined}>((resolve, reject) => {
    const req = nodeRequest(`${base}${path}`, {method, headers: {
      ...(person ? {Authorization: `Bearer ${person.token}`} : {}),
      ...(payload === undefined ? {} : {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}),
    }}, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {raw += chunk;});
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw) as {data: T; message: string};
          resolve({status: res.statusCode!, data: parsed.data, message: parsed.message, raw, cache: res.headers['cache-control']});
        } catch (error) {reject(error);}
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
};
const input = (extra: Record<string, unknown> = {}) => ({
  teacherId: String(teacherA.id), classId: String(class8), sectionId: String(section8A), subjectId: String(math), validFrom: past(), ...extra,
});
const create = (extra: Record<string, unknown> = {}, person: Actor | undefined = principal) =>
  http<Mutation>('/teacher-assignments', person, 'POST', input(extra));
const revoke = (id: string, person: Actor | undefined = principal, body: unknown = {}) =>
  http<Mutation>(`/teacher-assignments/${id}/revoke`, person, 'PATCH', body);
const classes = (person: Actor | undefined = teacherA) => http('/teacher/classes', person);
const detail = (id: Id | string, person: Actor | undefined = teacherA) => http(`/teacher/classes/${id}`, person);
const tuple = (classId: Id, sectionId: Id, subjectId: Id, person: Actor | undefined = teacherA) =>
  http(`/teacher/classes/${classId}/sections/${sectionId}/subjects/${subjectId}`, person);

beforeEach(async () => {
  mock.restoreAll();
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) ROLE_PERMISSIONS[role] = [...permissionSnapshot[role]];
  for (const model of [Student, TeacherAssignment, Subject, Section, SchoolClass, Session, User, Branch]) await model.collection.deleteMany({});
  branchA = (await Branch.create({name: 'Branch A', code: 'AA', address: 'private address', city: 'A'}))._id;
  branchB = (await Branch.create({name: 'Branch B', code: 'BB', address: 'foreign private address', city: 'B'}))._id;
  teacherA = await actor('teacher-a', 'teacher', branchA);
  teacherB = await actor('teacher-b', 'teacher', branchA);
  foreignTeacher = await actor('foreign-teacher', 'teacher', branchB);
  principal = await actor('principal', 'principal', branchA);
  foreignPrincipal = await actor('foreign-principal', 'principal', branchB);
  admin = await actor('admin', 'super_admin');
  student = await actor('student', 'student', branchA);
  const schoolClass = async (name: string, code: string, branchId = branchA) =>
    (await new SchoolClass({branchId, name, code, academicYear: '2026'}).save())._id;
  class8 = await schoolClass('Class 8', '8');
  class9 = await schoolClass('Class 9', '9');
  class10 = await schoolClass('Class 10', '10');
  foreignClass = await schoolClass('Foreign class', 'F', branchB);
  const section = async (classId: Id, name: string, branchId = branchA) =>
    (await new Section({classId, branchId, name, code: name}).save())._id;
  section8A = await section(class8, 'A'); section8B = await section(class8, 'B');
  section9B = await section(class9, 'B'); section10A = await section(class10, 'A');
  foreignSection = await section(foreignClass, 'F', branchB);
  math = (await Subject.create({branchId: branchA, name: 'Mathematics'}))._id;
  physics = (await Subject.create({branchId: branchA, name: 'Physics'}))._id;
  foreignSubject = (await Subject.create({branchId: branchB, name: 'Mathematics'}))._id;
  await seedCurriculumFixtures();
  const first = await create(); assert.equal(first.status, 201); assignment8 = first.data.assignmentId;
  const second = await create({classId: String(class9), sectionId: String(section9B), subjectId: String(physics)});
  assert.equal(second.status, 201); assignment9 = second.data.assignmentId;
  assert.equal((await create({teacherId: String(teacherB.id)})).status, 201); // shared tuple is legitimate
  assert.equal((await create({teacherId: String(teacherB.id), classId: String(class10), sectionId: String(section10A)})).status, 201);
});

after(async () => {
  mock.restoreAll();
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) ROLE_PERMISSIONS[role] = [...permissionSnapshot[role]];
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('own effective assignments are minimal tuple rows; shared classes do not expose another Teacher', async () => {
  const response = await classes();
  assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
  assert.equal(response.data.length, 2);
  assert.deepEqual(response.data.map(row => row.assignmentId).sort(), [assignment8, assignment9].sort());
  assert.equal((await classes(teacherB)).data.length, 2);
  assert.equal((await classes(foreignTeacher)).data.length, 0);
  for (const row of response.data) assert.deepEqual(Object.keys(row).sort(), [
    'assignmentId', 'classId', 'className', 'sectionId', 'sectionName', 'subjectId', 'subjectName',
  ].sort());
  for (const hidden of ['guardian', 'dateOfBirth', 'finance', 'counsel', 'password', 'token', 'permissions', 'createdBy', 'updatedBy', 'branchId', 'teacherId', String(teacherB.id)]) {
    assert.equal(response.raw.includes(hidden), false, hidden);
  }
  assert.deepEqual((await detail(class8)).data, response.data.filter(row => row.classId === String(class8)));
});

test('same-branch, foreign and missing class objects are indistinguishable concealed 404s without prior list access', async () => {
  const responses = await Promise.all([detail(class10), detail(foreignClass), detail(new mongoose.Types.ObjectId())]);
  for (const response of responses) assert.equal(response.status, 404);
  assert.equal(responses[0].raw, responses[1].raw); assert.equal(responses[1].raw, responses[2].raw);
});

test('tuple integrity rejects class/subject cross-products and section mismatches', async () => {
  assert.equal((await tuple(class8, section8A, math)).status, 200);
  assert.equal((await tuple(class9, section9B, physics)).status, 200);
  for (const [c, s, subject] of [[class8, section8A, physics], [class9, section9B, math], [class8, section8B, math], [class8, section9B, math], [foreignClass, foreignSection, foreignSubject]]) {
    assert.equal((await tuple(c, s, subject)).status, 404);
  }
});

test('multiple assigned sections/subjects under a class remain separate tuples', async () => {
  assert.equal((await create({subjectId: String(physics)})).status, 201);
  assert.equal((await create({sectionId: String(section8B)})).status, 201);
  const response = await detail(class8);
  assert.equal(response.data.length, 3);
  assert.equal((await tuple(class8, section8B, physics)).status, 404);
});

for (const state of ['expired', 'future', 'revoked'] as const) {
  test(`${state} assignment cannot authorize list or detail`, async () => {
    if (state === 'expired') await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(assignment8)}, {$set: {validUntil: new Date(Date.now() - 1000)}});
    if (state === 'future') await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(assignment8)}, {$set: {validFrom: new Date(future())}});
    if (state === 'revoked') assert.equal((await revoke(assignment8)).status, 200);
    assert.equal((await detail(class8)).status, 404);
    assert.equal((await classes()).data.some(row => row.assignmentId === assignment8), false);
  });
}

test('validUntil is exclusive and validFrom is inclusive at the exact server instant', async () => {
  const now = new Date();
  mock.timers.enable({apis: ['Date'], now});
  try {
    await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(assignment8)}, {$set: {validUntil: now}});
    await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(assignment9)}, {$set: {validFrom: now}});
    assert.equal((await detail(class8)).status, 404);
    assert.equal((await detail(class9)).status, 200);
  } finally {mock.timers.reset();}
});

for (const kind of ['missing', 'malformed', 'expired', 'missing session', 'revoked session'] as const) {
  test(`${kind} authentication fails on class and provisioning routes`, async () => {
    let person: Actor | undefined = {...teacherA};
    if (kind === 'missing') person = undefined;
    if (kind === 'malformed') person!.token = 'not-a-token';
    if (kind === 'expired') person!.token = jwt.sign({userId: String(teacherA.id), role: 'teacher'}, secret, {expiresIn: -1});
    if (kind === 'missing session') await Session.deleteMany({token: teacherA.token});
    if (kind === 'revoked session') await Session.updateOne({token: teacherA.token}, {$set: {isRevoked: true}});
    assert.equal((await http('/teacher/classes', person)).status, 401);
    assert.equal((await http('/teacher-assignments', person, 'POST', input())).status, 401);
    assert.equal((await http(`/teacher-assignments/${assignment8}/revoke`, person, 'PATCH', {})).status, 401);
  });
}

for (const state of ['inactive', 'deleted', 'changed role'] as const) {
  test(`${state} Teacher invalidates issued token`, async () => {
    if (state === 'inactive') await User.updateOne({_id: teacherA.id}, {$set: {isActive: false}});
    if (state === 'deleted') await User.deleteOne({_id: teacherA.id});
    if (state === 'changed role') await User.updateOne({_id: teacherA.id}, {$set: {role: 'principal'}});
    assert.equal((await classes()).status, 401); assert.equal((await detail(class8)).status, 401);
  });
}

test('branch reassignment after login removes old scope; missing/inactive branch fails closed', async () => {
  await User.updateOne({_id: teacherA.id}, {$set: {branchId: branchB}});
  assert.equal((await detail(class8)).status, 404); assert.equal((await classes()).data.length, 0);
  await Branch.updateOne({_id: branchB}, {$set: {isActive: false}});
  assert.equal((await classes()).status, 403);
  await User.updateOne({_id: teacherA.id}, {$unset: {branchId: 1}});
  assert.equal((await classes()).status, 403);
});

for (const reference of ['class', 'section', 'subject'] as const) {
  for (const change of ['inactive', 'deleted', 'foreign branch'] as const) {
    test(`${reference} becoming ${change} immediately removes assignment access`, async () => {
      const collection = reference === 'class' ? SchoolClass.collection : reference === 'section' ? Section.collection : Subject.collection;
      const _id = reference === 'class' ? class8 : reference === 'section' ? section8A : math;
      if (change === 'deleted') await collection.deleteOne({_id});
      else await collection.updateOne({_id}, {$set: change === 'inactive' ? {isActive: false} : {
        branchId: branchB, ...(reference === 'subject' ? {name: 'Moved Mathematics'} : {}),
      }});
      assert.equal((await detail(class8)).status, 404);
    });
  }
}

test('section reparenting cannot preserve a stale class tuple', async () => {
  await Section.collection.updateOne({_id: section8A}, {$set: {classId: class9}});
  assert.equal((await detail(class8)).status, 404);
});

test('strict query/body contracts reject every attempted scope override', async () => {
  for (const field of ['teacherId', 'branchId', 'classId', 'sectionId', 'subjectId', 'studentId', 'permissions']) {
    assert.equal((await http(`/teacher/classes?${field}=${class10}`, teacherA)).status, 400);
    assert.equal((await http(`/teacher/classes/${class8}?${field}=${class10}`, teacherA)).status, 400);
    assert.equal((await http('/teacher/classes', teacherA, 'GET', {[field]: String(class10)})).status, 400);
    assert.equal((await http(`/teacher-assignments?${field}=${class10}`, principal, 'POST', input())).status, 400);
  }
  assert.equal((await classes()).data.length, 2);
});

test('malformed IDs return sanitized 400; valid unknown assignment IDs are concealed', async () => {
  for (const bad of ['invalid', '123', 'gggggggggggggggggggggggg']) {
    assert.equal((await detail(bad)).status, 400);
    assert.equal((await http(`/teacher/classes/${class8}/sections/${bad}/subjects/${math}`, teacherA)).status, 400);
    assert.equal((await http(`/teacher/classes/${class8}/sections/${section8A}/subjects/${bad}`, teacherA)).status, 400);
    assert.equal((await revoke(bad)).status, 400);
  }
  assert.equal((await revoke(String(new mongoose.Types.ObjectId()))).status, 404);
});

test('role and permission gates remain independent and current', async () => {
  for (const person of [principal, admin, student]) assert.equal((await classes(person)).status, 403);
  for (const person of [teacherA, teacherB, student]) {
    assert.equal((await create({}, person)).status, 403); assert.equal((await revoke(assignment8, person)).status, 403);
  }
  ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(p => p !== PERMISSIONS.TEACHER_CLASSES_VIEW);
  assert.equal((await classes()).status, 403); assert.equal((await detail(class8)).status, 403);
  ROLE_PERMISSIONS.principal = ROLE_PERMISSIONS.principal.filter(p => p !== PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE);
  assert.equal((await create()).status, 403); assert.equal((await revoke(assignment8)).status, 403);
  assert.equal(ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE), false);
  assert.equal(ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE), false);
  assert.equal(ROLE_PERMISSIONS.super_admin.includes(PERMISSIONS.TEACHER_CLASSES_VIEW), false);
  assert.equal(ROLE_PERMISSIONS.super_admin.includes(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE), true);
});

test('a mistakenly broadened permission never bypasses the explicit role gate', async () => {
  ROLE_PERMISSIONS.teacher.push(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE);
  ROLE_PERMISSIONS.super_admin.push(PERMISSIONS.TEACHER_CLASSES_VIEW);
  assert.equal((await create({}, teacherA)).status, 403);
  assert.equal((await revoke(assignment8, teacherA)).status, 403);
  assert.equal((await classes(admin)).status, 403);
  await assert.rejects(createTeacherAssignment({userId: String(teacherA.id), role: 'teacher'}, input()), {status: 403});
});

test('Super Admin permission removal and Principal branch reassignment are effective on the next write', async () => {
  ROLE_PERMISSIONS.super_admin = ROLE_PERMISSIONS.super_admin.filter(p => p !== PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE);
  assert.equal((await create({}, admin)).status, 403);
  assert.equal((await revoke(assignment8, admin)).status, 403);
  await User.updateOne({_id: principal.id}, {$set: {branchId: branchB}});
  assert.equal((await create()).status, 404);
  assert.equal((await revoke(assignment8)).status, 404);
});

test('private legacy fields on academic sources never appear in list or detail DTOs', async () => {
  const privateFields = {guardianPhone: 'private-guardian', finance: 'private-finance', counseling: 'private-counseling', dateOfBirth: 'private-dob'};
  await SchoolClass.collection.updateOne({_id: class8}, {$set: privateFields});
  await Section.collection.updateOne({_id: section8A}, {$set: privateFields});
  await Subject.collection.updateOne({_id: math}, {$set: privateFields});
  await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(assignment8)}, {$set: privateFields});
  for (const response of [await classes(), await detail(class8), await tuple(class8, section8A, math)]) {
    assert.equal(response.status, 200);
    for (const value of Object.values(privateFields)) assert.equal(response.raw.includes(value), false);
    for (const row of response.data) assert.equal(Object.keys(row).length, 7);
  }
});

test('missing branch is denied and cannot be replaced by a caller branch claim', async () => {
  await Branch.deleteOne({_id: branchA});
  assert.equal((await classes()).status, 403);
  assert.equal((await create()).status, 403);
  assert.equal((await create({}, admin)).status, 403);
});

test('Principal cannot provision/revoke foreign scope; Super Admin derives branch from the target Teacher', async () => {
  const foreignInput = {teacherId: String(foreignTeacher.id), classId: String(foreignClass), sectionId: String(foreignSection), subjectId: String(foreignSubject)};
  assert.equal((await create(foreignInput)).status, 404);
  assert.equal((await revoke(assignment8, foreignPrincipal)).status, 404);
  const result = await create(foreignInput, admin); assert.equal(result.status, 201);
  assert.equal((await classes(foreignTeacher)).data.length, 1);
  const stored = await TeacherAssignment.findById(result.data.assignmentId);
  assert.equal(String(stored?.branchId), String(branchB)); assert.equal(String(stored?.createdBy), String(admin.id));
  assert.equal((await revoke(result.data.assignmentId, admin)).status, 200);
});

test('provisioning references must be eligible and retain their branch/class relationships', async () => {
  for (const extra of [
    {classId: String(foreignClass)}, {sectionId: String(foreignSection)}, {subjectId: String(foreignSubject)},
    {sectionId: String(section9B)}, {teacherId: String(new mongoose.Types.ObjectId())},
  ]) assert.equal((await create(extra)).status, 404);
  for (const person of [principal, student]) assert.equal((await create({teacherId: String(person.id)})).status, 403);
  await User.updateOne({_id: teacherA.id}, {$set: {isActive: false}});
  assert.equal((await create()).status, 403);
});

test('inactive class, section, subject and branch cannot be provisioned', async () => {
  for (const [collection, _id] of [[SchoolClass.collection, class8], [Section.collection, section8A], [Subject.collection, math]] as const) {
    await collection.updateOne({_id}, {$set: {isActive: false}});
    assert.equal((await create()).status, 404);
    await collection.updateOne({_id}, {$set: {isActive: true}});
  }
  await Branch.updateOne({_id: branchA}, {$set: {isActive: false}});
  assert.equal((await create()).status, 403); assert.equal((await create({}, admin)).status, 403);
});

test('provisioning allowlists reject forged fields, invalid dates and malformed IDs', async () => {
  for (const field of ['branchId', 'createdBy', 'updatedBy', 'isActive', 'status', 'revokedAt', '__v', 'permissions', 'studentId']) {
    assert.equal((await create({[field]: String(branchB)})).status, 400);
  }
  for (const field of ['teacherId', 'classId', 'sectionId', 'subjectId']) {
    for (const value of [null, 1, {}, ['invalid'], 'invalid']) assert.equal((await create({[field]: value})).status, 400);
  }
  for (const extra of [
    {validFrom: '2026-02-30T00:00:00Z'}, {validFrom: '2026-01-01'}, {validFrom: 1},
    {validUntil: null}, {validUntil: 'bad'}, {validFrom: future(), validUntil: past()},
    {validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-01-01T00:00:00Z'},
  ]) assert.equal((await create(extra)).status, 400);
  for (const body of [null, [], 'invalid']) assert.equal((await http('/teacher-assignments', principal, 'POST', body)).status, 400);
  assert.equal((await revoke(assignment8, principal, {isActive: true})).status, 400);
});

test('database uniqueness arbitrates simultaneous creates; expired/future active slots require revocation', async () => {
  assert.equal((await revoke(assignment8)).status, 200);
  const results = await Promise.all(Array.from({length: 6}, () => create()));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 5);
  assert.equal(await TeacherAssignment.countDocuments({teacherId: teacherA.id, classId: class8, isActive: true}), 1);
  const active = results.find(result => result.status === 201)!;
  await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(active.data.assignmentId)}, {$set: {validUntil: new Date(past())}});
  assert.equal((await create({validFrom: future()})).status, 409);
  assert.equal((await revoke(active.data.assignmentId)).status, 200);
  assert.equal((await create({validFrom: future()})).status, 201);
  assert.equal((await create()).status, 409);
});

test('concurrent revocation has one transition and removes authority on the next request', async () => {
  const results = await Promise.all([revoke(assignment8), revoke(assignment8)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await detail(class8)).status, 404);
  const stored = await TeacherAssignment.findById(assignment8);
  assert.equal(stored?.isActive, false); assert.equal(String(stored?.updatedBy), String(principal.id));
  assert.ok(stored?.revokedAt); assert.equal(stored?.__v, 1);
});

test('revocation can remove assignments with unavailable references without granting new authority', async () => {
  await User.updateOne({_id: teacherA.id}, {$set: {isActive: false}});
  await Subject.deleteOne({_id: math});
  assert.equal((await revoke(assignment8)).status, 200);
});

test('Subject names normalize whitespace and prevent case-insensitive branch duplicates', async () => {
  await assert.rejects(Subject.create({branchId: branchA, name: '  MATHEMATICS  '}), {code: 11000});
  const subject = await Subject.create({branchId: branchA, name: '  Social   Studies  '});
  assert.equal(subject.name, 'Social Studies');
  await assert.rejects(Subject.create({branchId: branchA, name: 'social studies'}), {code: 11000});
  assert.ok(await Subject.create({branchId: branchB, name: 'Social Studies'}));
  await assert.rejects(Subject.create({branchId: branchA, name: '   '}));
});

test('index creation failure fails closed and unexpected data errors are sanitized', async () => {
  mock.method(TeacherAssignment.collection, 'createIndex', () => {throw new Error('private-database-internals');});
  const response = await create({subjectId: String(physics)});
  assert.equal(response.status, 500); assert.equal(response.raw.includes('private-database-internals'), false);
  assert.equal(await TeacherAssignment.countDocuments({teacherId: teacherA.id, classId: class8, subjectId: physics}), 0);
  mock.restoreAll();
  mock.method(Subject, 'find', () => {throw new Error('private-database-internals');});
  const read = await classes(); assert.equal(read.status, 500); assert.equal(read.raw.includes('private-database-internals'), false);
});

test('service entry point independently rejects Teacher provisioning and removed permissions', async () => {
  await assert.rejects(createTeacherAssignment({userId: String(teacherA.id), role: 'teacher'}, input()), {status: 403});
  ROLE_PERMISSIONS.principal = ROLE_PERMISSIONS.principal.filter(p => p !== PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE);
  await assert.rejects(createTeacherAssignment({userId: String(principal.id), role: 'principal'}, input()), {status: 403});
});

type Roster = {assignment: TeacherAssignmentTuple; students: TeacherRosterStudent[]};
const rosterPath = (c: Id | string = class8, s: Id | string = section8A, sub: Id | string = math) =>
  `/teacher/classes/${c}/sections/${s}/subjects/${sub}/students`;
const roster = (c: Id | string = class8, s: Id | string = section8A, sub: Id | string = math, person = teacherA) =>
  http<Roster>(rosterPath(c, s, sub), person);
const learner = async (name: string, c = class8, s = section8A, b = branchA, active = true) => {
  const person = await actor(name, 'student', b);
  const record = await new Student({
    userId: person.id, branchId: b, classId: c, sectionId: s,
    admissionNumber: name, isActive: active, guardianName: 'private guardian',
    guardianPhone: 'private phone', address: 'private address', dateOfBirth: new Date('2014-01-01'),
  }).save();
  await Student.collection.updateOne({_id: record._id}, {$set: {finance: 'private finance', counseling: 'private counseling'}});
  return {id: record._id, userId: person.id};
};

test('roster returns only current assigned enrollment with exact minimal keys and no private records', async () => {
  const own = await learner('own');
  await learner('other-section', class8, section8B);
  await learner('teacher-b-only', class10, section10A);
  await learner('foreign', foreignClass, foreignSection, branchB);
  await learner('inactive', class8, section8A, branchA, false);
  const response = await roster();
  assert.equal(response.status, 200);
  assert.equal(response.cache, 'no-store');
  assert.deepEqual(Object.keys(response.data).sort(), ['assignment', 'students']);
  assert.deepEqual(response.data.students, [{studentId: String(own.id), fullName: 'own', admissionNumber: 'OWN'}]);
  assert.deepEqual(Object.keys(response.data.students[0]).sort(), ['admissionNumber', 'fullName', 'studentId']);
  assert.deepEqual(Object.keys(response.data.assignment).sort(),
    ['assignmentId', 'classId', 'className', 'sectionId', 'sectionName', 'subjectId', 'subjectName'].sort());
  for (const value of ['private', 'guardian', 'dateOfBirth', 'finance', 'counseling', 'password', 'email', 'permissions', 'userId', 'branchId']) {
    assert.equal(response.raw.includes(value), false, value);
  }
  // A shared tuple legitimately gives both Teachers the same membership.
  assert.deepEqual((await roster(class8, section8A, math, teacherB)).data.students, response.data.students);
});

test('same branch, Teacher B-only, foreign and every tuple cross-product roster fail concealed', async () => {
  for (const [c, s, sub] of [
    [class10, section10A, math], [foreignClass, foreignSection, foreignSubject],
    [class8, section8B, math], [class8, section8A, physics],
    [class8, section9B, math], [class9, section9B, math],
    [class9, section8A, physics], [class8, section8A, foreignSubject],
  ]) assert.equal((await roster(c, s, sub)).status, 404);
  assert.equal((await roster(class10, section10A, math, teacherB)).status, 200);
});

test('student moves, deactivation and current DB identity changes immediately remove roster membership', async () => {
  const own = await learner('own');
  assert.equal((await roster()).data.students.length, 1);
  await Student.updateOne({_id: own.id}, {$set: {sectionId: section8B}});
  assert.deepEqual((await roster()).data.students, []);
  await Student.updateOne({_id: own.id}, {$set: {sectionId: section8A, classId: class10}});
  assert.deepEqual((await roster()).data.students, []);
  await Student.updateOne({_id: own.id}, {$set: {classId: class8, branchId: branchB}});
  assert.deepEqual((await roster()).data.students, []);
  await Student.updateOne({_id: own.id}, {$set: {branchId: branchA}});
  for (const change of [{isActive: false}, {isActive: true, role: 'teacher'}, {role: 'student', branchId: branchB}]) {
    await User.updateOne({_id: own.userId}, {$set: change});
    assert.deepEqual((await roster()).data.students, []);
  }
  await User.deleteOne({_id: own.userId});
  assert.deepEqual((await roster()).data.students, []);
});

for (const state of ['revoked', 'expired', 'future'] as const) {
  test(`${state} assignment immediately removes roster access`, async () => {
    await learner('own');
    assert.equal((await roster()).status, 200);
    await TeacherAssignment.collection.updateOne({_id: new mongoose.Types.ObjectId(assignment8)}, {$set:
      state === 'revoked' ? {isActive: false} : state === 'expired' ? {validUntil: new Date(past())} : {validFrom: new Date(future())}});
    assert.equal((await roster()).status, 404);
  });
}

for (const state of ['inactive', 'role', 'branch', 'branch inactive', 'permission'] as const) {
  test(`current ${state} change fails closed on roster and independent service call`, async () => {
    const expected = state === 'inactive' || state === 'role' ? 401 : state === 'branch' ? 404 : 403;
    if (state === 'inactive') await User.updateOne({_id: teacherA.id}, {$set: {isActive: false}});
    if (state === 'role') await User.updateOne({_id: teacherA.id}, {$set: {role: 'principal'}});
    if (state === 'branch') await User.updateOne({_id: teacherA.id}, {$set: {branchId: branchB}});
    if (state === 'branch inactive') await Branch.updateOne({_id: branchA}, {$set: {isActive: false}});
    if (state === 'permission') ROLE_PERMISSIONS.teacher = ROLE_PERMISSIONS.teacher.filter(p => p !== PERMISSIONS.TEACHER_CLASSES_VIEW);
    assert.equal((await roster()).status, expected);
    await assert.rejects(getTeacherRoster({userId: String(teacherA.id), role: 'teacher'}, {
      classId: String(class8), sectionId: String(section8A), subjectId: String(math),
    }), {status: expected});
  });
}

test('roster query/body injection never widens scope and malformed tuple IDs are sanitized', async () => {
  for (const field of ['teacherId', 'branchId', 'classId', 'sectionId', 'subjectId', 'studentId', 'permissions']) {
    assert.equal((await http(`${rosterPath()}?${field}=${teacherB.id}`, teacherA)).status, 400);
    assert.equal((await http(rosterPath(), teacherA, 'GET', {[field]: String(teacherB.id)})).status, 400);
  }
  for (const bad of ['invalid', '123', 'gggggggggggggggggggggggg']) {
    for (const path of [rosterPath(bad), rosterPath(class8, bad), rosterPath(class8, section8A, bad)]) {
      const result = await http(path, teacherA);
      assert.equal(result.status, 400); assert.equal(result.raw.includes('CastError'), false);
    }
  }
  assert.equal((await roster(new mongoose.Types.ObjectId())).status, 404);
});

test('roster has independent authentication/role gates and no guessed learner detail surface', async () => {
  assert.equal((await http(rosterPath(), undefined)).status, 401);
  for (const person of [principal, admin, student]) assert.equal((await http(rosterPath(), person)).status, 403);
  await Session.updateOne({token: teacherA.token}, {$set: {isRevoked: true}});
  assert.equal((await roster()).status, 401);
  const outside = await learner('outside', class10, section10A);
  assert.equal((await fetch(`${base}/teacher/students/${outside.id}`, {headers: {Authorization: `Bearer ${teacherB.token}`}})).status, 404);
});

test('roster reference changes invalidate authority and DB failure is sanitized', async () => {
  await Section.collection.updateOne({_id: section8A}, {$set: {classId: class10}});
  assert.equal((await roster()).status, 404);
  await Section.collection.updateOne({_id: section8A}, {$set: {classId: class8}});
  mock.method(Student, 'aggregate', () => { throw new Error('private-database-internals'); });
  const result = await roster();
  assert.equal(result.status, 500); assert.equal(result.raw.includes('private-database-internals'), false);
});

test('roster resolves scope once and executes one aggregate regardless of learner count', async () => {
  await Promise.all(Array.from({length: 12}, (_, i) => learner(`learner-${i}`)));
  const aggregate = mock.method(Student, 'aggregate');
  const assignments = mock.method(TeacherAssignment, 'find');
  const result = await roster();
  assert.equal(result.status, 200); assert.equal(result.data.students.length, 12);
  assert.equal(aggregate.mock.callCount(), 1); assert.equal(assignments.mock.callCount(), 1);
});
