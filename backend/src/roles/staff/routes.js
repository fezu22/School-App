import { Router } from "express";
import { allow } from "../../middleware/auth.js";
import { ROLES } from "../../config/roles.js";
import { router as academics } from "./academics.js";
import { router as assignments } from "./assignments.js";
import { router as lectures } from "./lectures.js";
import { router as invoices } from "./invoices.js";
import { router as admin } from "./admin.js";

// Every role that is not STUDENT, PARENT or ACCOUNTANT works through /staff.
const OTHER_PORTALS = ["STUDENT", "PARENT", "ACCOUNTANT"];
export const STAFF_ROLES = ROLES.filter((r) => !OTHER_PORTALS.includes(r));

export const router = Router();
router.use(allow(...STAFF_ROLES));
router.use("/admin", admin); // SUPER_ADMIN only: users, branches, branding, audit
router.use("/assignments", assignments);
router.use("/lectures", lectures);
router.use("/invoices", invoices);
router.use("/", academics); // branches, classes, students, attendance, notices, timetable
