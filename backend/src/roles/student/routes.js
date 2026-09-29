import { Router } from "express";
import { z } from "zod";
import {
  Student,
  Attendance,
  Timetable,
  SchoolClass,
  Assignment,
  Submission,
  Lecture,
  QuizAttempt,
} from "../../models/index.js";
import {
  allow,
  route,
  problem,
  classFilter,
  studentFilter,
  getClass,
} from "../../middleware/auth.js";
import { id } from "../../config/validation.js";
import { listInvoices } from "../../services/invoices.js";
import { visibleNotices } from "../../services/notices.js";

// Mounted at /student. Only STUDENT accounts may use it.
export const router = Router();
router.use(allow("STUDENT"));

router.get(
  "/profile",
  route(async (req, res) =>
    res.json({
      items: await Student.find(await studentFilter(req.user))
        .populate("classId", "name section")
        .sort({ name: 1 }),
    })
  )
);
router.get(
  "/attendance",
  route(async (req, res) =>
    res.json({
      items: await Attendance.find({ studentId: { $in: req.user.studentIds } })
        .populate("studentId", "name admissionNumber")
        .sort({ date: -1 })
        .limit(500),
    })
  )
);
router.get(
  "/timetable",
  route(async (req, res) => {
    const classes = await SchoolClass.find(await classFilter(req.user));
    res.json({
      items: await Timetable.find({ classId: { $in: classes.map((c) => c._id) } })
        .populate("classId", "name section")
        .sort({ day: 1, start: 1 }),
    });
  })
);
router.get(
  "/notices",
  route(async (req, res) => res.json({ items: await visibleNotices(req.user) }))
);
router.get(
  "/invoices",
  route(async (req, res) => res.json({ items: await listInvoices(req.user) }))
);

// ----- assignments -----
async function assignmentAccess(user, assignmentId) {
  const a = await Assignment.findById(id.parse(assignmentId));
  if (!a) throw problem(404, "Assignment not found");
  await getClass(user, a.classId);
  if (!a.published) throw problem(403, "Not published");
  return a;
}
router.get(
  "/assignments",
  route(async (req, res) => {
    const classes = await SchoolClass.find(await classFilter(req.user));
    res.json({
      items: await Assignment.find({
        classId: { $in: classes.map((c) => c._id) },
        published: true,
      })
        .populate("classId", "name section")
        .sort({ createdAt: -1 }),
    });
  })
);
router.get(
  "/assignments/:id/submissions",
  route(async (req, res) => {
    const a = await assignmentAccess(req.user, req.params.id);
    res.json({
      items: await Submission.find({
        assignmentId: a._id,
        studentId: { $in: req.user.studentIds },
      })
        .populate("studentId", "name admissionNumber")
        .select("-aiMarks -aiFeedback -aiState"),
    });
  })
);
router.post(
  "/assignments/:id/submissions",
  route(async (req, res) => {
    const a = await assignmentAccess(req.user, req.params.id);
    const data = z
      .object({ answer: z.string().min(1).max(20000) })
      .parse(req.body);
    const student = await Student.findOne({
      _id: { $in: req.user.studentIds },
      classId: a.classId,
    });
    if (!student) throw problem(403, "Enrollment not linked");
    if (await Submission.exists({ assignmentId: a._id, studentId: student._id }))
      throw problem(409, "Already submitted");
    const item = await Submission.create({
      assignmentId: a._id,
      studentId: student._id,
      answer: data.answer,
      submittedAt: new Date(),
    });
    res.status(201).json({ item });
  })
);

// ----- lectures / quizzes -----
async function lectureAccess(user, lectureId) {
  const l = await Lecture.findById(id.parse(lectureId));
  if (!l) throw problem(404, "Lecture not found");
  await getClass(user, l.classId);
  if (l.state !== "PUBLISHED") throw problem(403, "Not published");
  return l;
}
// Students never see the transcript or the answer key.
const publicLecture = (l) => {
  const value = l.toObject();
  delete value.transcript;
  value.questions = value.questions.map((q) => ({
    prompt: q.prompt,
    options: q.options,
  }));
  return value;
};
router.get(
  "/lectures",
  route(async (req, res) => {
    const classes = await SchoolClass.find(await classFilter(req.user));
    const lectures = await Lecture.find({
      classId: { $in: classes.map((c) => c._id) },
      state: "PUBLISHED",
    }).sort({ createdAt: -1 });
    res.json({ items: lectures.map(publicLecture) });
  })
);
router.get(
  "/lectures/:id",
  route(async (req, res) =>
    res.json({ item: publicLecture(await lectureAccess(req.user, req.params.id)) })
  )
);
router.get(
  "/lectures/:id/attempts",
  route(async (req, res) => {
    const l = await lectureAccess(req.user, req.params.id);
    res.json({
      items: await QuizAttempt.find({
        lectureId: l._id,
        studentId: { $in: req.user.studentIds },
      }).populate("studentId", "name"),
    });
  })
);
router.post(
  "/lectures/:id/attempts",
  route(async (req, res) => {
    const l = await lectureAccess(req.user, req.params.id);
    const student = await Student.findOne({
      _id: { $in: req.user.studentIds },
      classId: l.classId,
    });
    if (!student) throw problem(403, "Student not enrolled");
    const { answers } = z
      .object({
        answers: z.array(z.number().int().min(0).max(3)).length(l.questions.length),
      })
      .parse(req.body);
    const score = answers.reduce(
      (n, a, i) => n + (a === l.questions[i].correctIndex ? 1 : 0),
      0
    );
    const item = await QuizAttempt.create({
      lectureId: l._id,
      studentId: student._id,
      answers,
      score,
      total: l.questions.length,
    });
    res.status(201).json({
      item,
      feedback: l.questions.map((q, i) => ({
        correct: answers[i] === q.correctIndex,
        explanation: q.explanation,
      })),
    });
  })
);
