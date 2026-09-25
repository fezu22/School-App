import { Schema, oid, model } from "./base.js";
export const Lecture = model("Lecture", {
  title: String,
  classId: { ...oid, ref: "SchoolClass" },
  branchId: { ...oid, ref: "Branch" },
  subject: String,
  transcript: String,
  createdBy: { ...oid, ref: "User" },
  state: {
    type: String,
    enum: ["DRAFT", "PROCESSING", "READY", "FAILED", "PUBLISHED"],
    default: "DRAFT",
  },
  summary: String,
  topics: [String],
  homework: String,
  questions: [
    {
      prompt: String,
      options: [String],
      correctIndex: Number,
      explanation: String,
    },
  ],
  failure: String,
  assignmentId: { ...oid, ref: "Assignment" },
});
