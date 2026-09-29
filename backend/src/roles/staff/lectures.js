import { Router } from "express";
import { z } from "zod";
import {
  Lecture,
  QuizAttempt,
  SchoolClass,
  Assignment,
} from "../../models/index.js";
import {
  allow,
  route,
  problem,
  getClass,
  classFilter,
} from "../../middleware/auth.js";
import { id, text, date } from "../../config/validation.js";
import { audit } from "../../services/audit.js";
import { generateLecture } from "../../services/ai.js";
export const router = Router();
const staff = (u) => ["SUPER_ADMIN", "PRINCIPAL", "TEACHER"].includes(u.role);
async function access(user, lectureId) {
  const l = await Lecture.findById(id.parse(lectureId));
  if (!l) throw problem(404, "Lecture not found");
  await getClass(user, l.classId);
  if (user.role === "TEACHER" && !user.subjectNames.includes(l.subject))
    throw problem(403, "Subject not assigned");
  if (!staff(user) && l.state !== "PUBLISHED")
    throw problem(403, "Not published");
  return l;
}
const sanitize = (l, user) => {
  const value = l.toObject();
  if (!staff(user)) {
    delete value.transcript;
    value.questions = value.questions.map((q) => ({
      prompt: q.prompt,
      options: q.options,
    }));
  }
  return value;
};
router.get(
  "/",
  route(async (req, res) => {
    const classes = await SchoolClass.find(await classFilter(req.user));
    const filter = { classId: { $in: classes.map((c) => c._id) } };
    if (!staff(req.user)) filter.state = "PUBLISHED";
    if (req.user.role === "TEACHER")
      filter.subject = { $in: req.user.subjectNames };
    res.json({
      items: (await Lecture.find(filter).sort({ createdAt: -1 })).map((l) =>
        sanitize(l, req.user)
      ),
    });
  })
);
router.post(
  "/",
  allow("SUPER_ADMIN", "PRINCIPAL", "TEACHER"),
  route(async (req, res) => {
    const data = z
      .object({
        title: text,
        classId: id,
        subject: text,
        transcript: z.string().min(100).max(60000),
      })
      .parse(req.body);
    const c = await getClass(req.user, data.classId);
    if (
      !c.subjects.includes(data.subject) ||
      (req.user.role === "TEACHER" &&
        !req.user.subjectNames.includes(data.subject))
    )
      throw problem(403, "Subject not assigned");
    const item = await Lecture.create({
      ...data,
      branchId: c.branchId,
      createdBy: req.user._id,
    });
    await audit(req.user, "CREATE", "Lecture", item._id, item.branchId);
    res.status(201).json({ item });
  })
);
router.get(
  "/:id",
  route(async (req, res) =>
    res.json({
      item: sanitize(await access(req.user, req.params.id), req.user),
    })
  )
);
router.post(
  "/:id/generate",
  allow("SUPER_ADMIN", "PRINCIPAL", "TEACHER"),
  route(async (req, res) => {
    const l = await access(req.user, req.params.id);
    if (!process.env.LLM_API_KEY || !process.env.LLM_MODEL)
      throw problem(
        503,
        "Configure LLM_API_KEY and LLM_MODEL on the server first"
      );
    if (l.state === "PUBLISHED")
      throw problem(409, "Published lecture cannot be regenerated");
    const updated = await Lecture.findOneAndUpdate(
      { _id: l._id, state: { $ne: "PROCESSING" } },
      { $set: { state: "PROCESSING", failure: "" } },
      { new: true }
    );
    if (!updated) throw problem(409, "Already processing");
    setImmediate(() => generateLecture(l._id).catch(() => {}));
    res.status(202).json({ item: updated });
  })
);
router.post(
  "/:id/publish",
  allow("SUPER_ADMIN", "PRINCIPAL", "TEACHER"),
  route(async (req, res) => {
    const l = await access(req.user, req.params.id);
    if (l.state !== "READY")
      throw problem(409, "Generate and review content first");
    const data = z
      .object({
        dueDate: date,
        maxMarks: z.number().int().min(1).max(1000),
        summary: z.string().min(1).max(10000),
        homework: z.string().min(1).max(10000),
      })
      .parse(req.body);
    const session = await Lecture.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await Lecture.findOne({
          _id: l._id,
          state: "READY",
        }).session(session);
        if (!current) throw problem(409, "Already published");
        const [assignment] = await Assignment.create(
          [
            {
              title: l.title + " — Homework",
              classId: l.classId,
              branchId: l.branchId,
              subject: l.subject,
              instructions: data.homework,
              dueDate: data.dueDate,
              maxMarks: data.maxMarks,
              published: true,
              source: "AI",
              createdBy: req.user._id,
            },
          ],
          { session }
        );
        current.summary = data.summary;
        current.homework = data.homework;
        current.state = "PUBLISHED";
        current.assignmentId = assignment._id;
        await current.save({ session });
      });
    } finally {
      await session.endSession();
    }
    await audit(req.user, "PUBLISH", "Lecture", l._id, l.branchId);
    res.json({ item: await Lecture.findById(l._id) });
  })
);
router.get(
  "/:id/attempts",
  route(async (req, res) => {
    const l = await access(req.user, req.params.id);
    const filter = { lectureId: l._id };
    if (!staff(req.user)) filter.studentId = { $in: req.user.studentIds };
    res.json({
      items: await QuizAttempt.find(filter).populate("studentId", "name"),
    });
  })
);
