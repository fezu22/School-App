import { Schema, oid, model } from "./base.js";
export const Settings = model("Settings", {
  key: { type: String, unique: true },
  schoolName: String,
});
