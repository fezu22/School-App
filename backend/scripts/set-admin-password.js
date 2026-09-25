import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../src/models/index.js";

const password = await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    if (input.includes("\n")) {
      process.stdin.pause();
      resolve(input.trim());
    }
  });
  process.stdin.on("error", reject);
});

if (password.length < 12 || password.length > 100) {
  throw new Error("Password must be between 12 and 100 characters.");
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const account = await User.findOne({
    email: "admin@school.local",
    role: "SUPER_ADMIN",
  });
  if (!account) throw new Error("School Super Admin account was not found.");

  account.passwordHash = await bcrypt.hash(password, 12);
  account.mustChangePassword = false;
  account.tokenVersion += 1;
  await account.save();
  console.log("School Super Admin password updated.");
} finally {
  await mongoose.disconnect();
}
