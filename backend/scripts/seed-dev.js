import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { writeFile, readFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
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
} from "../src/models/index.js";

export const MANIFEST_KEY = "school-platform-dev-v1";
export const manifestCollection = "demo_seed_manifests";
const credentialPath = path.resolve(
  process.env.DEMO_CREDENTIALS_PATH ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".demo-credentials.json"),
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
  if (env.NODE_ENV !== "development")
    throw new Error("Demo seed requires NODE_ENV=development.");
  if (env.ALLOW_DEMO_SEED !== "true")
    throw new Error("Set ALLOW_DEMO_SEED=true to enable demo seeding.");
  if (!env.DEMO_MONGODB_URI)
    throw new Error("DEMO_MONGODB_URI is required. MONGODB_URI is never used for seeding.");
  let databaseName;
  try {
    databaseName = new URL(env.DEMO_MONGODB_URI).pathname.replace(/^\//, "");
  } catch {
    throw new Error("DEMO_MONGODB_URI must be a valid MongoDB connection URI.");
  }
  if (!databaseName || !databaseName.endsWith("_demo"))
    throw new Error("DEMO_MONGODB_URI database name must end with _demo.");
  return databaseName;
}

function stableId(name) {
  return createHash("sha256").update(MANIFEST_KEY + ":" + name).digest("hex").slice(0, 24);
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
    ["SUPER_ADMIN", "school-admin@example.com", "School Demo Admin", false, true],
    ["PRINCIPAL", "principal.north@example.com", "Avery Principal", false, true],
    ["PRINCIPAL", "principal.south@example.com", "Morgan Principal", false, true],
    ["TEACHER", "teacher.math@example.com", "Taylor Math", false, true],
    ["TEACHER", "teacher.science@example.com", "Jordan Science", false, false],
    ["TEACHER", "teacher.south@example.com", "Casey South", false, true],
    ["ACCOUNTANT", "accountant.north@example.com", "Riley North", false, true],
    ["ACCOUNTANT", "accountant.south@example.com", "Quinn South", true, true],
    ["STUDENT", "student.ava@example.com", "Ava Student", false, true],
    ["STUDENT", "student.noah@example.com", "Noah Student", false, true],
    ["STUDENT", "student.mia@example.com", "Mia Student", false, true],
    ["STUDENT", "student.eli@example.com", "Eli Student", false, true],
    ["PARENT", "parent.lee@example.com", "Sam Lee", false, true],
    ["PARENT", "parent.park@example.com", "Alex Park", false, true],
    ["PARENT", "parent.khan@example.com", "Jamie Khan", false, true],
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
  const old = new Map((existing?.accounts || []).map((item) => [item.email, item]));
  return makeCredentialTemplates().map((account) => ({
    ...account,
    password: old.get(account.email)?.password || randomBytes(12).toString("base64url"),
  }));
}

