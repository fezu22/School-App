import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import {
  Assignment,
  Branch,
  Invoice,
  Payment,
  QuizAttempt,
  Student,
  User,
} from '../src/models/index.js';
import {
  buildSeedPlan,
  makeCredentialTemplates,
  seedDemoData,
  manifestCollection,
  MANIFEST_KEY,
} from '../scripts/seed-dev.js';
import { resetDemoSeed } from '../scripts/reset-seed-dev.js';

const password = 'Demo-Test-Password-448!';
let mongo;
let accounts;
let plan;
let planIds;
const passwordOverrides = new Map();
const tokenCache = new Map();

async function tokenFor(email, expectedStatus = 200) {
  if (expectedStatus === 200 && tokenCache.has(email))
    return tokenCache.get(email);
  const result = await request(app)
    .post('/auth/login')
    .send({ email, password: passwordOverrides.get(email) || password });
  assert.equal(result.status, expectedStatus, result.text);
  if (expectedStatus === 200) tokenCache.set(email, result.body.token);
  return result.body.token;
}

function call(token, method, url) {
  return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

before(async () => {
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEMO_SEED = 'true';
  process.env.JWT_SECRET = 'isolated-test-secret-which-is-long-enough';
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14' },
    replSet: { count: 1 },
  });
  const uri = mongo.getUri('school_platform_test_demo');
  process.env.DEMO_MONGODB_URI = uri;
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  accounts = await Promise.all(
    makeCredentialTemplates().map(async account => ({
      ...account,
      passwordHash: await bcrypt.hash(password, 4),
    })),
  );
  plan = await buildSeedPlan('2026-09-25', accounts);
  planIds = {
    studentAva: plan.documents.students.find(row => row.name === 'Ava Student')
      ._id,
    studentMia: plan.documents.students.find(row => row.name === 'Mia Student')
      ._id,
    studentEli: plan.documents.students.find(row => row.name === 'Eli Student')
      ._id,
    quizLecture: plan.documents.lectures.find(row => row.state === 'PUBLISHED')
      ._id,
    draftAssignment: plan.documents.assignments.find(row => !row.published)._id,
    publishedAssignment: plan.documents.assignments.find(row =>
      row.title.includes('Shapes Review'),
    )._id,
  };
  await seedDemoData({
    credentials: accounts,
    anchorDate: new Date('2026-09-25T00:00:00Z'),
  });
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('seed is repeatable, complete, and has valid relationships and payment totals', async () => {
  const firstCounts = await Promise.all([
    Branch.countDocuments(),
    Student.countDocuments(),
    User.countDocuments(),
    Assignment.countDocuments(),
    Invoice.countDocuments(),
    Payment.countDocuments(),
  ]);
  assert.deepEqual(firstCounts, [2, 12, 15, 5, 5, 3]);
  const mia = await User.findOne({ email: 'student.mia@example.com' }).select(
    '+passwordHash',
  );
  const original = {
    passwordHash: mia.passwordHash,
    active: mia.active,
    mustChangePassword: mia.mustChangePassword,
    tokenVersion: mia.tokenVersion,
  };
  const customHash = await bcrypt.hash('Custom-Password-Survives-448!', 4);
  await User.updateOne(
    { _id: mia._id },
    {
      $set: {
        passwordHash: customHash,
        active: false,
        mustChangePassword: true,
        tokenVersion: 9,
      },
    },
  );
  const eli = await User.findOne({ email: 'student.eli@example.com' });
  const noah = await User.findOne({ email: 'student.noah@example.com' });
  // Recreate the two exact mappings written by the old fixture's index-based bug.
  await User.updateOne(
    { _id: mia._id },
    { $set: { studentIds: [plan.documents.students[6]._id] } },
  );
  await User.updateOne(
    { _id: eli._id },
    { $set: { studentIds: [plan.documents.students[9]._id] } },
  );
  const customizedNoahLink = plan.documents.students[5]._id;
  await User.updateOne(
    { _id: noah._id },
    { $set: { studentIds: [customizedNoahLink] } },
  );
  const summary = await seedDemoData({
    credentials: accounts,
    anchorDate: new Date('2030-01-01T00:00:00Z'),
  });
  const secondCounts = await Promise.all([
    Branch.countDocuments(),
    Student.countDocuments(),
    User.countDocuments(),
    Assignment.countDocuments(),
    Invoice.countDocuments(),
    Payment.countDocuments(),
  ]);
  assert.deepEqual(secondCounts, firstCounts);
  const preserved = await User.findById(mia._id).select('+passwordHash');
  assert.equal(preserved.passwordHash, customHash);
  assert.equal(preserved.active, false);
  assert.equal(preserved.mustChangePassword, true);
  assert.equal(preserved.tokenVersion, 9);
  assert.deepEqual(preserved.studentIds.map(String), [planIds.studentMia]);
  const repairedEli = await User.findById(eli._id);
  assert.deepEqual(repairedEli.studentIds.map(String), [planIds.studentEli]);
  const customizedNoah = await User.findById(noah._id);
  assert.deepEqual(customizedNoah.studentIds.map(String), [customizedNoahLink]);
  await User.updateOne(
    { _id: noah._id },
    {
      $set: {
        studentIds: [
          plan.documents.students.find(item => item.name === 'Noah Student')
            ._id,
        ],
      },
    },
  );
  assert.equal(summary.activeTeachers, 3);
  assert.equal(summary.disabledAccounts, 2);
  await User.updateOne({ _id: mia._id }, { $set: original });
  const invoice = await Invoice.findById(
    plan.documents.invoices.find(row => row.title.includes('Partially'))._id,
  );
  const paid = await Payment.aggregate([
    { $match: { invoiceId: invoice._id } },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]);
  assert.equal(invoice.paymentRevision, 1);
  assert.equal(paid[0].amount, 300000);
  const linkChecks = await Promise.all([
    Student.countDocuments({
      classId: { $in: plan.documents.classes.map(row => row._id) },
    }),
    Payment.countDocuments({
      invoiceId: { $in: plan.documents.invoices.map(row => row._id) },
    }),
  ]);
  assert.deepEqual(linkChecks, [12, 3]);
  const manifest = await mongoose.connection.db
    .collection(manifestCollection)
    .findOne({ _id: MANIFEST_KEY });
  assert.equal(manifest.anchorDate, '2026-09-25');
  const ownMia = plan.documents.users.find(
    item => item.email === 'student.mia@example.com',
  );
  const ownEli = plan.documents.users.find(
    item => item.email === 'student.eli@example.com',
  );
  assert.deepEqual(ownMia.studentIds, [planIds.studentMia]);
  assert.deepEqual(ownEli.studentIds, [planIds.studentEli]);
  const parents = plan.documents.users.filter(item => item.role === 'PARENT');
  const students = plan.documents.students;
  const studentName = id => students.find(item => item._id === id)?.name;
  assert.deepEqual(
    parents
      .find(item => item.email === 'parent.lee@example.com')
      .studentIds.map(studentName),
    ['Ava Student', 'Leo Reed'],
  );
  assert.equal(
    students.find(
      item =>
        item._id ===
        parents.find(parent => parent.email === 'parent.park@example.com')
          .studentIds[0],
    ).guardianName,
    'Alex Park',
  );
  assert.equal(
    students.find(
      item =>
        item._id ===
        parents.find(parent => parent.email === 'parent.khan@example.com')
          .studentIds[0],
    ).guardianName,
    'Jamie Khan',
  );
  assert.equal(
    plan.documents.users.filter(item => item.role === 'TEACHER' && item.active)
      .length,
    3,
  );
  assert.equal(plan.documents.users.filter(item => !item.active).length, 1);
  assert.equal(
    plan.documents.users.filter(item => item.mustChangePassword).length,
    2,
  );
  assert.equal(
    new Set(plan.documents.attendance.map(item => item.date)).size,
    7,
  );
  assert.ok(
    new Set(plan.documents.attendance.map(item => item.status)).size > 1,
  );
  const parentByName = new Map(parents.map(parent => [parent.name, parent]));
  for (const parent of parents) {
    for (const childId of parent.studentIds) {
      const child = students.find(item => item._id === childId);
      assert.equal(child.guardianName, parentByName.get(parent.name).name);
    }
  }
  assert.equal(
    plan.documents.lectures.find(item => item.state === 'PUBLISHED').title,
    'TEST FIXTURE — not AI-generated — Plant Needs',
  );
  const invoiceByTitle = title =>
    plan.documents.invoices.find(item => item.title.includes(title));
  assert.deepEqual(
    [
      invoiceByTitle('Unpaid').amount,
      invoiceByTitle('Partially').amount,
      invoiceByTitle('Fully').amount,
      invoiceByTitle('Overdue').amount,
      invoiceByTitle('Future').amount,
    ],
    [1000000, 1200000, 500000, 850000, 750000],
  );
  assert.deepEqual(
    [...new Set(plan.documents.payments.map(item => item.method))].sort(),
    ['BANK', 'CASH', 'CHEQUE'],
  );
  assert.deepEqual(
    plan.documents.quizAttempts.map(item => item.score),
    [3, 2, 1],
  );
  assert.ok(
    !plan.documents.quizAttempts.some(
      item => item.studentId === planIds.studentEli,
    ),
    'student Eli remains eligible to take the published quiz',
  );
  for (const row of plan.documents.submissions) {
    const assignment = plan.documents.assignments.find(
      item => item._id === row.assignmentId,
    );
    assert.ok(
      row.marks === undefined ||
        (row.marks >= 0 && row.marks <= assignment.maxMarks),
    );
    const student = plan.documents.students.find(
      item => item._id === row.studentId,
    );
    assert.equal(student.classId, assignment.classId);
  }
  for (const user of plan.documents.users.filter(
    item => item.role === 'TEACHER',
  )) {
    for (const classId of user.classIds) {
      const classroom = plan.documents.classes.find(
        item => item._id === classId,
      );
      assert.ok(user.branchIds.includes(classroom.branchId));
      assert.ok(
        classroom.subjects.some(subject => user.subjectNames.includes(subject)),
      );
    }
  }
  for (const period of plan.documents.timetables) {
    const teacher = plan.documents.users.find(
      user => user._id === period.teacherId,
    );
    const classroom = plan.documents.classes.find(
      item => item._id === period.classId,
    );
    assert.ok(teacher.classIds.includes(classroom._id));
    assert.ok(teacher.subjectNames.includes(period.subject));
  }
});

test('login works and roles cannot escape their assigned data', async () => {
  for (const account of accounts.filter(item => item.active))
    await tokenFor(account.email);
  const adminToken = await tokenFor('school-admin@example.com');
  const anon = await request(app).get('/students');
  assert.equal(anon.status, 401);
  const principal = await tokenFor('principal.north@example.com');
  const northStudents = await call(principal, 'get', '/students');
  assert.equal(northStudents.status, 200, northStudents.text);
  assert.equal(northStudents.body.items.length, 6);
  const classes = await call(principal, 'get', '/classes');
  assert.equal(classes.body.items.length, 2);
  const principalSouth = await tokenFor('principal.south@example.com');
  assert.equal(
    (await call(principalSouth, 'get', '/students')).body.items.length,
    6,
  );
  const mathTeacher = await tokenFor('teacher.math@example.com');
  assert.equal(
    (
      await call(
        mathTeacher,
        'get',
        '/students?classId=' + plan.documents.classes[0]._id,
      )
    ).body.items.length,
    3,
  );
  assert.equal(
    (
      await call(
        mathTeacher,
        'get',
        '/students?classId=' + plan.documents.classes[2]._id,
      )
    ).status,
    403,
  );
  const scienceTeacher = await tokenFor('teacher.science@example.com');
  assert.equal(
    (
      await call(
        scienceTeacher,
        'get',
        '/students?classId=' + plan.documents.classes[1]._id,
      )
    ).body.items.length,
    3,
  );
  const southTeacher = await tokenFor('teacher.south@example.com');
  assert.equal(
    (await call(southTeacher, 'get', '/students')).body.items.length,
    6,
  );
  const child = await tokenFor('student.ava@example.com');
  const ownStudents = await call(child, 'get', '/students');
  assert.equal(ownStudents.body.items.length, 1);
  assert.equal(ownStudents.body.items[0].name, 'Ava Student');
  const assignments = await call(child, 'get', '/assignments');
  assert.equal(assignments.status, 200);
  assert.ok(assignments.body.items.every(item => item.published));
  const forbiddenAdmin = await call(child, 'get', '/admin/users');
  assert.equal(forbiddenAdmin.status, 403);
  const miaToken = await tokenFor('student.mia@example.com');
  assert.equal(
    (await call(miaToken, 'get', '/students')).body.items[0].name,
    'Mia Student',
  );
  const eliToken = await tokenFor('student.eli@example.com');
  assert.equal(
    (await call(eliToken, 'get', '/students')).body.items[0].name,
    'Eli Student',
  );
  await tokenFor('parent.khan@example.com', 401);
  const mustChange = await tokenFor('accountant.south@example.com');
  const blocked = await call(mustChange, 'get', '/dashboard');
  assert.equal(blocked.status, 403);
  const accountantNorth = await tokenFor('accountant.north@example.com');
  const northInvoices = await call(accountantNorth, 'get', '/invoices');
  const expectedNorthStudents = plan.documents.invoices
    .filter(row => row.branchId === plan.documents.branches[0]._id)
    .map(row => String(row.studentId))
    .sort();
  assert.deepEqual(
    northInvoices.body.items.map(row => String(row.studentId._id)).sort(),
    expectedNorthStudents,
  );
  await tokenFor('parent.lee@example.com').then(async parentToken => {
    const all = await call(parentToken, 'get', '/invoices');
    assert.equal(all.body.items.length, 2);
    const selected = await call(parentToken, 'get', '/invoices').set(
      'X-School-Child-ID',
      planIds.studentAva,
    );
    assert.equal(selected.body.items.length, 1);
    const unrelated = await call(parentToken, 'get', '/invoices').set(
      'X-School-Child-ID',
      plan.documents.students.find(student => student.name === 'Ivy Brooks')
        ._id,
    );
    assert.equal(unrelated.status, 403);
    const ownSubmissions = await call(
      parentToken,
      'get',
      `/assignments/${planIds.publishedAssignment}/submissions`,
    ).set('X-School-Child-ID', planIds.studentAva);
    assert.equal(ownSubmissions.body.items.length, 1);
    const classAttendance = await call(parentToken, 'get', '/attendance').set(
      'X-School-Child-ID',
      planIds.studentAva,
    );
    assert.ok(
      classAttendance.body.items.every(
        item => item.studentId._id === planIds.studentAva,
      ),
    );
  });
  const publicLecture = await call(
    eliToken,
    'get',
    '/lectures/' + planIds.quizLecture,
  );
  assert.equal(publicLecture.status, 200);
  assert.equal(publicLecture.body.item.questions[0].correctIndex, undefined);
  const eligibleQuiz = await request(app)
    .post(`/lectures/${planIds.quizLecture}/attempts`)
    .set('Authorization', `Bearer ${eliToken}`)
    .send({ answers: [0, 0, 0] });
  assert.equal(eligibleQuiz.status, 201, eligibleQuiz.text);
  assert.equal(eligibleQuiz.body.item.score, 3);
  planIds.createdQuizAttempt = eligibleQuiz.body.item._id;
  const childAssignments = await call(eliToken, 'get', '/assignments');
  assert.ok(childAssignments.body.items.every(item => item.published));
  assert.equal(
    (
      await call(
        eliToken,
        'get',
        `/assignments/${planIds.draftAssignment}/submissions`,
      )
    ).status,
    403,
  );
});

test('parent temporary-password flow works before child selection and revokes the old session', async () => {
  const email = 'parent.park@example.com';
  const parentToken = await tokenFor(email);
  const account = await User.findOne({ email });
  assert.equal(account.mustChangePassword, true);

  const blockedSchoolData = await call(parentToken, 'get', '/dashboard');
  assert.equal(blockedSchoolData.status, 403);
  assert.equal(blockedSchoolData.body.code, 'PASSWORD_CHANGE_REQUIRED');

  const changedPassword = 'Parent-New-Secure-Password-448!';
  const changed = await request(app)
    .post('/auth/password')
    .set('Authorization', `Bearer ${parentToken}`)
    .send({ currentPassword: password, newPassword: changedPassword });
  assert.equal(changed.status, 200, changed.text);
  const revoked = await call(parentToken, 'get', '/auth/me');
  assert.equal(revoked.status, 401);

  passwordOverrides.set(email, changedPassword);
  tokenCache.delete(email);
  const freshToken = await tokenFor(email);
  const linkedChildren = await call(freshToken, 'get', '/students');
  assert.equal(linkedChildren.status, 200, linkedChildren.text);
  assert.equal(linkedChildren.body.items.length, 1);
  assert.equal(linkedChildren.body.items[0].guardianName, 'Alex Park');
  const persisted = await User.findOne({ email });
  assert.equal(persisted.mustChangePassword, false);
});

test('credential-file account state is synchronized from the persisted demo users', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'school-demo-creds-'));
  const filePath = path.join(folder, '.demo-credentials.json');
  const original = await User.findOne({ email: 'student.mia@example.com' });
  const originalState = {
    active: original.active,
    mustChangePassword: original.mustChangePassword,
    tokenVersion: original.tokenVersion,
  };
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        accounts: accounts.map(account => ({
          ...account,
          password,
        })),
      }),
    );
    await User.updateOne(
      { _id: original._id },
      { $set: { active: false, mustChangePassword: true, tokenVersion: 23 } },
    );
    await seedDemoData({
      credentialFilePath: filePath,
      anchorDate: new Date('2026-09-25T00:00:00Z'),
    });
    const payload = JSON.parse(await readFile(filePath, 'utf8'));
    const synced = payload.accounts.find(
      account => account.email === 'student.mia@example.com',
    );
    assert.equal(synced.active, false);
    assert.equal(synced.mustChangePassword, true);
    assert.equal(synced.password, password);
    assert.equal('tokenVersion' in synced, false);
    assert.equal(
      await User.findById(original._id).then(user => user.tokenVersion),
      23,
    );
  } finally {
    await User.updateOne({ _id: original._id }, { $set: originalState });
    await rm(folder, { recursive: true, force: true });
  }
});

