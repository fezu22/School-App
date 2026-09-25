import { Schema, oid, model } from "./base.js";
export const Assignment = model("Assignment", {
  title: String,
  instructions: String,
  classId: { ...oid, ref: "SchoolClass" },
  branchId: { ...oid, ref: "Branch" },
  subject: String,
  dueDate: String,
  maxMarks: Number,
  createdBy: { ...oid, ref: "User" },
  published: { type: Boolean, default: false },
  source: { type: String, default: "MANUAL" },
});
