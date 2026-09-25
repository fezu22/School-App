import { Schema, oid, model } from "./base.js";
import { ROLES } from "../config/roles.js";
export const User = model("User", {
  name: String,
  email: { type: String, unique: true, lowercase: true },
  passwordHash: { type: String, select: false },
  role: { type: String, enum: ROLES },
  active: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: true },
  tokenVersion: { type: Number, default: 0 },
  branchIds: [Schema.Types.ObjectId],
  classIds: [Schema.Types.ObjectId],
  studentIds: [Schema.Types.ObjectId],
  subjectNames: [String],
});
