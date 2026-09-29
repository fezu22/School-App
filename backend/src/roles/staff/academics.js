import { Router } from "express";
import { z } from "zod";
import {
  SchoolClass,
  Student,
  Attendance,
  Notice,
  Timetable,
  Branch,
  User,
} from "../../models/index.js";
import {
  allow,
  route,
  problem,
  classFilter,
  studentFilter,
  getClass,
  getStudent,
  branchAllowed,
} from "../../middleware/auth.js";
import { id, text, date } from "../../config/validation.js";
import { audit } from "../../services/audit.js";
import { visibleNotices } from "../../services/notices.js";
export const router = Router();
router.get(
  "/dashboard",
  allow("SUPER_ADMIN", "PRINCIPAL"),
  route(async (req, res) => {
    const branchFilter =
      req.user.role === "SUPER_ADMIN"
        ? {}
        : { branchId: { $in: req.user.branchIds } };

    const [
      students,
      classes,
      teachers,
      attendance,
      notices,
    ] = await Promise.all([
      Student.countDocuments(branchFilter),

      SchoolClass.countDocuments(branchFilter),

      User.countDocuments({
        role: "TEACHER",
        active: true,
        ...(req.user.role === "SUPER_ADMIN"
          ? {}
          : { branchIds: { $in: req.user.branchIds } }),
      }),

      Attendance.aggregate([
        { $match: branchFilter },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      Notice.find(branchFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select("title body classId createdAt"),
    ]);

    const attendanceSummary = {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };

    for (const row of attendance) {
      const key = row._id.toLowerCase();

      if (key in attendanceSummary) {
        attendanceSummary[key] = row.count;
      }
    }

    res.json({
      summary: {
        students,
        classes,
        teachers,
        attendance: attendanceSummary,
      },
      recentNotices: notices,
    });
  })
);
router.get(
  "/teachers",
  allow("SUPER_ADMIN", "PRINCIPAL"),
  route(async (req, res) => {
    const scope =
      req.user.role === "SUPER_ADMIN"
        ? {}
        : { branchIds: { $in: req.user.branchIds } };
    res.json({
      items: await User.find({ role: "TEACHER", active: true, ...scope })
        .select("name email")
        .sort({ name: 1 })
        .limit(500),
    });
  })
);
router.get(
  "/branches",
  route(async (req, res) =>
    res.json({
      items: await Branch.find(
        req.user.role === "SUPER_ADMIN"
          ? {}
          : { _id: { $in: req.user.branchIds } }
      ),
    })
  )
);
router.get(
  "/classes",
  route(async (req, res) =>
    res.json({
      items: await SchoolClass.find(await classFilter(req.user))
        .populate("branchId", "name")
        .sort({ name: 1 }),
    })
  )
);
router.post(
  "/classes",
  allow("SUPER_ADMIN", "PRINCIPAL", "ACADEMIC_COORDINATOR"),
  route(async (req, res) => {
    const data = z
      .object({
        name: text,
        section: text,
        session: text,
        branchId: id,
        subjects: z.array(text).default([]),
      })
      .parse(req.body);
    branchAllowed(req.user, data.branchId);
    if (!(await Branch.exists({ _id: data.branchId })))
      throw problem(400, "Branch not found");
    const item = await SchoolClass.create(data);
    await audit(req.user, "CREATE", "Class", item._id, item.branchId);
    res.status(201).json({ item });
  })
);
router.get(
  "/students",
  route(async (req, res) => {
    const filter = await studentFilter(req.user);
    if (req.query.classId) {
      id.parse(req.query.classId);
      await getClass(req.user, req.query.classId);
      filter.classId = req.query.classId;
    }
    res.json({
      items: await Student.find(filter)
        .populate("classId", "name section")
        .sort({ name: 1 }),
    });
  })
);
router.post(
  "/students",
  allow("SUPER_ADMIN", "PRINCIPAL"),
  route(async (req, res) => {
    const data = z
      .object({
        name: text,
        admissionNumber: text,
        classId: id,
        guardianName: text,
        guardianPhone: z.string().max(30),
      })
      .parse(req.body);
    const c = await getClass(req.user, data.classId);
    const item = await Student.create({ ...data, branchId: c.branchId });
    await audit(req.user, "CREATE", "Student", item._id, item.branchId);
    res.status(201).json({ item });
  })
);
router.get(
  "/attendance",
  route(async (req, res) => {
    const filter = {};
    if (req.query.classId) {
      await getClass(req.user, id.parse(req.query.classId));
      filter.classId = req.query.classId;
    }
    if (req.query.date) filter.date = date.parse(req.query.date);
    const students = await Student.find(await studentFilter(req.user)).select(
      "_id"
    );
    filter.studentId = { $in: students.map((s) => s._id) };
    res.json({
      items: await Attendance.find(filter)
        .populate("studentId", "name admissionNumber")
        .sort({ date: -1 })
        .limit(500),
    });
  })
);
router.post(
  "/attendance",
  allow("SUPER_ADMIN", "PRINCIPAL", "TEACHER"),
  route(async (req, res) => {
    const data = z
      .object({
        classId: id,
        date,
        entries: z
          .array(
            z.object({
              studentId: id,
              status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
            })
          )
          .min(1)
          .max(200),
      })
      .parse(req.body);
    const c = await getClass(req.user, data.classId);
    const unique = new Set(data.entries.map((e) => e.studentId));
    if (
      unique.size !== data.entries.length ||
      (await Student.countDocuments({
        _id: { $in: [...unique] },
        classId: c._id,
      })) !== unique.size
    )
      throw problem(400, "Roster does not match class");
    await Attendance.bulkWrite(
      data.entries.map((e) => ({
        updateOne: {
          filter: { studentId: e.studentId, date: data.date },
          update: {
            $set: {
              ...e,
              date: data.date,
              classId: c._id,
              branchId: c.branchId,
              markedBy: req.user._id,
            },
          },
          upsert: true,
        },
      }))
    );
    await audit(req.user, "MARK", "Attendance", c._id, c.branchId);
    res.json({ ok: true });
  })
);
router.get(
  "/notices",
  route(async (req, res) => res.json({ items: await visibleNotices(req.user) }))
);
router.post(
  "/notices",
  allow("SUPER_ADMIN", "PRINCIPAL", "TEACHER"),
  route(async (req, res) => {
    const data = z
      .object({
        title: text,
        body: z.string().min(1).max(5000),
        branchId: id,
        classId: id.optional(),
      })
      .parse(req.body);
    branchAllowed(req.user, data.branchId);
    if (data.classId) {
      const c = await getClass(req.user, data.classId);
      if (String(c.branchId) !== data.branchId)
        throw problem(400, "Class branch mismatch");
    } else if (req.user.role === "TEACHER")
      throw problem(403, "Teacher notice requires assigned class");
    const item = await Notice.create({ ...data, createdBy: req.user._id });
    await audit(req.user, "CREATE", "Notice", item._id, item.branchId);
    res.status(201).json({ item });
  })
);
router.get(
  "/timetable",
  route(async (req, res) => {
    const classes = await SchoolClass.find(await classFilter(req.user));
    res.json({
      items: await Timetable.find({
        classId: { $in: classes.map((c) => c._id) },
      })
        .populate("classId", "name section")
        .sort({ day: 1, start: 1 }),
    });
  })
);
router.post(
  "/timetable",
  allow("SUPER_ADMIN", "PRINCIPAL", "ACADEMIC_COORDINATOR"),
  route(async (req, res) => {
    const data = z
      .object({
        classId: id,
        day: z.enum([
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ]),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        subject: text,
        room: text,
      })
      .parse(req.body);
    if (data.end <= data.start)
      throw problem(400, "End time must be after start");
    const c = await getClass(req.user, data.classId);
    if (
      await Timetable.exists({
        classId: c._id,
        day: data.day,
        start: { $lt: data.end },
        end: { $gt: data.start },
      })
    )
      throw problem(409, "Class timetable overlaps");
    const item = await Timetable.create({ ...data, branchId: c.branchId });
    await audit(req.user, "CREATE", "Timetable", item._id, item.branchId);
    res.status(201).json({ item });
  })
);
