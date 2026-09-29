import { Schema, oid, model } from "./base.js";
export const Invoice = model("Invoice", {
  studentId: { ...oid, ref: "Student" },
  branchId: { ...oid, ref: "Branch" },
  title: String,
  amount: Number,
  paymentRevision: { type: Number, default: 0 },
  dueDate: String,
});
