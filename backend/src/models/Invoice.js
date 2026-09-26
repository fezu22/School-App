import { Schema, oid, model } from "./base.js";
export const Invoice = model("Invoice", {
  studentId: { ...oid, ref: "Student" },
  branchId: { ...oid, ref: "Branch" },
  planId: { ...oid, ref: "FeePlan" },
  periodKey: String,
  category: String,
  title: String,
  amount: Number,
  discountAmount: { type: Number, default: 0 },
  discountReason: { type: String, default: '' },
  paymentRevision: { type: Number, default: 0 },
  dueDate: String,
  dues: [{ key: String, title: String, amount: Number, dueDate: String }],
  lateFeeType: { type: String, enum: ['NONE', 'FIXED', 'PERCENTAGE'], default: 'NONE' },
  lateFeeAmount: { type: Number, default: 0 },
  lateFeeGraceDays: { type: Number, default: 0 },
  discountKind: { type: String, enum: ['NONE', 'SCHOLARSHIP', 'SIBLING'], default: 'NONE' },
}, [[{ studentId: 1, planId: 1, periodKey: 1 }, { unique: true, partialFilterExpression: { planId: { $exists: true }, periodKey: { $exists: true } } }]]);
