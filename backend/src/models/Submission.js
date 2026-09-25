import { Schema, oid, model } from "./base.js";
export const Submission = model(
  "Submission",
  {
    assignmentId: { ...oid, ref: "Assignment" },
    studentId: { ...oid, ref: "Student" },
    answer: String,
    aiMarks: Number,
    aiFeedback: String,
    aiState: String,
    marks: Number,
    feedback: String,
    gradedBy: { ...oid, ref: "User" },
    submittedAt: Date,
  },
  [[{ assignmentId: 1, studentId: 1 }, { unique: true }]]
);
