import { Schema, oid, model } from "./base.js";
export const Timetable = model("Timetable", {
  classId: { ...oid, ref: "SchoolClass" },
  branchId: { ...oid, ref: "Branch" },
  day: String,
  start: String,
  end: String,
  subject: String,
  room: String,
  teacherId: { ...oid, ref: "User" },
});
