import { Router } from "express";
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

// Mounted at /parent. Only PARENT accounts may use it. Read-only.
export const router = Router();
router.use(allow("PARENT"));

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

// ----- lectures / quizzes -----
async function lectureAccess(user, lectureId) {
  const l = await Lecture.findById(id.parse(lectureId));
  if (!l) throw problem(404, "Lecture not found");
  await getClass(user, l.classId);
  if (l.state !== "PUBLISHED") throw problem(403, "Not published");
  return l;
}
// Parents never see the transcript or the answer key.
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
