import { Schema, oid, model } from "./base.js";
export const QuizAttempt = model(
  "QuizAttempt",
  {
    lectureId: { ...oid, ref: "Lecture" },
    studentId: { ...oid, ref: "Student" },
    answers: [Number],
    score: Number,
    total: Number,
  },
  [[{ lectureId: 1, studentId: 1 }, { unique: true }]]
);
