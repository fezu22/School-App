import { Schema, oid, model } from "./base.js";
export const Payment = model("Payment", {
  invoiceId: { ...oid, ref: "Invoice" },
  amount: Number,
  method: { type: String, enum: ["CASH", "BANK", "CHEQUE"] },
  reference: String,
  recordedBy: { ...oid, ref: "User" },
  requestKey: { type: String, unique: true },
  allocations: [{ invoiceId: { ...oid, ref: "Invoice" }, dueKey: String, amount: Number }],
  advanceAmount: { type: Number, default: 0 },
  advanceUsed: { type: Number, default: 0 },
});
