import { Schema, oid, model } from "./base.js";
export const Branch = model("Branch", {
  name: { type: String, required: true },
  address: String,
  phone: String,
});
