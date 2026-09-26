import { Schema, oid, model } from "./base.js";
export const Audit = model("Audit", {
  immutableRef: { type: String, unique: true, required: true },
  actor: { ...oid, ref: "User" },
  action: String,
  entity: String,
  entityId: String,
  branchId: { ...oid, ref: "Branch" },
});
