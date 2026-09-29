import "dotenv/config";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Assignment,
  Attendance,
  Audit,
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
import { assertDemoSeedEnvironment, MANIFEST_KEY, manifestCollection } from "./seed-dev.js";

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

const references = [
  [SchoolClass, "branchId", "branches", "classes"],
  [Student, "branchId", "branches", "students"],
  [Student, "classId", "classes", "students"],
  [User, "branchIds", "branches", "users"],
  [User, "classIds", "classes", "users"],
  [User, "studentIds", "students", "users"],
  [Attendance, "branchId", "branches", "attendance"],
  [Attendance, "classId", "classes", "attendance"],
  [Attendance, "studentId", "students", "attendance"],
  [Attendance, "markedBy", "users", "attendance"],
  [Timetable, "branchId", "branches", "timetables"],
  [Timetable, "classId", "classes", "timetables"],
  [Timetable, "teacherId", "users", "timetables"],
  [Notice, "branchId", "branches", "notices"],
  [Notice, "classId", "classes", "notices"],
  [Notice, "createdBy", "users", "notices"],
  [Assignment, "branchId", "branches", "assignments"],
  [Assignment, "classId", "classes", "assignments"],
  [Assignment, "createdBy", "users", "assignments"],
  [Submission, "assignmentId", "assignments", "submissions"],
  [Submission, "studentId", "students", "submissions"],
  [Submission, "gradedBy", "users", "submissions"],
  [Lecture, "assignmentId", "assignments", "lectures"],
  [Lecture, "branchId", "branches", "lectures"],
  [Lecture, "classId", "classes", "lectures"],
  [Lecture, "createdBy", "users", "lectures"],
  [QuizAttempt, "lectureId", "lectures", "quizAttempts"],
  [QuizAttempt, "studentId", "students", "quizAttempts"],
  [Invoice, "studentId", "students", "invoices"],
  [Invoice, "branchId", "branches", "invoices"],
  [Payment, "invoiceId", "invoices", "payments"],
  [Payment, "recordedBy", "users", "payments"],
  [Audit, "actor", "users", null],
  [Audit, "branchId", "branches", null],
];

function manifestIds(manifest) {
  if (!manifest || !manifest.records || typeof manifest.records !== "object")
    throw new Error("Demo seed manifest is missing or invalid; nothing was deleted.");
  const owned = new Map();
  for (const [name, ids] of Object.entries(manifest.records)) {
    if (!models[name] || !Array.isArray(ids) || ids.some((id) => !/^[a-f\d]{24}$/i.test(id)))
      throw new Error("Demo seed manifest contains an invalid collection or ID; nothing was deleted.");
    owned.set(name, ids);
  }
  return owned;
}

async function assertNoUnrelatedReferences(owned) {
  for (const [Model, field, targetName, ownerName] of references) {
    const targetIds = owned.get(targetName) || [];
    if (!targetIds.length) continue;
    const filter = { [field]: { $in: targetIds } };
    const ownerIds = ownerName && (owned.get(ownerName) || []);
    if (ownerName) filter._id = { $nin: ownerIds };
    const record = await Model.findOne(filter).select("_id").lean();
    if (record)
      throw new Error(
        `Reset stopped: unrelated ${Model.modelName} record ${record._id} references seed-owned ${targetName}. No seed records were deleted.`,
      );
  }
}

export async function resetDemoSeed({ connection = mongoose.connection } = {}) {
  const databaseName = assertDemoSeedEnvironment();
  if (connection.name !== databaseName)
    throw new Error("Connected database does not match DEMO_MONGODB_URI.");
  const store = connection.db.collection(manifestCollection);
  const manifest = await store.findOne({ _id: MANIFEST_KEY });
  if (!manifest) {
    return { database: databaseName, deleted: 0, message: "No seed manifest; nothing to delete." };
  }
  const owned = manifestIds(manifest);
  await assertNoUnrelatedReferences(owned);

  const order = [
    "payments", "submissions", "quizAttempts", "lectures", "assignments",
    "invoices", "attendance", "timetables", "notices", "students",
    "classes", "users", "branches",
  ];
  let deleted = 0;
  for (const name of order) {
    const ids = owned.get(name) || [];
    if (!ids.length) continue;
    const result = await models[name].deleteMany({ _id: { $in: ids } });
    deleted += result.deletedCount;
  }
  await store.deleteOne({ _id: MANIFEST_KEY });
  return { database: databaseName, deleted };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  let connected = false;
  try {
    const databaseName = assertDemoSeedEnvironment();
    await mongoose.connect(process.env.DEMO_MONGODB_URI);
    connected = true;
    const summary = await resetDemoSeed();
    console.log("Demo reset completed:", JSON.stringify(summary));
  } catch (error) {
    console.error("Demo reset stopped:", error.message);
    process.exitCode = 1;
  } finally {
    if (connected) await mongoose.disconnect();
  }
}
