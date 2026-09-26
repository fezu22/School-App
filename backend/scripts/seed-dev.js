import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile, readFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  Assignment,
  Attendance,
  Branch,
  Invoice,
  Lecture,
  Notice,
  Payment,
  QuizAttempt,
  SchoolClass,
  Student,
  Submission,
  Timetable,
  User,
} from '../src/models/index.js';

export const MANIFEST_KEY = 'school-platform-dev-v1';
export const manifestCollection = 'demo_seed_manifests';
export const LOCK_KEY = `${MANIFEST_KEY}:mutation-lock`;
const credentialPath = path.resolve(
  process.env.DEMO_CREDENTIALS_PATH ||
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '.demo-credentials.json',
    ),
);
const models = {
  branches: Branch,
  classes: SchoolClass,
  students: Student,
  users: User,
  attendance: Attendance,
  timetables: Timetable,
  notices: Notice,
  assignments: Assignment,
  submissions: Submission,
  lectures: Lecture,
  quizAttempts: QuizAttempt,
  invoices: Invoice,
  payments: Payment,
};

export function assertDemoSeedEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'development')
    throw new Error('Demo seed requires NODE_ENV=development.');
  if (env.ALLOW_DEMO_SEED !== 'true')
    throw new Error('Set ALLOW_DEMO_SEED=true to enable demo seeding.');
  if (!env.DEMO_MONGODB_URI)
    throw new Error(
      'DEMO_MONGODB_URI is required. MONGODB_URI is never used for seeding.',
    );
  let databaseName;
  try {
    const uri = new URL(env.DEMO_MONGODB_URI);
    if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol))
      throw new Error('protocol');
    databaseName = decodeURIComponent(uri.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DEMO_MONGODB_URI must be a valid MongoDB connection URI.');
  }
  if (!databaseName || !databaseName.endsWith('_demo'))
    throw new Error('DEMO_MONGODB_URI database name must end with _demo.');
  return databaseName;
}

export async function withDemoSeedLock(connection, operation) {
  const store = connection.db.collection(manifestCollection);
  const owner = randomUUID();
  const now = new Date();
  const lock = {
    _id: LOCK_KEY,
    owner,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  };
  try {
    await store.insertOne(lock);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const takeover = await store.updateOne(
      { _id: LOCK_KEY, expiresAt: { $lte: now } },
      { $set: { owner, expiresAt: lock.expiresAt } },
    );
    if (!takeover.modifiedCount)
      throw new Error(
        'Another seed/reset operation is running; try again after it finishes.',
      );
  }
  try {
    return await operation();
  } finally {
    await store.deleteOne({ _id: LOCK_KEY, owner });
  }
}

function stableId(name) {
  return createHash('sha256')
    .update(MANIFEST_KEY + ':' + name)
    .digest('hex')
    .slice(0, 24);
}

