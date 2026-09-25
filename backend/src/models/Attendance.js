import { Schema, oid, model } from "./base.js";
export const Attendance = model(
  "Attendance",
  {
    studentId: { ...oid, ref: "Student" },
    classId: { ...oid, ref: "SchoolClass" },
    branchId: { ...oid, ref: "Branch" },
    date: String,
    status: { type: String, enum: ["PRESENT", "ABSENT", "LATE", "EXCUSED"] },
    markedBy: { ...oid, ref: "User" },
  },
  [[{ studentId: 1, date: 1 }, { unique: true }]]
);
