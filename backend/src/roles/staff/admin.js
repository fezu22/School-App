import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  User,
  Branch,
  SchoolClass,
  Student,
  ROLES,
  Settings,
  Audit,
} from "../../models/index.js";
import { allow, route, problem, publicUser } from "../../middleware/auth.js";
import { id, text } from "../../config/validation.js";
import { audit } from "../../services/audit.js";
export const router = Router();
// Mounted at /staff/admin, so this guard only covers admin paths.
router.use(allow("SUPER_ADMIN"));
const userInput = z.object({
  name: text,
  email: z
    .string()
    .email()
    .transform((s) => s.trim().toLowerCase()),
  password: z.string().min(12).max(100),
  role: z.enum(ROLES.filter((x) => x !== "SUPER_ADMIN")),
  branchIds: z.array(id).default([]),
  classIds: z.array(id).default([]),
  studentIds: z.array(id).default([]),
  subjectNames: z.array(text).default([]),
});
router.get(
  "/users",
  route(async (_req, res) =>
    res.json({
      items: (await User.find().sort({ name: 1 }).limit(500)).map(publicUser),
    })
  )
);
router.post(
  "/users",
  route(async (req, res) => {
    const { password, ...data } = userInput.parse(req.body);
    if (
      (await Branch.countDocuments({ _id: { $in: data.branchIds } })) !==
      new Set(data.branchIds).size
    )
      throw problem(400, "Invalid branch");
    const classes = await SchoolClass.find({ _id: { $in: data.classIds } });
    if (
      classes.length !== new Set(data.classIds).size ||
      classes.some((c) => !data.branchIds.includes(String(c.branchId)))
    )
      throw problem(400, "Classes must belong to assigned branches");
    if (
      (await Student.countDocuments({ _id: { $in: data.studentIds } })) !==
      new Set(data.studentIds).size
    )
      throw problem(400, "Invalid linked student");
    if (data.role === "STUDENT" && data.studentIds.length !== 1)
      throw problem(400, "Student account must link exactly one student");
    if (data.role === "PARENT" && !data.studentIds.length)
      throw problem(400, "Parent requires verified linked children");
    const u = await User.create({
      ...data,
      passwordHash: await bcrypt.hash(password, 12),
    });
    await audit(req.user, "CREATE", "User", u._id);
    res.status(201).json({ item: publicUser(u) });
  })
);
router.patch(
  "/users/:id/active",
  route(async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const u = await User.findById(id.parse(req.params.id));
    if (!u || u.role === "SUPER_ADMIN")
      throw problem(400, "Cannot change this account");
    u.active = active;
    u.tokenVersion++;
    await u.save();
    await audit(req.user, active ? "ENABLE" : "DISABLE", "User", u._id);
    res.json({ item: publicUser(u) });
  })
);
router.get(
  "/branches",
  route(async (_req, res) =>
    res.json({ items: await Branch.find().sort({ name: 1 }) })
  )
);
router.post(
  "/branches",
  route(async (req, res) => {
    const data = z
      .object({
        name: text,
        address: z.string().max(500).default(""),
        phone: z.string().max(30).default(""),
      })
      .parse(req.body);
    const item = await Branch.create(data);
    await audit(req.user, "CREATE", "Branch", item._id, item._id);
    res.status(201).json({ item });
  })
);
router.put(
  "/branding",
  route(async (req, res) => {
    const data = z.object({ schoolName: text }).parse(req.body);
    await Settings.findOneAndUpdate(
      { key: "school" },
      { $set: data },
      { upsert: true }
    );
    await audit(req.user, "UPDATE", "Settings", "school");
    res.json(data);
  })
);
router.get(
  "/audit",
  route(async (_req, res) =>
    res.json({
      items: await Audit.find()
        .populate("actor", "name")
        .sort({ createdAt: -1 })
        .limit(100),
    })
  )
);
router.patch(
  "/users/:id/scope",
  route(async (req, res) => {
    const data = z
      .object({
        branchIds: z.array(id),
        classIds: z.array(id),
        studentIds: z.array(id),
        subjectNames: z.array(text),
      })
      .parse(req.body);
    const u = await User.findById(id.parse(req.params.id));
    if (!u || u.role === "SUPER_ADMIN")
      throw problem(400, "Cannot edit this account");
    if (
      (await Branch.countDocuments({ _id: { $in: data.branchIds } })) !==
      new Set(data.branchIds).size
    )
      throw problem(400, "Invalid branches");
    const classes = await SchoolClass.find({ _id: { $in: data.classIds } });
    if (
      classes.length !== new Set(data.classIds).size ||
      classes.some((c) => !data.branchIds.includes(String(c.branchId)))
    )
      throw problem(400, "Class branch mismatch");
    if (
      (await Student.countDocuments({ _id: { $in: data.studentIds } })) !==
      new Set(data.studentIds).size
    )
      throw problem(400, "Invalid students");
    if (u.role === "STUDENT" && data.studentIds.length !== 1)
      throw problem(400, "Student account requires exactly one student");
    if (u.role === "PARENT" && !data.studentIds.length)
      throw problem(400, "Parent requires linked children");
    Object.assign(u, data);
    u.tokenVersion++;
    await u.save();
    await audit(req.user, "SCOPE_CHANGE", "User", u._id);
    res.json({ item: publicUser(u) });
  })
);