function dateAt(anchor, offsetDays) {
  const value = new Date(anchor);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function recentSchoolDays(anchor, count) {
  const result = [];
  const day = new Date(anchor);
  while (result.length < count) {
    day.setUTCDate(day.getUTCDate() - 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
      result.push(day.toISOString().slice(0, 10));
  }
  return result.reverse();
}

export function makeCredentialTemplates() {
  const roles = [
    [
      'SUPER_ADMIN',
      'school-admin@example.com',
      'School Demo Admin',
      false,
      true,
    ],
    [
      'PRINCIPAL',
      'principal.north@example.com',
      'Avery Principal',
      false,
      true,
    ],
    [
      'PRINCIPAL',
      'principal.south@example.com',
      'Morgan Principal',
      false,
      true,
    ],
    ['TEACHER', 'teacher.math@example.com', 'Taylor Math', false, true],
    ['TEACHER', 'teacher.science@example.com', 'Jordan Science', false, true],
    ['TEACHER', 'teacher.south@example.com', 'Casey South', false, true],
    ['ACCOUNTANT', 'accountant.north@example.com', 'Riley North', false, true],
    ['ACCOUNTANT', 'accountant.south@example.com', 'Quinn South', true, true],
    ['STUDENT', 'student.ava@example.com', 'Ava Student', false, true],
    ['STUDENT', 'student.noah@example.com', 'Noah Student', false, true],
    ['STUDENT', 'student.mia@example.com', 'Mia Student', false, true],
    ['STUDENT', 'student.eli@example.com', 'Eli Student', false, true],
    ['PARENT', 'parent.lee@example.com', 'Sam Lee', false, true],
    ['PARENT', 'parent.park@example.com', 'Alex Park', false, true],
    ['PARENT', 'parent.khan@example.com', 'Jamie Khan', false, false],
  ];
  return roles.map(([role, email, name, mustChangePassword, active]) => ({
    role,
    email,
    name,
    mustChangePassword,
    active,
  }));
}

function makeCredentials(existing) {
  const old = new Map(
    (existing?.accounts || []).map(item => [item.email, item]),
  );
  return makeCredentialTemplates().map(account => ({
    ...account,
    active: old.get(account.email)?.active ?? account.active,
    mustChangePassword:
      old.get(account.email)?.mustChangePassword ?? account.mustChangePassword,
    password:
      old.get(account.email)?.password || randomBytes(12).toString('base64url'),
  }));
}

async function syncCredentialStates(persistedAccounts) {
  let payload;
  try {
    payload = JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch {
    return;
  }
  const byEmail = new Map(
    persistedAccounts.map(account => [account.email, account]),
  );
  payload.accounts = payload.accounts.map(account => {
    const current = byEmail.get(account.email);
    return current
      ? {
          ...account,
          role: current.role,
          active: current.active,
          mustChangePassword: current.mustChangePassword,
        }
      : account;
  });
  const temporary = credentialPath + '.tmp';
  await writeFile(temporary, JSON.stringify(payload, null, 2) + '\n', {
    flag: 'w',
    mode: 0o600,
  });
  await rename(temporary, credentialPath);
}

export async function buildSeedPlan(anchorDate, accounts) {
  const id = key => stableId(key);
  const branches = [
    {
      _id: id('branch:north'),
      name: 'North Demo Campus',
      address: '10 Sample Road',
      phone: '+1-202-555-0101',
    },
    {
      _id: id('branch:south'),
      name: 'South Demo Campus',
      address: '20 Example Avenue',
      phone: '+1-202-555-0102',
    },
  ];
  const classes = [
    {
      _id: id('class:north-1'),
      name: 'Grade 5',
      section: 'A',
      session: 'Demo',
      branchId: branches[0]._id,
      subjects: ['Mathematics', 'English'],
    },
    {
      _id: id('class:north-2'),
      name: 'Grade 5',
      section: 'B',
      session: 'Demo',
      branchId: branches[0]._id,
      subjects: ['Science', 'Mathematics'],
    },
    {
      _id: id('class:south-1'),
      name: 'Grade 6',
      section: 'A',
      session: 'Demo',
      branchId: branches[1]._id,
      subjects: ['Science', 'English'],
    },
    {
      _id: id('class:south-2'),
      name: 'Grade 6',
      section: 'B',
      session: 'Demo',
      branchId: branches[1]._id,
      subjects: ['Mathematics', 'Science'],
    },
  ];
  const studentFixtures = [
    {
      key: 'ava',
      name: 'Ava Student',
      guardian: 'Sam Lee',
      classKey: 'north-1',
    },
    { key: 'leo', name: 'Leo Reed', guardian: 'Sam Lee', classKey: 'north-1' },
    {
      key: 'ivy',
      name: 'Ivy Brooks',
      guardian: 'Alex Park',
      classKey: 'north-1',
    },
    {
      key: 'noah',
      name: 'Noah Student',
      guardian: 'Jamie Khan',
      classKey: 'north-2',
    },
    {
      key: 'mia',
      name: 'Mia Student',
      guardian: 'Morgan Reed',
      classKey: 'north-2',
    },
    {
      key: 'owen',
      name: 'Owen Gray',
      guardian: 'Morgan Reed',
      classKey: 'north-2',
    },
    {
      key: 'eli',
      name: 'Eli Student',
      guardian: 'Priya Shah',
      classKey: 'south-1',
    },
    {
      key: 'zoe',
      name: 'Zoe Perry',
      guardian: 'Priya Shah',
      classKey: 'south-1',
    },
    {
      key: 'finn',
      name: 'Finn Cole',
      guardian: 'Priya Shah',
      classKey: 'south-1',
    },
    {
      key: 'nia',
      name: 'Nia Patel',
      guardian: 'Chris Patel',
      classKey: 'south-1',
    },
    {
      key: 'arlo',
      name: 'Arlo King',
      guardian: 'Chris Patel',
      classKey: 'south-2',
    },
    {
      key: 'uma',
      name: 'Uma Shah',
      guardian: 'Chris Patel',
      classKey: 'south-2',
    },
  ];
  const studentIds = Object.fromEntries(
    studentFixtures.map(({ key }, i) => [key, id(`student:${i + 1}`)]),
  );
  const classIds = Object.fromEntries(
    ['north-1', 'north-2', 'south-1', 'south-2'].map((key, i) => [
      key,
      classes[i]._id,
    ]),
  );
  const classByKey = Object.fromEntries(
    ['north-1', 'north-2', 'south-1', 'south-2'].map((key, i) => [
      key,
      classes[i],
    ]),
  );
  const branchIds = { north: branches[0]._id, south: branches[1]._id };
  const students = studentFixtures.map((fixture, i) => {
    const classId = classIds[fixture.classKey];
    const classDocument = classes.find(item => item._id === classId);
    return {
      _id: studentIds[fixture.key],
      name: fixture.name,
      admissionNumber: `DEMO-${String(i + 1).padStart(3, '0')}`,
      classId,
      branchId: classDocument.branchId,
      guardianName: fixture.guardian,
      guardianPhone: `+1-202-555-${String(1100 + i).slice(-4)}`,
      active: true,
    };
  });
  const userIds = Object.fromEntries(
    accounts.map(account => [account.email, id(`user:${account.email}`)]),
  );
  const userId = email => userIds[email];
  const accountScopes = {
    'principal.north@example.com': { branchIds: [branchIds.north] },
    'principal.south@example.com': { branchIds: [branchIds.south] },
    'teacher.math@example.com': {
      branchIds: [branchIds.north],
      classIds: [classIds['north-1']],
      subjectNames: ['Mathematics'],
    },
    'teacher.science@example.com': {
      branchIds: [branchIds.north],
      classIds: [classIds['north-2']],
      subjectNames: ['Science'],
    },
    'teacher.south@example.com': {
      branchIds: [branchIds.south],
      classIds: [classIds['south-1'], classIds['south-2']],
      subjectNames: ['Science', 'Mathematics'],
    },
    'accountant.north@example.com': { branchIds: [branchIds.north] },
    'accountant.south@example.com': { branchIds: [branchIds.south] },
    'student.ava@example.com': { studentIds: [studentIds.ava] },
    'student.noah@example.com': { studentIds: [studentIds.noah] },
    'student.mia@example.com': { studentIds: [studentIds.mia] },
    'student.eli@example.com': { studentIds: [studentIds.eli] },
    'parent.lee@example.com': { studentIds: [studentIds.ava, studentIds.leo] },
    'parent.park@example.com': { studentIds: [studentIds.ivy] },
    'parent.khan@example.com': { studentIds: [studentIds.noah] },
  };
  const users = accounts.map(account => {
    const scope = accountScopes[account.email] || {};
    return {
      _id: userId(account.email),
      name: account.name,
      email: account.email,
      passwordHash: account.passwordHash,
      role: account.role,
      active: account.active,
      mustChangePassword: account.mustChangePassword,
      tokenVersion: 0,
      branchIds: [],
      classIds: [],
      studentIds: [],
      subjectNames: [],
      ...scope,
    };
  });
  const attendanceDays = recentSchoolDays(anchorDate, 7);
  const statuses = [
    'PRESENT',
    'PRESENT',
    'LATE',
    'ABSENT',
    'EXCUSED',
    'PRESENT',
    'PRESENT',
  ];
  const attendance = students.flatMap((student, si) =>
    attendanceDays.map((day, di) => ({
      _id: id(`attendance:${student._id}:${day}`),
      studentId: student._id,
      classId: student.classId,
      branchId: student.branchId,
      date: day,
      status: statuses[(si + di) % statuses.length],
      markedBy: userId(
        [
          'teacher.math@example.com',
          'teacher.science@example.com',
          'teacher.south@example.com',
          'teacher.south@example.com',
        ][Math.floor(si / 3)],
      ),
    })),
  );
  const timetables = [];
  classes.forEach((c, ci) => {
    const teacher = [
      'teacher.math@example.com',
      'teacher.science@example.com',
      'teacher.south@example.com',
      'teacher.south@example.com',
    ][ci];
    const subject = c.subjects[0];
    const periods =
      ci === 3
        ? [
            ['Tuesday', '09:00', '09:45'],
            ['Thursday', '10:00', '10:45'],
          ]
        : [
            ['Monday', '09:00', '09:45'],
            ['Wednesday', '10:00', '10:45'],
          ];
    periods.forEach(([day, start, end], pi) =>
      timetables.push({
        _id: id(`timetable:${ci}:${pi}`),
        classId: c._id,
        branchId: c.branchId,
        day,
        start,
        end,
        subject,
        room: `Room ${ci + 1}`,
        teacherId: userId(teacher),
      }),
    );
  });
  const notices = [
    {
      _id: id('notice:north'),
      title: 'North Campus Demo Notice',
      body: 'Fictional campus notice for development testing.',
      branchId: branches[0]._id,
      createdBy: userId('principal.north@example.com'),
    },
    {
      _id: id('notice:south'),
      title: 'South Campus Demo Notice',
      body: 'Fictional campus notice for development testing.',
      branchId: branches[1]._id,
      createdBy: userId('principal.south@example.com'),
    },
    {
      _id: id('notice:class-north-1'),
      title: 'Grade 5A Demo Reminder',
      body: 'Bring a ruler for the geometry activity.',
      branchId: branches[0]._id,
      classId: classes[0]._id,
      createdBy: userId('teacher.math@example.com'),
    },
    {
      _id: id('notice:class-south-1'),
      title: 'Grade 6A Demo Reminder',
      body: 'Review the plant growth notes before class.',
      branchId: branches[1]._id,
      classId: classes[2]._id,
      createdBy: userId('teacher.south@example.com'),
    },
  ];
  const assignments = [
    {
      key: 'draft',
      title: 'TEST DRAFT — Fractions',
      classKey: 'north-1',
      subject: 'Mathematics',
      instructions: 'Compare one half and one quarter using a drawing.',
      dueDate: dateAt(anchorDate, 3),
      maxMarks: 10,
      published: false,
      source: 'MANUAL',
      teacherEmail: 'teacher.math@example.com',
    },
    {
      key: 'past',
      title: 'TEST — Shapes Review',
      classKey: 'north-1',
      subject: 'Mathematics',
      instructions: 'Name and describe three two-dimensional shapes.',
      dueDate: dateAt(anchorDate, -3),
      maxMarks: 20,
      published: true,
      source: 'MANUAL',
      teacherEmail: 'teacher.math@example.com',
    },
    {
      key: 'upcoming',
      title: 'TEST — Living Things',
      classKey: 'north-2',
      subject: 'Science',
      instructions: 'Describe two needs shared by plants and animals.',
      dueDate: dateAt(anchorDate, 5),
      maxMarks: 20,
      published: true,
      source: 'MANUAL',
      teacherEmail: 'teacher.science@example.com',
    },
    {
      key: 'graded',
      title: 'TEST — Plant Observation',
      classKey: 'south-1',
      subject: 'Science',
      instructions: 'Record two changes in a fictional seedling.',
      dueDate: dateAt(anchorDate, -1),
      maxMarks: 10,
      published: true,
      source: 'MANUAL',
      teacherEmail: 'teacher.south@example.com',
    },
  ].map(a => ({
    _id: id(`assignment:${a.key}`),
    title: a.title,
    instructions: a.instructions,
    classId: classByKey[a.classKey]._id,
    branchId: classByKey[a.classKey].branchId,
    subject: a.subject,
    dueDate: a.dueDate,
    maxMarks: a.maxMarks,
    createdBy: userId(a.teacherEmail),
    published: a.published,
    source: a.source,
  }));
  const submissions = [
    {
      key: 'graded-ava',
      assignmentKey: 'past',
      studentKey: 'ava',
      answer: 'A triangle has three sides; a square has four equal sides.',
      marks: 18,
      feedback: 'Clear comparison with correct side counts.',
    },
    {
      key: 'submitted-leo',
      assignmentKey: 'past',
      studentKey: 'leo',
      answer: 'A circle has no straight sides.',
      feedback: undefined,
    },
    {
      key: 'graded-mia',
      assignmentKey: 'graded',
      studentKey: 'eli',
      answer: 'The seedling grew taller and opened a new leaf.',
      marks: 9,
      feedback: 'Good observations in complete sentences.',
    },
  ].map(s => {
    const assignment = assignments.find(
      a => a._id === id(`assignment:${s.assignmentKey}`),
    );
    return {
      _id: id(`submission:${s.key}`),
      assignmentId: assignment._id,
      studentId: studentIds[s.studentKey],
      answer: s.answer,
      ...(s.marks === undefined
        ? {}
        : {
            marks: s.marks,
            gradedBy: userId(
              s.key === 'graded-mia'
                ? 'teacher.south@example.com'
                : 'teacher.math@example.com',
            ),
          }),
      ...(s.feedback === undefined ? {} : { feedback: s.feedback }),
      submittedAt: new Date(`${dateAt(anchorDate, -2)}T12:00:00.000Z`),
    };
  });
  const lectureIds = [id('lecture:draft'), id('lecture:fixture')];
  const fixtureAssignment = id('assignment:fixture-lecture');
  const lectures = [
    {
      _id: lectureIds[0],
      title: 'TEST DRAFT — Fractions in Recipes',
      classId: classes[0]._id,
      branchId: branches[0]._id,
      subject: 'Mathematics',
      transcript:
        'A recipe can be scaled by multiplying each ingredient by the same factor. For example, doubling a recipe means using twice the amount of every ingredient. Fractions help describe amounts smaller than one whole cup.',
      createdBy: userId('teacher.math@example.com'),
      state: 'DRAFT',
      summary: '',
      topics: [],
      homework: '',
      questions: [],
      failure: '',
    },
    {
      _id: lectureIds[1],
      title: 'TEST FIXTURE — not AI-generated — Plant Needs',
      classId: classes[2]._id,
      branchId: branches[1]._id,
      subject: 'Science',
      transcript:
        'Fictional classroom fixture. Plants use light, water, air, and nutrients to grow. Roots take in water and help hold a plant in place. Leaves use light during photosynthesis.',
      createdBy: userId('teacher.south@example.com'),
      state: 'PUBLISHED',
      summary:
        'TEST FIXTURE — not AI-generated. Roots take in water; leaves use light to help plants grow.',
      topics: ['Plant needs', 'Roots', 'Leaves'],
      homework:
        'TEST FIXTURE — Observe a fictional plant diagram and label its roots, stem, and leaves.',
      questions: [
        {
          prompt: 'Which part takes in water?',
          options: ['Roots', 'Petals', 'Fruit', 'Seeds'],
          correctIndex: 0,
          explanation: 'Roots take in water from the soil.',
        },
        {
          prompt: 'What do leaves use as an energy source?',
          options: ['Light', 'Sand', 'Plastic', 'Stone'],
          correctIndex: 0,
          explanation: 'Leaves use light during photosynthesis.',
        },
        {
          prompt: 'Which part helps hold a plant in place?',
          options: ['Roots', 'Petals', 'Fruit', 'Pollen'],
          correctIndex: 0,
          explanation: 'Roots anchor the plant.',
        },
      ],
      failure: '',
      assignmentId: fixtureAssignment,
    },
  ];
  const fixtureHomeAssignment = {
    _id: fixtureAssignment,
    title: 'TEST FIXTURE — Plant Needs Homework',
    instructions:
      'TEST FIXTURE — Label the roots, stem, and leaves on the provided fictional plant diagram.',
    classId: classes[2]._id,
    branchId: branches[1]._id,
    subject: 'Science',
    dueDate: dateAt(anchorDate, 7),
    maxMarks: 10,
    createdBy: userId('teacher.south@example.com'),
    published: true,
    source: 'AI',
  };
  assignments.push(fixtureHomeAssignment);
  const quizAnswers = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
  ];
  const quizAttempts = quizAnswers.map((answers, i) => ({
    _id: id(`quiz-attempt:${i}`),
    lectureId: lectureIds[1],
    studentId: studentIds[['zoe', 'finn', 'nia'][i]],
    answers,
    score: answers.reduce(
      (total, answer, qi) =>
        total + (answer === lectures[1].questions[qi].correctIndex ? 1 : 0),
      0,
    ),
    total: lectures[1].questions.length,
  }));
  const invoiceData = [
    {
      key: 'unpaid',
      studentKey: 'ava',
      amount: 1000000,
      due: 10,
      title: 'TEST — Unpaid tuition',
    },
    {
      key: 'partial',
      studentKey: 'leo',
      amount: 1200000,
      due: 4,
      title: 'TEST — Partially paid tuition',
    },
    {
      key: 'paid',
      studentKey: 'ivy',
      amount: 500000,
      due: -2,
      title: 'TEST — Fully paid tuition',
    },
    {
      key: 'overdue',
      studentKey: 'noah',
      amount: 850000,
      due: -12,
      title: 'TEST — Overdue tuition',
    },
    {
      key: 'future',
      studentKey: 'eli',
      amount: 750000,
      due: 30,
      title: 'TEST — Future tuition',
    },
  ];
  const invoices = invoiceData.map(item => ({
    _id: id(`invoice:${item.key}`),
    studentId: studentIds[item.studentKey],
    branchId: students.find(
      student => student._id === studentIds[item.studentKey],
    ).branchId,
    title: item.title,
    amount: item.amount,
    paymentRevision: item.key === 'partial' ? 1 : item.key === 'paid' ? 2 : 0,
    dueDate: dateAt(anchorDate, item.due),
  }));
  const payments = [
    {
      key: 'partial-bank',
      invoiceKey: 'partial',
      amount: 300000,
      method: 'BANK',
      reference: 'DEMO-BANK-001',
    },
    {
      key: 'paid-cash',
      invoiceKey: 'paid',
      amount: 200000,
      method: 'CASH',
      reference: 'DEMO-CASH-001',
    },
    {
      key: 'paid-cheque',
      invoiceKey: 'paid',
      amount: 300000,
      method: 'CHEQUE',
      reference: 'DEMO-CHEQUE-001',
    },
  ].map(p => ({
    _id: id(`payment:${p.key}`),
    invoiceId: invoices.find(i => i._id === id(`invoice:${p.invoiceKey}`))._id,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    recordedBy: userId(
      p.invoiceKey === 'partial' || p.invoiceKey === 'paid'
        ? 'accountant.north@example.com'
        : 'accountant.south@example.com',
    ),
    requestKey: `school-platform-dev-v1:${p.key}`,
  }));
  const documents = {
    branches,
    classes,
    students,
    users,
    attendance,
    timetables,
    notices,
    assignments,
    submissions,
    lectures,
    quizAttempts,
    invoices,
    payments,
  };
  const manifest = Object.fromEntries(
    Object.entries(documents).map(([name, rows]) => [
      name,
      rows.map(({ _id }) => _id),
    ]),
  );
  return { documents, manifest, attendanceDayCount: attendanceDays.length };
}

async function loadOrCreateCredentials() {
  let existing;
  try {
    existing = JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Credentials file exists but is not readable JSON.');
  }
  const accounts = makeCredentials(existing);
  if (
    existing &&
    accounts.some(
      account =>
        !existing.accounts?.some(
          entry => entry.email === account.email && entry.password,
        ),
    )
  ) {
    throw new Error(
      'Existing demo credentials file is incomplete; refusing to rotate generated test passwords.',
    );
  }
  const payload = {
    warning:
      'DEVELOPMENT ONLY — fictional accounts for the isolated _demo database.',
    accounts: accounts.map(
      ({ role, email, name, password, mustChangePassword, active }) => ({
        role,
        email,
        name,
        password,
        mustChangePassword,
        active,
      }),
    ),
  };
  await mkdir(path.dirname(credentialPath), { recursive: true });
  const tempPath = credentialPath + '.tmp';
  await writeFile(tempPath, JSON.stringify(payload, null, 2) + '\n', {
    flag: 'w',
    mode: 0o600,
  });
  await rename(tempPath, credentialPath);
  for (const account of accounts)
    account.passwordHash = await bcrypt.hash(account.password, 12);
  return accounts;
}

export async function seedDemoData({
  connection = mongoose.connection,
  credentials = null,
  anchorDate = new Date(),
} = {}) {
  const databaseName = assertDemoSeedEnvironment();
  if (
    connection.readyState !== 1 ||
    connection.db?.databaseName !== databaseName
  )
    throw new Error('Connected database does not match DEMO_MONGODB_URI.');
  return withDemoSeedLock(connection, async () => {
    const manifestStore = connection.db.collection(manifestCollection);
    const previous = await manifestStore.findOne({ _id: MANIFEST_KEY });
    const accounts = credentials || (await loadOrCreateCredentials());
    const anchor =
      previous?.anchorDate || anchorDate.toISOString().slice(0, 10);
    const { documents, manifest, attendanceDayCount } = await buildSeedPlan(
      anchor,
      accounts,
    );
    for (const [name, rows] of Object.entries(documents)) {
      const Model = models[name];
      const ids = rows.map(row => row._id);
      if (previous?.records?.[name]) {
        const owned = new Set(previous.records[name]);
        if (
          ids.some(recordId => !owned.has(recordId)) ||
          previous.records[name].some(recordId => !ids.includes(recordId))
        )
          throw new Error(
            `Seed manifest mismatch for ${name}; refusing to overwrite untracked records.`,
          );
      } else {
        const existing = await Model.find({ _id: { $in: ids } })
          .select('_id')
          .lean();
        if (existing.length)
          throw new Error(
            `Untracked records collide with planned demo IDs in ${name}; no changes made.`,
          );
        if (name === 'users') {
          const fixtureEmails = documents.users.map(user => user.email);
          if (await User.exists({ email: { $in: fixtureEmails } }))
            throw new Error(
              'Demo account email already exists outside the seed manifest; no changes made.',
            );
        }
        if (name === 'students') {
          const admissions = documents.students.map(
            student => student.admissionNumber,
          );
          if (await Student.exists({ admissionNumber: { $in: admissions } }))
            throw new Error(
              'Demo admission number already exists outside the seed manifest; no changes made.',
            );
        }
      }
    }
    if (!previous) {
      await manifestStore.insertOne({
        _id: MANIFEST_KEY,
        version: 1,
        anchorDate: anchor,
        records: manifest,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    for (const [name, rows] of Object.entries(documents)) {
      const Model = models[name];
      if (rows.length) {
        await Model.bulkWrite(
          rows.map(row => {
            if (name !== 'users')
              return {
                updateOne: {
                  filter: { _id: row._id },
                  update: { $set: row },
                  upsert: true,
                },
              };
            return {
              updateOne: {
                filter: { _id: row._id },
                update: { $setOnInsert: row },
                upsert: true,
              },
            };
          }),
          { ordered: true },
        );
      }
    }
    // Correct only the exact legacy fixture links; intentionally customized scopes remain untouched.
    const legacyStudentLinks = {
      'student.mia@example.com': [id('student:7'), studentIds.mia],
      'student.eli@example.com': [id('student:10'), studentIds.eli],
    };
    for (const [email, [legacyStudentId, correctedStudentId]] of Object.entries(
      legacyStudentLinks,
    )) {
      await User.updateOne(
        { _id: userId(email), studentIds: [legacyStudentId] },
        { $set: { studentIds: [correctedStudentId] } },
      );
    }
    await manifestStore.updateOne(
      { _id: MANIFEST_KEY },
      { $set: { records: manifest, updatedAt: new Date() } },
    );
    const persistedAccounts = await User.find({
      _id: { $in: documents.users.map(item => item._id) },
    })
      .select('role active mustChangePassword')
      .lean();
    if (!credentials) await syncCredentialStates(persistedAccounts);
    return {
      database: databaseName,
      accounts: documents.users.length,
      activeAccounts: persistedAccounts.filter(user => user.active).length,
      activeTeachers: persistedAccounts.filter(
        user => user.role === 'TEACHER' && user.active,
      ).length,
      disabledAccounts: persistedAccounts.filter(user => !user.active).length,
      mustChangePassword: persistedAccounts.filter(
        user => user.mustChangePassword,
      ).length,
      branches: documents.branches.length,
      classes: documents.classes.length,
      students: documents.students.length,
      attendance: documents.attendance.length,
      assignments: documents.assignments.length,
      submissions: documents.submissions.length,
      lectures: documents.lectures.length,
      invoices: documents.invoices.length,
      payments: documents.payments.length,
      attendanceDays: attendanceDayCount,
      credentialsFile: credentialPath,
    };
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  let connected = false;
  try {
    const databaseName = assertDemoSeedEnvironment();
    await mongoose.connect(process.env.DEMO_MONGODB_URI);
    connected = true;
    const summary = await seedDemoData();
    console.log('Demo seed completed:', JSON.stringify(summary));
  } catch (error) {
    console.error('Demo seed stopped:', error.message);
    process.exitCode = 1;
  } finally {
    if (connected) await mongoose.disconnect();
  }
}
