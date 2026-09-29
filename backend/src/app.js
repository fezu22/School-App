import express from "express";
import helmet from "helmet";
import cors from "cors";
import { ZodError } from "zod";
import { router as authRouter } from "./routes/auth.js";
import { router as studentRouter } from "./roles/student/routes.js";
import { router as parentRouter } from "./roles/parent/routes.js";
import { router as financeRouter } from "./roles/finance/routes.js";
import { router as staffRouter } from "./roles/staff/routes.js";
import { auth, route, classFilter, studentFilter } from "./middleware/auth.js";
import { Settings, SchoolClass, Student } from "./models/index.js";
export const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get(
  "/branding",
  route(async (_req, res) => {
    const s = await Settings.findOne({ key: "school" });
    res.json({ schoolName: s?.schoolName || "School Platform" });
  })
);
app.use("/auth", authRouter);
app.use(auth);
app.use((req, res, next) =>
  req.user.mustChangePassword
    ? res
        .status(403)
        .json({
          error: "Change your temporary password first",
          code: "PASSWORD_CHANGE_REQUIRED",
        })
    : next()
);
app.get(
  "/dashboard",
  route(async (req, res) =>
    res.json({
      classes: await SchoolClass.countDocuments(await classFilter(req.user)),
      students: await Student.countDocuments(await studentFilter(req.user)),
    })
  )
);
// One portal per role group. Each portal enforces its own role guard.
app.use("/student", studentRouter);
app.use("/parent", parentRouter);
app.use("/finance", financeRouter);
app.use("/staff", staffRouter);
app.use((_req, res) => res.status(404).json({ error: "Endpoint not found" }));
app.use((error, _req, res, _next) => {
  if (error instanceof ZodError)
    return res
      .status(400)
      .json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
  if (error.code === 11000)
    return res.status(409).json({ error: "This record already exists" });
  if (error.name === "CastError")
    return res.status(400).json({ error: "Invalid record ID" });
  if (!error.status) console.error(error.message);
  res
    .status(error.status || 500)
    .json({
      error: error.status ? error.message : "Server error. Check server logs.",
    });
});
