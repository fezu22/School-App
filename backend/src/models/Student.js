import { Schema, oid, model } from "./base.js";
export const Student = model("Student", {
  name: String,
  admissionNumber: { type: String, unique: true },
  classId: { ...oid, ref: "SchoolClass", required: true },
  branchId: { ...oid, ref: "Branch", required: true },
  guardianName: String,
  guardianPhone: String,
  active: { type: Boolean, default: true },
});