export async function buildSeedPlan(anchorDate, accounts) {
  const id = (key) => stableId(key);
  const branches = [
    { _id: id("branch:north"), name: "North Demo Campus", address: "10 Sample Road", phone: "+1-202-555-0101" },
    { _id: id("branch:south"), name: "South Demo Campus", address: "20 Example Avenue", phone: "+1-202-555-0102" },
  ];
  const classes = [
    { _id: id("class:north-1"), name: "Grade 5", section: "A", session: "Demo", branchId: branches[0]._id, subjects: ["Mathematics", "English"] },
    { _id: id("class:north-2"), name: "Grade 5", section: "B", session: "Demo", branchId: branches[0]._id, subjects: ["Science", "Mathematics"] },
    { _id: id("class:south-1"), name: "Grade 6", section: "A", session: "Demo", branchId: branches[1]._id, subjects: ["Science", "English"] },
    { _id: id("class:south-2"), name: "Grade 6", section: "B", session: "Demo", branchId: branches[1]._id, subjects: ["Mathematics", "Science"] },
  ];
  const studentNames = [
    "Ava Student", "Leo Reed", "Ivy Brooks", "Noah Student",
    "Mia Student", "Owen Gray", "Eli Student", "Zoe Perry",
    "Finn Cole", "Nia Patel", "Arlo King", "Uma Shah",
  ];
  const studentIds = studentNames.map((_, i) => id(`student:${i + 1}`));
  const students = studentNames.map((name, i) => {
    const classIndex = Math.floor(i / 3);
    return {
      _id: studentIds[i], name, admissionNumber: `DEMO-${String(i + 1).padStart(3, "0")}`,
      classId: classes[classIndex]._id, branchId: classes[classIndex].branchId,
      guardianName: i < 2 ? "Sam Lee" : i < 4 ? "Alex Park" : "Jamie Khan",
      guardianPhone: `+1-202-555-${String(1100 + i).slice(-4)}`, active: true,
    };
  });
  const userIds = accounts.map((account) => id(`user:${account.email}`));
  const users = accounts.map((account, i) => {
    let scope = {};
    if (account.role === "PRINCIPAL")
      scope.branchIds = [branches[i === 1 ? 0 : 1]._id];
    if (account.role === "TEACHER") {
      const t = i - 3;
      scope = t === 0
        ? { branchIds: [branches[0]._id], classIds: [classes[0]._id], subjectNames: ["Mathematics"] }
        : t === 1
          ? { branchIds: [branches[0]._id], classIds: [classes[1]._id], subjectNames: ["Science"] }
          : { branchIds: [branches[1]._id], classIds: [classes[2]._id, classes[3]._id], subjectNames: ["Science", "Mathematics"] };
    }
    if (account.role === "ACCOUNTANT")
      scope.branchIds = [branches[i === 6 ? 0 : 1]._id];
    if (account.role === "STUDENT") {
      const accountIndex = i - 8;
      scope.studentIds = [studentIds[[0, 3, 6, 9][accountIndex]]];
    }
    if (account.role === "PARENT") {
      const accountIndex = i - 12;
      scope.studentIds = accountIndex === 0 ? studentIds.slice(0, 2) : [studentIds[accountIndex === 1 ? 2 : 3]];
    }
    return {
      _id: userIds[i], name: account.name, email: account.email,
      passwordHash: account.passwordHash, role: account.role,
      active: account.active, mustChangePassword: account.mustChangePassword,
      tokenVersion: 0, branchIds: [], classIds: [], studentIds: [], subjectNames: [],
      ...scope,
    };
  });
  const userId = (email) => userIds[accounts.findIndex((account) => account.email === email)];
  const attendanceDays = recentSchoolDays(anchorDate, 7);
  const statuses = ["PRESENT", "PRESENT", "LATE", "ABSENT", "EXCUSED", "PRESENT", "PRESENT"];
  const attendance = students.flatMap((student, si) => attendanceDays.map((day, di) => ({
    _id: id(`attendance:${student._id}:${day}`),
    studentId: student._id, classId: student.classId, branchId: student.branchId,
    date: day, status: statuses[(si + di) % statuses.length],
    markedBy: userId(["teacher.math@example.com", "teacher.science@example.com", "teacher.south@example.com", "teacher.south@example.com"][Math.floor(si / 3)]),
  })));
  const timetables = [];
  classes.forEach((c, ci) => {
    const teacher = ci === 0 ? 3 : ci === 1 ? 4 : 5;
    const subject = c.subjects[0];
    [["Monday", "09:00", "09:45"], ["Wednesday", "10:00", "10:45"]].forEach(([day, start, end], pi) =>
      timetables.push({
        _id: id(`timetable:${ci}:${pi}`), classId: c._id, branchId: c.branchId,
        day, start, end, subject, room: `Room ${ci + 1}`, teacherId: userIds[teacher],
      }),
    );
  });
  const notices = [
    { _id: id("notice:north"), title: "North Campus Demo Notice", body: "Fictional campus notice for development testing.", branchId: branches[0]._id, createdBy: userId("principal.north@example.com") },
    { _id: id("notice:south"), title: "South Campus Demo Notice", body: "Fictional campus notice for development testing.", branchId: branches[1]._id, createdBy: userId("principal.south@example.com") },
    { _id: id("notice:class-north-1"), title: "Grade 5A Demo Reminder", body: "Bring a ruler for the geometry activity.", branchId: branches[0]._id, classId: classes[0]._id, createdBy: userId("teacher.math@example.com") },
    { _id: id("notice:class-south-1"), title: "Grade 6A Demo Reminder", body: "Review the plant growth notes before class.", branchId: branches[1]._id, classId: classes[2]._id, createdBy: userId("teacher.south@example.com") },
  ];
  const assignments = [
    { key: "draft", title: "TEST DRAFT — Fractions", classIndex: 0, subject: "Mathematics", instructions: "Compare one half and one quarter using a drawing.", dueDate: dateAt(anchorDate, 3), maxMarks: 10, published: false, source: "MANUAL", teacherEmail: "teacher.math@example.com" },
    { key: "past", title: "TEST — Shapes Review", classIndex: 0, subject: "Mathematics", instructions: "Name and describe three two-dimensional shapes.", dueDate: dateAt(anchorDate, -3), maxMarks: 20, published: true, source: "MANUAL", teacherEmail: "teacher.math@example.com" },
    { key: "upcoming", title: "TEST — Living Things", classIndex: 1, subject: "Science", instructions: "Describe two needs shared by plants and animals.", dueDate: dateAt(anchorDate, 5), maxMarks: 20, published: true, source: "MANUAL", teacherEmail: "teacher.science@example.com" },
    { key: "graded", title: "TEST — Plant Observation", classIndex: 2, subject: "Science", instructions: "Record two changes in a fictional seedling.", dueDate: dateAt(anchorDate, -1), maxMarks: 10, published: true, source: "MANUAL", teacherEmail: "teacher.south@example.com" },
  ].map((a) => ({
    _id: id(`assignment:${a.key}`), title: a.title, instructions: a.instructions,
    classId: classes[a.classIndex]._id, branchId: classes[a.classIndex].branchId,
    subject: a.subject, dueDate: a.dueDate, maxMarks: a.maxMarks,
    createdBy: userId(a.teacherEmail), published: a.published, source: a.source,
  }));
  const submissions = [
    { key: "graded-ava", assignmentKey: "past", studentIndex: 0, answer: "A triangle has three sides; a square has four equal sides.", marks: 18, feedback: "Clear comparison with correct side counts." },
    { key: "submitted-leo", assignmentKey: "past", studentIndex: 1, answer: "A circle has no straight sides.", feedback: undefined },
    { key: "graded-mia", assignmentKey: "graded", studentIndex: 6, answer: "The seedling grew taller and opened a new leaf.", marks: 9, feedback: "Good observations in complete sentences." },
  ].map((s) => {
    const assignment = assignments.find((a) => a._id === id(`assignment:${s.assignmentKey}`));
    return {
      _id: id(`submission:${s.key}`), assignmentId: assignment._id,
      studentId: studentIds[s.studentIndex], answer: s.answer,
      ...(s.marks === undefined ? {} : { marks: s.marks, gradedBy: userId(s.studentIndex < 3 ? "teacher.math@example.com" : "teacher.south@example.com") }),
      ...(s.feedback === undefined ? {} : { feedback: s.feedback }),
      submittedAt: new Date(`${dateAt(anchorDate, -2)}T12:00:00.000Z`),
    };
  });
  const lectureIds = [id("lecture:draft"), id("lecture:fixture")];
  const fixtureAssignment = id("assignment:fixture-lecture");
  const lectures = [
    {
      _id: lectureIds[0], title: "TEST DRAFT — Fractions in Recipes",
      classId: classes[0]._id, branchId: branches[0]._id, subject: "Mathematics",
      transcript: "A recipe can be scaled by multiplying each ingredient by the same factor. For example, doubling a recipe means using twice the amount of every ingredient. Fractions help describe amounts smaller than one whole cup.",
      createdBy: userId("teacher.math@example.com"), state: "DRAFT",
      summary: "", topics: [], homework: "", questions: [], failure: "",
    },
    {
      _id: lectureIds[1], title: "TEST FIXTURE — not AI-generated — Plant Needs",
      classId: classes[2]._id, branchId: branches[1]._id, subject: "Science",
      transcript: "Fictional classroom fixture. Plants use light, water, air, and nutrients to grow. Roots take in water and help hold a plant in place. Leaves use light during photosynthesis.",
      createdBy: userId("teacher.south@example.com"), state: "PUBLISHED",
      summary: "TEST FIXTURE — not AI-generated. Roots take in water; leaves use light to help plants grow.",
      topics: ["Plant needs", "Roots", "Leaves"],
      homework: "TEST FIXTURE — Observe a fictional plant diagram and label its roots, stem, and leaves.",
      questions: [
        { prompt: "Which part takes in water?", options: ["Roots", "Petals", "Fruit", "Seeds"], correctIndex: 0, explanation: "Roots take in water from the soil." },
        { prompt: "What do leaves use as an energy source?", options: ["Light", "Sand", "Plastic", "Stone"], correctIndex: 0, explanation: "Leaves use light during photosynthesis." },
        { prompt: "Which part helps hold a plant in place?", options: ["Roots", "Petals", "Fruit", "Pollen"], correctIndex: 0, explanation: "Roots anchor the plant." },
      ],
      failure: "", assignmentId: fixtureAssignment,
    },
  ];
  const fixtureHomeAssignment = {
    _id: fixtureAssignment, title: "TEST FIXTURE — Plant Needs Homework",
    instructions: "TEST FIXTURE — Label the roots, stem, and leaves on the provided fictional plant diagram.",
    classId: classes[2]._id, branchId: branches[1]._id, subject: "Science",
    dueDate: dateAt(anchorDate, 7), maxMarks: 10, createdBy: userId("teacher.south@example.com"),
    published: true, source: "AI",
  };
  assignments.push(fixtureHomeAssignment);
  const quizAnswers = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
  const quizAttempts = quizAnswers.map((answers, i) => ({
    _id: id(`quiz-attempt:${i}`), lectureId: lectureIds[1],
    studentId: studentIds[6 + i], answers,
    score: answers.reduce((total, answer, qi) => total + (answer === lectures[1].questions[qi].correctIndex ? 1 : 0), 0),
    total: lectures[1].questions.length,
  }));
  const invoiceData = [
    { key: "unpaid", studentIndex: 0, amount: 1000000, due: 10, title: "TEST — Unpaid tuition" },
    { key: "partial", studentIndex: 1, amount: 1200000, due: 4, title: "TEST — Partially paid tuition" },
    { key: "paid", studentIndex: 2, amount: 500000, due: -2, title: "TEST — Fully paid tuition" },
    { key: "overdue", studentIndex: 3, amount: 850000, due: -12, title: "TEST — Overdue tuition" },
    { key: "future", studentIndex: 6, amount: 750000, due: 30, title: "TEST — Future tuition" },
  ];
  const invoices = invoiceData.map((item) => ({
    _id: id(`invoice:${item.key}`), studentId: studentIds[item.studentIndex],
    branchId: students[item.studentIndex].branchId, title: item.title,
    amount: item.amount, paymentRevision: item.key === "partial" ? 1 : item.key === "paid" ? 2 : 0,
    dueDate: dateAt(anchorDate, item.due),
  }));
  const payments = [
    { key: "partial-bank", invoiceKey: "partial", amount: 300000, method: "BANK", reference: "DEMO-BANK-001" },
    { key: "paid-cash", invoiceKey: "paid", amount: 200000, method: "CASH", reference: "DEMO-CASH-001" },
    { key: "paid-cheque", invoiceKey: "paid", amount: 300000, method: "CHEQUE", reference: "DEMO-CHEQUE-001" },
  ].map((p) => ({
    _id: id(`payment:${p.key}`), invoiceId: invoices.find((i) => i._id === id(`invoice:${p.invoiceKey}`))._id,
    amount: p.amount, method: p.method, reference: p.reference,
    recordedBy: userId(p.invoiceKey === "partial" || p.invoiceKey === "paid" ? "accountant.north@example.com" : "accountant.south@example.com"),
    requestKey: `school-platform-dev-v1:${p.key}`,
  }));
  const documents = {
    branches, classes, students, users, attendance, timetables, notices,
    assignments, submissions, lectures, quizAttempts, invoices, payments,
  };
  const manifest = Object.fromEntries(Object.entries(documents).map(([name, rows]) => [name, rows.map(({ _id }) => _id)]));
  return { documents, manifest, attendanceDayCount: attendanceDays.length };
}

