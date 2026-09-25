import { Schema, oid, model } from "./base.js";
export const Audit = model("Audit", {
  actor: { ...oid, ref: "User" },
  action: String,
  entity: String,
  entityId: String,
  branchId: { ...oid, ref: "Branch" },
});
