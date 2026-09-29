import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { app } from "./app.js";
import { User, Lecture, Submission } from "./models/index.js";
const mongoUri =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL;
const normalizedMongoUri = mongoUri?.trim();
let isValidMongoUri = false;
try {
  const parsedMongoUri = new URL(normalizedMongoUri);
  isValidMongoUri =
    ["mongodb:", "mongodb+srv:"].includes(parsedMongoUri.protocol) &&
    Boolean(parsedMongoUri.hostname);
} catch {
}
if (!isValidMongoUri) {
  console.error(
    "A valid MongoDB URI is required. Set MONGO_URI, MONGODB_URI, or DATABASE_URL."
  );
  process.exit(1);
}
if (
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET.length < 32 ||
  process.env.JWT_SECRET.includes("replace")
)
  throw Error("Set a random JWT_SECRET of at least 32 characters");
try {
  await mongoose.connect(normalizedMongoUri);
  console.log("MongoDB Connected Successfully");
} catch (error) {
  console.error("MongoDB connection failed:", error.message);
  process.exit(1);
}
await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
await Submission.updateMany(
  { aiState: "PROCESSING" },
  { $set: { aiState: "FAILED" } }
);
await Lecture.updateMany(
  { state: "PROCESSING" },
  { $set: { state: "FAILED", failure: "Server restarted; retry generation" } }
);
if (!(await User.exists({ role: "SUPER_ADMIN" }))) {
  if (
    !process.env.BOOTSTRAP_EMAIL ||
    !process.env.BOOTSTRAP_PASSWORD ||
    process.env.BOOTSTRAP_EMAIL.endsWith("@example.com") ||
    process.env.BOOTSTRAP_PASSWORD.includes("replace")
  )
    throw Error(
      "Configure your own BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD before the first launch"
    );
  if (process.env.BOOTSTRAP_PASSWORD.length < 12)
    throw Error("Bootstrap password must be at least 12 characters");
  await User.create({
    name: process.env.BOOTSTRAP_NAME || "School Administrator",
    email: process.env.BOOTSTRAP_EMAIL.trim().toLowerCase(),
    passwordHash: await bcrypt.hash(process.env.BOOTSTRAP_PASSWORD, 12),
    role: "SUPER_ADMIN",
    mustChangePassword: false,
  });
  console.log("Initial administrator created. No demo data inserted.");
}
const server = app.listen(Number(process.env.PORT || 4000), "0.0.0.0", () =>
  console.log("School API ready")
);
process.on("SIGTERM", () => server.close(() => mongoose.disconnect()));
