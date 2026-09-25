import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { User } from "../models/index.js";
import { auth, route, problem, publicUser } from "../middleware/auth.js";
export const router = Router();
router.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  route(async (req, res) => {
    const data = z
      .object({
        email: z
          .string()
          .email()
          .transform((s) => s.toLowerCase().trim()),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const u = await User.findOne({ email: data.email }).select("+passwordHash");
    if (
      !u ||
      !u.active ||
      !(await bcrypt.compare(data.password, u.passwordHash))
    )
      throw problem(401, "Invalid email or password");
    res.json({
      user: publicUser(u),
      token: jwt.sign(
        { sub: String(u._id), version: u.tokenVersion },
        process.env.JWT_SECRET,
        { algorithm: "HS256", expiresIn: "8h" }
      ),
    });
  })
);
router.get("/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));
router.post(
  "/logout",
  auth,
  route(async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    res.json({ ok: true });
  })
);
router.post(
  "/password",
  auth,
  route(async (req, res) => {
    const data = z
      .object({
        currentPassword: z.string(),
        newPassword: z.string().min(12).max(100),
      })
      .parse(req.body);
    const u = await User.findById(req.user._id).select("+passwordHash");
    if (!(await bcrypt.compare(data.currentPassword, u.passwordHash)))
      throw problem(400, "Current password is incorrect");
    u.passwordHash = await bcrypt.hash(data.newPassword, 12);
    u.mustChangePassword = false;
    u.tokenVersion++;
    await u.save();
    res.json({ ok: true, message: "Password changed. Sign in again." });
  })
);