async function loadOrCreateCredentials() {
  let existing;
  try {
    existing = JSON.parse(await readFile(credentialPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Credentials file exists but is not readable JSON.");
  }
  const accounts = makeCredentials(existing);
  if (existing && accounts.some((account) => !existing.accounts?.some((entry) => entry.email === account.email && entry.password))) {
    throw new Error("Existing demo credentials file is incomplete; refusing to rotate generated test passwords.");
  }
  const payload = {
    warning: "DEVELOPMENT ONLY — fictional accounts for the isolated _demo database.",
    accounts: accounts.map(({ role, email, name, password, mustChangePassword, active }) => ({
      role, email, name, password, mustChangePassword, active,
    })),
  };
  await mkdir(path.dirname(credentialPath), { recursive: true });
  const tempPath = credentialPath + ".tmp";
  await writeFile(tempPath, JSON.stringify(payload, null, 2) + "\n", { flag: "w", mode: 0o600 });
  await rename(tempPath, credentialPath);
  for (const account of accounts) account.passwordHash = await bcrypt.hash(account.password, 12);
  return accounts;
}

export async function seedDemoData({ connection = mongoose.connection, credentials = null, anchorDate = new Date() } = {}) {
  const databaseName = assertDemoSeedEnvironment();
  if (connection.name !== databaseName)
    throw new Error("Connected database does not match DEMO_MONGODB_URI.");
  const manifestStore = connection.db.collection(manifestCollection);
  const previous = await manifestStore.findOne({ _id: MANIFEST_KEY });
  const accounts = credentials || await loadOrCreateCredentials();
  const anchor = previous?.anchorDate || anchorDate.toISOString().slice(0, 10);
  const { documents, manifest, attendanceDayCount } = await buildSeedPlan(anchor, accounts);
  for (const [name, rows] of Object.entries(documents)) {
    const Model = models[name];
    const ids = rows.map((row) => row._id);
    if (previous?.records?.[name]) {
      const owned = new Set(previous.records[name]);
      if (ids.some((recordId) => !owned.has(recordId)) || previous.records[name].some((recordId) => !ids.includes(recordId)))
        throw new Error(`Seed manifest mismatch for ${name}; refusing to overwrite untracked records.`);
    } else {
      const existing = await Model.find({ _id: { $in: ids } }).select("_id").lean();
      if (existing.length) throw new Error(`Untracked records collide with planned demo IDs in ${name}; no changes made.`);
      if (name === "users") {
        const fixtureEmails = documents.users.map((user) => user.email);
        if (await User.exists({ email: { $in: fixtureEmails } }))
          throw new Error("Demo account email already exists outside the seed manifest; no changes made.");
      }
      if (name === "students") {
        const admissions = documents.students.map((student) => student.admissionNumber);
        if (await Student.exists({ admissionNumber: { $in: admissions } }))
          throw new Error("Demo admission number already exists outside the seed manifest; no changes made.");
      }
    }
  }
  if (!previous) {
    await manifestStore.insertOne({
      _id: MANIFEST_KEY, version: 1, anchorDate: anchor, records: manifest,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }
  for (const [name, rows] of Object.entries(documents)) {
    const Model = models[name];
    if (rows.length) {
      await Model.bulkWrite(rows.map((row) => ({
        updateOne: { filter: { _id: row._id }, update: { $set: row }, upsert: true },
      })), { ordered: true });
    }
  }
  await manifestStore.updateOne({ _id: MANIFEST_KEY }, { $set: { records: manifest, updatedAt: new Date() } });
  return {
    database: databaseName, accounts: documents.users.length,
    branches: documents.branches.length, classes: documents.classes.length,
    students: documents.students.length, attendance: documents.attendance.length,
    assignments: documents.assignments.length, submissions: documents.submissions.length,
    lectures: documents.lectures.length, invoices: documents.invoices.length,
    payments: documents.payments.length, attendanceDays: attendanceDayCount,
    credentialsFile: credentialPath,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  let connected = false;
  try {
    const databaseName = assertDemoSeedEnvironment();
    await mongoose.connect(process.env.DEMO_MONGODB_URI);
    connected = true;
    const summary = await seedDemoData();
    console.log("Demo seed completed:", JSON.stringify(summary));
  } catch (error) {
    console.error("Demo seed stopped:", error.message);
    process.exitCode = 1;
  } finally {
    if (connected) await mongoose.disconnect();
  }
}
