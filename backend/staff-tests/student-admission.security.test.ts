import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import Student from '../src/staff/src/models/student';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import { AcademicPeriod } from '../src/staff/src/models/academicPeriod';
import {
  StudentEnrollment,
  EnrollmentOperation,
  ensureEnrollmentIndexes,
} from '../src/staff/src/models/studentEnrollment';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { comparePassword } from '../src/staff/src/utils/password';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import { RequestContractError } from '../src/staff/src/utils/request-validation';
let db: MongoMemoryReplSet, server: Server, base: string;
let principal: mongoose.Types.ObjectId,
  branch: mongoose.Types.ObjectId,
  foreign: mongoose.Types.ObjectId;
let period: mongoose.Types.ObjectId,
  classId: mongoose.Types.ObjectId,
  section: mongoose.Types.ObjectId,
  otherClass: mongoose.Types.ObjectId,
  otherSection: mongoose.Types.ObjectId;
let token: string;
const savedJwt = process.env.JWT_SECRET,
  grants = [...ROLE_PERMISSIONS.principal];
before(async () => {
  process.env.JWT_SECRET = 'owned-student-admission-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'student_admission',
    autoIndex: false,
  });
  await Promise.all([
    Student.createIndexes(),
    User.createIndexes(),
    AcademicPeriod.createIndexes(),
    ensureEnrollmentIndexes(),
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/students`;
});
beforeEach(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = [...grants];
  for (const model of [
    Student,
    StudentEnrollment,
    EnrollmentOperation,
    User,
    Session,
    Branch,
    SchoolClass,
    Section,
    AcademicPeriod,
  ])
    await model.collection.deleteMany({});
  branch = (
    await Branch.create({
      name: 'Branch A',
      code: 'AA',
      address: 'Fixture',
      city: 'Fixture',
    })
  )._id;
  foreign = (
    await Branch.create({
      name: 'Branch B',
      code: 'BB',
      address: 'Fixture',
      city: 'Fixture',
    })
  )._id;
  principal = (
    await new User({
      fullName: 'Principal',
      email: 'principal@fixture.invalid',
      password: 'fixture',
      role: 'principal',
      branchId: branch,
    }).save()
  )._id;
  token = generateAccessToken(String(principal), 'principal');
  await registerSession(String(principal), token, 'principal');
  period = (
    await AcademicPeriod.create({
      branchId: branch,
      name: 'Year 2026',
      code: 'AY26',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'active',
      createdBy: principal,
      updatedBy: principal,
    })
  )._id;
  classId = (
    await new SchoolClass({
      branchId: branch,
      name: 'Grade 8',
      code: 'G8',
      academicYear: '2026',
      academicPeriodId: period,
    }).save()
  )._id;
  otherClass = (
    await new SchoolClass({
      branchId: branch,
      name: 'Grade 9',
      code: 'G9',
      academicYear: '2026',
      academicPeriodId: period,
    }).save()
  )._id;
  section = (
    await new Section({
      branchId: branch,
      classId,
      name: 'Section A',
      code: 'A',
    }).save()
  )._id;
  otherSection = (
    await new Section({
      branchId: branch,
      classId: otherClass,
      name: 'Section B',
      code: 'B',
    }).save()
  )._id;
});
after(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = grants;
  if (savedJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedJwt;
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  await mongoose.disconnect();
  if (db) await db.stop();
});
const payload = () => ({
  fullName: 'Ahmed Khan',
  admissionNumber: 'ST-1023',
  email: 'ahmed@fixture.invalid',
  password: 'A-long-fixture-password',
  dateOfBirth: '2012-02-29',
  gender: 'male',
  guardianName: 'Guardian Khan',
  guardianPhone: '+92 300 1234567',
  address: 'School road',
  academicPeriodId: String(period),
  classId: String(classId),
  sectionId: String(section),
  operationId: 'student_admission_case_0001',
});
async function http(
  path: string,
  method = 'GET',
  body?: unknown,
  login = token,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(login ? { Authorization: 'Bearer ' + login } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  assert.equal(raw.includes('E11000'), false);
  assert.equal(raw.includes('private-db-error'), false);
  return { status: response.status, body: JSON.parse(raw), raw };
}
const admit = (extra = {}) =>
  http('/admissions', 'POST', { ...payload(), ...extra });
async function emptyAdmission() {
  assert.equal(await User.countDocuments({ email: payload().email }), 0);
  assert.equal(await Student.countDocuments({}), 0);
  assert.equal(await StudentEnrollment.countDocuments({}), 0);
  assert.equal(await EnrollmentOperation.countDocuments({}), 0);
}
test('own Branch admission commits User, permanent Student, initial enrollment and safe DTO', async () => {
  const result = await admit();
  assert.equal(result.status, 201, result.raw);
  const id = result.body.data.student.id;
  const student = await Student.findById(id).lean();
  assert.ok(student);
  const user = await User.findById(String(student.userId)).lean();
  assert.ok(user);
  assert.equal(user.role, 'student');
  assert.equal(String(user.branchId), String(branch));
  assert.equal(await comparePassword(payload().password, user.password), true);
  assert.notEqual(user.password, payload().password);
  const enrollment = await StudentEnrollment.findOne({ studentId: id }).lean();
  assert.ok(enrollment);
  assert.equal(enrollment.status, 'active');
  assert.equal(String(enrollment.academicPeriodId), String(period));
  assert.equal(result.body.data.initialEnrollment.section.id, String(section));
  for (const key of [
    'password',
    'token',
    'sessions',
    '__v',
    'userId',
    'branchId',
    'createdBy',
  ])
    assert.equal(result.raw.includes('"' + key + '"'), false);
  assert.equal(
    (await http('/' + id + '/profile')).body.data.student.fullName,
    'Ahmed Khan',
  );
  assert.equal(
    (await http('/' + id + '/enrollments')).body.data.history.length,
    1,
  );
  assert.equal((await http('?search=st-1023')).body.data.items.length, 1);
});
test('same operation retries and concurrent requests commit one admission', async () => {
  const results = await Promise.all([admit(), admit()]);
  assert.deepEqual(
    results.map(result => result.status),
    [201, 201],
  );
  assert.equal(
    results[0].body.data.student.id,
    results[1].body.data.student.id,
  );
  assert.equal(await Student.countDocuments({}), 1);
  assert.equal(await StudentEnrollment.countDocuments({}), 1);
  assert.equal(await EnrollmentOperation.countDocuments({}), 1);
  assert.equal((await admit({ fullName: 'Changed Student' })).status, 409);
});
test('duplicate admission number and duplicate email fail cleanly without partial account', async () => {
  assert.equal((await admit()).status, 201);
  assert.equal(
    (
      await admit({
        operationId: 'different_request_0001',
        email: 'another@fixture.invalid',
      })
    ).status,
    409,
  );
  assert.equal(
    await User.countDocuments({ email: 'another@fixture.invalid' }),
    0,
  );
  assert.equal(
    (
      await admit({
        operationId: 'different_request_0002',
        admissionNumber: 'OTHER-100',
      })
    ).status,
    409,
  );
  assert.equal(await Student.countDocuments({}), 1);
});
for (const field of ['academicPeriodId', 'classId', 'sectionId'])
  test(`invalid ${field} rolls back admission`, async () => {
    assert.equal(
      (await admit({ [field]: String(new mongoose.Types.ObjectId()) })).status,
      404,
    );
    await emptyAdmission();
  });
test('Section from another Class is denied', async () => {
  assert.equal((await admit({ sectionId: String(otherSection) })).status, 404);
  await emptyAdmission();
});
test('inactive Period is denied', async () => {
  await AcademicPeriod.updateOne(
    { _id: period },
    { $set: { status: 'closed' } },
  );
  assert.equal((await admit()).status, 409);
  await emptyAdmission();
});
test('foreign Class is denied', async () => {
  await SchoolClass.collection.updateOne(
    { _id: classId },
    { $set: { branchId: foreign } },
  );
  assert.equal((await admit()).status, 404);
  await emptyAdmission();
});
for (const key of ['branchId', 'role', 'userId', 'isActive', 'createdBy'])
  test(`client ${key} cannot grant admission authority`, async () => {
    assert.equal((await admit({ [key]: String(foreign) })).status, 400);
    await emptyAdmission();
  });
for (const extra of [
  { fullName: '' },
  { admissionNumber: '' },
  { email: 'invalid' },
  { password: 'short' },
  { dateOfBirth: '2025-02-30' },
  { dateOfBirth: '2999-01-01' },
  { guardianPhone: 'abc' },
  { gender: ['male'] },
])
  test(
    'invalid profile/account field rejected: ' +
      JSON.stringify(Object.keys(extra)),
    async () => {
      assert.equal((await admit(extra)).status, 400);
      await emptyAdmission();
    },
  );
test('enrollment insertion failure rolls back User and Student', async () => {
  mock.method(StudentEnrollment, 'create', async () => {
    throw new RequestContractError(409, 'Fixture enrollment rejected');
  });
  assert.equal((await admit()).status, 409);
  await emptyAdmission();
});
test('active enrollment uniqueness still prevents duplicate placement', async () => {
  const result = await admit();
  const row = await StudentEnrollment.findOne({
    studentId: result.body.data.student.id,
  }).lean();
  assert.ok(row);
  await assert.rejects(
    StudentEnrollment.create([{ ...row, _id: new mongoose.Types.ObjectId() }]),
    error => (error as { code?: number }).code === 11000,
  );
  assert.equal(await StudentEnrollment.countDocuments({}), 1);
});
const changes = {
  transfer: () =>
    User.collection.updateOne(
      { _id: principal },
      { $set: { branchId: foreign } },
    ),
  demotion: () =>
    User.collection.updateOne(
      { _id: principal },
      { $set: { role: 'teacher' } },
    ),
  disabled: () =>
    User.collection.updateOne(
      { _id: principal },
      { $set: { isActive: false } },
    ),
  revoked: () =>
    Session.collection.updateOne({ token }, { $set: { isRevoked: true } }),
  permission: async () => {
    ROLE_PERMISSIONS.principal = grants.filter(
      permission =>
        permission !== PERMISSIONS.STUDENTS_CREATE &&
        permission !== PERMISSIONS.STUDENTS_UPDATE,
    );
  },
  'enrollment permission': async () => {
    ROLE_PERMISSIONS.principal = grants.filter(
      permission => permission !== PERMISSIONS.ENROLLMENT_MANAGE,
    );
  },
  'inactive Branch': () =>
    Branch.collection.updateOne({ _id: branch }, { $set: { isActive: false } }),
};
for (const [name, change] of Object.entries(changes))
  test(`admission ${name} after provisional Student insert leaves no partial entity or history`, async () => {
    const original = Student.prototype.save;
    let changed = false;
    mock.method(
      Student.prototype,
      'save',
      async function (
        this: InstanceType<typeof Student>,
        ...args: Parameters<typeof original>
      ) {
        const result = await original.apply(this, args);
        if (!changed) {
          changed = true;
          await change();
        }
        return result;
      },
    );
    const result = await admit();
    if (name === 'demotion' || name === 'disabled')
      assert.ok([401, 403].includes(result.status), result.raw);
    else
      assert.equal(result.status, name === 'revoked' ? 401 : 403, result.raw);
    await emptyAdmission();
  });
test('inactive Branch and revoked session denied at entry', async () => {
  await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
  assert.equal((await admit()).status, 403);
  await emptyAdmission();
  await Branch.updateOne({ _id: branch }, { $set: { isActive: true } });
  await Session.updateOne({ token }, { $set: { isRevoked: true } });
  assert.equal((await admit()).status, 401);
});
test('anonymous and non-Principal admission denied', async () => {
  assert.equal((await http('/admissions', 'POST', payload(), '')).status, 401);
  for (const role of ['teacher', 'student', 'super_admin'] as const) {
    const user = await new User({
      fullName: 'Other role',
      email: role + '@fixture.invalid',
      password: 'fixture',
      role,
      ...(role === 'super_admin' ? {} : { branchId: branch }),
    }).save();
    const login = generateAccessToken(String(user._id), role);
    await registerSession(String(user._id), login, role);
    assert.equal(
      (await http('/admissions', 'POST', payload(), login)).status,
      403,
    );
  }
  await emptyAdmission();
});
test('profile edit changes permanent fields only and preserves enrollment documents', async () => {
  const result = await admit();
  const id = result.body.data.student.id;
  const history = await StudentEnrollment.find({}).lean();
  const edited = await http('/' + id + '/profile', 'PATCH', {
    revision: 0,
    fullName: 'Ahmed Updated',
    guardianName: 'Updated Guardian',
    dateOfBirth: '',
    admissionNumber: 'ST-NEW',
  });
  assert.equal(edited.status, 200, edited.raw);
  assert.equal(edited.body.data.student.revision, 1);
  assert.equal(edited.body.data.student.fullName, 'Ahmed Updated');
  assert.equal(edited.body.data.student.dateOfBirth, '');
  assert.deepEqual(await StudentEnrollment.find({}).lean(), history);
  assert.equal(
    (
      await http('/' + id + '/profile', 'PATCH', {
        revision: 0,
        fullName: 'Stale edit',
      })
    ).status,
    409,
  );
});
for (const key of [
  'classId',
  'sectionId',
  'academicPeriodId',
  'status',
  'isActive',
  'role',
  'email',
  'password',
])
  test(`profile endpoint rejects ${key}`, async () => {
    const result = await admit();
    const id = result.body.data.student.id;
    assert.equal(
      (
        await http('/' + id + '/profile', 'PATCH', {
          revision: 0,
          [key]: String(otherClass),
        })
      ).status,
      400,
    );
    assert.equal(
      (await http('/' + id + '/profile')).body.data.student.revision,
      0,
    );
  });
test('foreign and missing profile IDs are concealed for reads and edits', async () => {
  const result = await admit();
  const id = result.body.data.student.id;
  await Student.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { branchId: foreign } },
  );
  for (const target of [id, String(new mongoose.Types.ObjectId())]) {
    assert.equal((await http('/' + target + '/profile')).status, 404);
    assert.equal(
      (
        await http('/' + target + '/profile', 'PATCH', {
          revision: 0,
          fullName: 'Foreign edit',
        })
      ).status,
      404,
    );
  }
});
test('duplicate admission number on profile edit is rejected atomically', async () => {
  const a = await admit(),
    b = await admit({
      email: 'sibling@fixture.invalid',
      admissionNumber: 'SIBLING-2',
      operationId: 'sibling_admission_0001',
    });
  assert.equal(b.status, 201);
  assert.equal(
    (
      await http('/' + b.body.data.student.id + '/profile', 'PATCH', {
        revision: 0,
        fullName: 'Must roll back',
        admissionNumber: a.body.data.student.admissionNumber,
      })
    ).status,
    409,
  );
  assert.equal(
    (await http('/' + b.body.data.student.id + '/profile')).body.data.student
      .fullName,
    'Ahmed Khan',
  );
});
for (const [name, change] of Object.entries(changes).filter(
  ([key]) => key !== 'enrollment permission',
))
  test(`profile ${name} during update preserves complete profile and enrollment history`, async () => {
    const admitted = await admit();
    const id = admitted.body.data.student.id;
    const beforeStudent = await Student.findById(id).lean();
    const beforeHistory = await StudentEnrollment.find({}).lean();
    assert.ok(beforeStudent);
    const beforeUser = await User.findById(String(beforeStudent.userId)).lean();
    const original = Student.updateOne.bind(Student);
    let changed = false;
    mock.method(
      Student,
      'updateOne',
      (...args: Parameters<typeof original>) => {
        const query = original(...args);
        const execute = query.exec.bind(query);
        query.exec = async () => {
          const result = await execute();
          if (!changed) {
            changed = true;
            await change();
          }
          return result;
        };
        return query;
      },
    );
    const result = await http('/' + id + '/profile', 'PATCH', {
      revision: 0,
      fullName: 'Unauthorized edit',
    });
    assert.equal(result.status, name === 'revoked' ? 401 : 403, result.raw);
    assert.deepEqual(await Student.findById(id).lean(), beforeStudent);
    assert.deepEqual(await StudentEnrollment.find({}).lean(), beforeHistory);
    assert.deepEqual(
      await User.findById(String(beforeStudent.userId)).lean(),
      beforeUser,
    );
  });