test('reset refuses external references and then deletes only manifest-owned records', async () => {
  const branchId = plan.documents.branches[0]._id;
  const outsideUser = await User.create({
    name: 'Unrelated manual account',
    email: 'manual-external@test.invalid',
    passwordHash: 'not-used',
    role: 'TEACHER',
    branchIds: [branchId],
  });
  await assert.rejects(
    resetDemoSeed(),
    /unrelated User record .* references seed-owned/,
  );
  assert.equal(await Branch.countDocuments(), 2);
  await User.deleteOne({ _id: outsideUser._id });
  await assert.rejects(
    resetDemoSeed(),
    /unrelated QuizAttempt record .*references seed-owned lectures/,
  );
  await QuizAttempt.deleteOne({ _id: planIds.createdQuizAttempt });
  const unrelated = await mongoose.connection
    .collection('unrelated_demo_test')
    .insertOne({ branchId });
  await assert.rejects(
    resetDemoSeed(),
    /unknown collection .* contains a reference to seed-owned/,
  );
  assert.equal(await Branch.countDocuments(), 2);
  await mongoose.connection
    .collection('unrelated_demo_test')
    .deleteOne({ _id: unrelated.insertedId });
  await mongoose.connection
    .collection('unrelated_demo_test')
    .insertOne({ label: 'must remain' });
  const result = await resetDemoSeed();
  assert.ok(result.deleted > 0);
  assert.equal(await Branch.countDocuments(), 0);
  assert.equal(await User.countDocuments(), 0);
  assert.equal(
    await mongoose.connection.db
      .collection(manifestCollection)
      .countDocuments(),
    0,
  );
  assert.equal(
    await mongoose.connection
      .collection('unrelated_demo_test')
      .countDocuments(),
    1,
  );
});

