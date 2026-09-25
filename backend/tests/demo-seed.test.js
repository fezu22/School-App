import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { app } from "../src/app.js";
import { Assignment, Branch, Invoice, Payment, Student, User } from "../src/models/index.js";
import { buildSeedPlan, makeCredentialTemplates, seedDemoData, manifestCollection, MANIFEST_KEY } from "../scripts/seed-dev.js";
import { resetDemoSeed } from "../scripts/reset-seed-dev.js";

const password = "Demo-Test-Password-448!";
let mongo;
let accounts;
let plan;
let adminToken;

async function tokenFor(email, expectedStatus = 200) {
  const result = await request(app).post("/auth/login").send({ email, password });
  assert.equal(result.status, expectedStatus, result.text);
  return result.body.token;
}

async function call(token, method, url) {
  return request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

before(async () => {
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEMO_SEED = "true";
  process.env.JWT_SECRET = "isolated-test-secret-which-is-long-enough";
  mongo = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1, args: ["--nounixsocket"] },
  });
  const uri = mongo.getUri("school_platform_test_demo");
  process.env.DEMO_MONGODB_URI = uri;
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  accounts = await Promise.all(makeCredentialTemplates().map(async (account) => ({
    ...account,
    passwordHash: await bcrypt.hash(password, 4),
  })));
  plan = await buildSeedPlan("2026-09-25", accounts);
  await seedDemoData({ credentials: accounts, anchorDate: new Date("2026-09-25T00:00:00Z") });
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("seed is repeatable, complete, and has valid relationships and payment totals", async () => {
  const firstCounts = await Promise.all([
    Branch.countDocuments(),
    Student.countDocuments(),
    User.countDocuments(),
    Assignment.countDocuments(),
    Invoice.countDocuments(),
    Payment.countDocuments(),
  ]);
  assert.deepEqual(firstCounts, [2, 12, 15, 5, 5, 3]);
  await seedDemoData({ credentials: accounts, anchorDate: new Date("2030-01-01T00:00:00Z") });
  const secondCounts = await Promise.all([
    Branch.countDocuments(), Student.countDocuments(), User.countDocuments(),
    Assignment.countDocuments(), Invoice.countDocuments(), Payment.countDocuments(),
  ]);
  assert.deepEqual(secondCounts, firstCounts);
  const invoice = await Invoice.findById(plan.documents.invoices.find((row) => row.title.includes("Partially"))._id);
  const paid = await Payment.aggregate([
    { $match: { invoiceId: invoice._id } },
    { $group: { _id: null, amount: { $sum: "$amount" } } },
  ]);
  assert.equal(invoice.paymentRevision, 1);
  assert.equal(paid[0].amount, 300000);
  const linkChecks = await Promise.all([
    Student.countDocuments({ classId: { $in: plan.documents.classes.map((row) => row._id) } }),
    Payment.countDocuments({ invoiceId: { $in: plan.documents.invoices.map((row) => row._id) } }),
  ]);
  assert.deepEqual(linkChecks, [12, 3]);
  const manifest = await mongoose.connection.db.collection(manifestCollection).findOne({ _id: MANIFEST_KEY });
  assert.equal(manifest.anchorDate, "2026-09-25");
});

test("login works and roles cannot escape their assigned data", async () => {
  adminToken = await tokenFor("school-admin@example.com");
  const anon = await request(app).get("/students");
  assert.equal(anon.status, 401);
  const principal = await tokenFor("principal.north@example.com");
  const northStudents = await call(principal, "get", "/students");
  assert.equal(northStudents.status, 200, northStudents.text);
  assert.equal(northStudents.body.items.length, 6);
  const classes = await call(principal, "get", "/classes");
  assert.equal(classes.body.items.length, 2);
  const child = await tokenFor("student.ava@example.com");
  const ownStudents = await call(child, "get", "/students");
  assert.equal(ownStudents.body.items.length, 1);
  const assignments = await call(child, "get", "/assignments");
  assert.equal(assignments.status, 200);
  assert.ok(assignments.body.items.every((item) => item.published));
  const forbiddenAdmin = await call(child, "get", "/admin/users");
  assert.equal(forbiddenAdmin.status, 403);
  await tokenFor("teacher.science@example.com", 401);
  const mustChange = await tokenFor("accountant.south@example.com");
  const blocked = await call(mustChange, "get", "/dashboard");
  assert.equal(blocked.status, 403);
});

test("reset refuses external references and then deletes only manifest-owned records", async () => {
  const branchId = plan.documents.branches[0]._id;
  const unrelated = await mongoose.connection.collection("unrelated_demo_test").insertOne({ branchId });
  await assert.rejects(resetDemoSeed(), /unrelated .* references seed-owned/);
  assert.equal(await Branch.countDocuments(), 2);
  await mongoose.connection.collection("unrelated_demo_test").deleteOne({ _id: unrelated.insertedId });
  await mongoose.connection.collection("unrelated_demo_test").insertOne({ label: "must remain" });
  const result = await resetDemoSeed();
  assert.ok(result.deleted > 0);
  assert.equal(await Branch.countDocuments(), 0);
  assert.equal(await User.countDocuments(), 0);
  assert.equal(await mongoose.connection.db.collection(manifestCollection).countDocuments(), 0);
  assert.equal(await mongoose.connection.collection("unrelated_demo_test").countDocuments(), 1);
});

test("seed safety checks reject a non-demo target regardless of MONGODB_URI", async () => {
  const { assertDemoSeedEnvironment } = await import("../scripts/seed-dev.js");
  assert.throws(() => assertDemoSeedEnvironment({
    NODE_ENV: "development", ALLOW_DEMO_SEED: "true",
    DEMO_MONGODB_URI: "mongodb://localhost/school_platform",
    MONGODB_URI: "mongodb://localhost/school_platform_demo",
  }), /must end with _demo/);
  assert.throws(() => assertDemoSeedEnvironment({
    NODE_ENV: "production", ALLOW_DEMO_SEED: "true",
    DEMO_MONGODB_URI: "mongodb://localhost/school_platform_demo",
  }), /NODE_ENV=development/);
});
