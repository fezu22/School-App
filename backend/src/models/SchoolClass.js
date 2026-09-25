import { Schema, oid, model } from "./base.js";
export const SchoolClass = model("SchoolClass", {
  name: String,
  section: String,
  session: String,
  branchId: { ...oid, ref: "Branch", required: true },
  subjects: [String],
});