test('seed safety checks reject a non-demo target regardless of MONGODB_URI', async () => {
  const { assertDemoSeedEnvironment } = await import('../scripts/seed-dev.js');
  assert.throws(
    () =>
      assertDemoSeedEnvironment({
        NODE_ENV: 'development',
        ALLOW_DEMO_SEED: 'true',
        DEMO_MONGODB_URI: 'mongodb://localhost/school_platform',
        MONGODB_URI: 'mongodb://localhost/school_platform_demo',
      }),
    /must end with _demo/,
  );
  assert.throws(
    () =>
      assertDemoSeedEnvironment({
        NODE_ENV: 'production',
        ALLOW_DEMO_SEED: 'true',
        DEMO_MONGODB_URI: 'mongodb://localhost/school_platform_demo',
      }),
    /NODE_ENV=development/,
  );
  assert.throws(
    () =>
      assertDemoSeedEnvironment({
        NODE_ENV: 'development',
        ALLOW_DEMO_SEED: 'true',
        DEMO_MONGODB_URI: 'https://localhost/school_platform_demo',
      }),
    /valid MongoDB connection URI/,
  );
  await assert.rejects(
    seedDemoData({
      connection: { name: 'school_platform_test_demo', readyState: 0 },
    }),
    /Connected database does not match/,
  );
});
