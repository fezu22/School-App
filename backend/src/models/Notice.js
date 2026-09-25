import { Schema, oid, model } from "./base.js";
export const Notice = model("Notice", {
  title: String,
  body: String,
  branchId: { ...oid, ref: "Branch" },
  classId: { ...oid, ref: "SchoolClass" },
  createdBy: { ...oid, ref: "User" },
});
