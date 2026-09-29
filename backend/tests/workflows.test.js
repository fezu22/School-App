import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../src/app.js";
import { User, Lecture } from "../src/models/index.js";
let mongo,
  admin,
  teacher,
  parent,
  student,
  other,
  b1,
  b2,
  c1,
  c2,
  s1,
  s2,
  assignment,
  invoice;
const call = (t, m, p, d) =>
  request(app)
    [m](p)
    .set("Authorization", "Bearer " + t)
    .send(d);
const password = "Test-only-Password-448!";
async function login(email) {
  const r = await request(app).post("/auth/login").send({ email, password });
  assert.equal(r.status, 200, r.text);
  return r.body.token;
}
before(async () => {
  process.env.JWT_SECRET = "test-only-secret-of-more-than-32-characters";
  mongo = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1, args: ["--nounixsocket"] },
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create({
    name: "Test Owner",
    email: "owner@test.invalid",
    passwordHash: await bcrypt.hash(password, 4),
    role: "SUPER_ADMIN",
    mustChangePassword: false,
  });
  admin = await login("owner@test.invalid");
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
test("no school demo records on empty database", async () =>
  assert.deepEqual((await call(admin, "get", "/staff/classes")).body.items, []));
test("create branches classes and students", async () => {
  for (const n of ["A", "B"]) {
    const r = await call(admin, "post", "/staff/admin/branches", { name: n });
    assert.equal(r.status, 201, r.text);
    if (n === "A") b1 = r.body.item._id;
    else b2 = r.body.item._id;
  }
  for (const [n, branchId] of [
    ["A", b1],
    ["B", b2],
  ]) {
    const r = await call(admin, "post", "/staff/classes", {
      name: n,
      section: "1",
      session: "2026",
      branchId,
      subjects: ["Math"],
    });
    assert.equal(r.status, 201, r.text);
    if (n === "A") c1 = r.body.item._id;
    else c2 = r.body.item._id;
  }
  for (const [name, classId] of [
    ["Child A", c1],
    ["Child B", c2],
  ]) {
    const r = await call(admin, "post", "/staff/students", {
      name,
      admissionNumber: name,
      classId,
      guardianName: "Guardian",
      guardianPhone: "",
    });
    assert.equal(r.status, 201, r.text);
    if (classId === c1) s1 = r.body.item._id;
    else s2 = r.body.item._id;
  }
});
test("account assignment is admin only", async () => {
  for (const [email, role, scope] of [
    [
      "teacher@test.invalid",
      "TEACHER",
      { branchIds: [b1], classIds: [c1], subjectNames: ["Math"] },
    ],
    ["parent@test.invalid", "PARENT", { studentIds: [s1] }],
    ["student@test.invalid", "STUDENT", { studentIds: [s1] }],
    ["other@test.invalid", "PRINCIPAL", { branchIds: [b2] }],
  ]) {
    const r = await call(admin, "post", "/staff/admin/users", {
      email,
      name: role,
      password,
      role,
      ...scope,
    });
    assert.equal(r.status, 201, r.text);
    await User.updateOne({ email }, { $set: { mustChangePassword: false } });
  }
  teacher = await login("teacher@test.invalid");
  parent = await login("parent@test.invalid");
  student = await login("student@test.invalid");
  other = await login("other@test.invalid");
  assert.equal((await call(teacher, "post", "/staff/admin/users", {})).status, 403);
});
test("teacher guardian and branch isolation", async () => {
  assert.deepEqual(
    (await call(teacher, "get", "/staff/students")).body.items.map((s) => s._id),
    [s1]
  );
  assert.deepEqual(
    (await call(parent, "get", "/parent/profile")).body.items.map((s) => s._id),
    [s1]
  );
  assert.equal(
    (await call(teacher, "get", "/staff/students?classId=" + c2)).status,
    403
  );
  assert.equal(
    (
      await call(other, "post", "/staff/classes", {
        name: "Bad",
        section: "1",
        session: "2026",
        branchId: b1,
      })
    ).status,
    403
  );
});
test("attendance rejects wrong roster and scopes parent view", async () => {
  const body = {
    classId: c1,
    date: "2026-09-24",
    entries: [{ studentId: s2, status: "PRESENT" }],
  };
  assert.equal((await call(teacher, "post", "/staff/attendance", body)).status, 400);
  body.entries[0].studentId = s1;
  assert.equal((await call(teacher, "post", "/staff/attendance", body)).status, 200);
  const r = await call(parent, "get", "/parent/attendance");
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.items[0].studentId._id, s1);
});
test("draft publish submission grading workflow", async () => {
  let r = await call(teacher, "post", "/staff/assignments", {
    title: "Fractions",
    instructions: "Explain fractions",
    subject: "Math",
    classId: c1,
    dueDate: "2026-10-01",
    maxMarks: 10,
  });
  assert.equal(r.status, 201, r.text);
  assignment = r.body.item._id;
  assert.equal(
    (await call(student, "get", "/student/assignments")).body.items.length,
    0
  );
  assert.equal(
    (await call(student, "get", `/student/assignments/${assignment}/submissions`))
      .status,
    403
  );
  assert.equal(
    (
      await call(teacher, "patch", `/staff/assignments/${assignment}/publish`, {
        published: true,
      })
    ).status,
    200
  );
  r = await call(student, "post", `/student/assignments/${assignment}/submissions`, {
    answer: "Two halves make a whole",
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(
    (
      await call(parent, "post", `/parent/assignments/${assignment}/submissions`, {
        answer: "x",
      })
    ).status,
    404
  );
  assert.equal(
    (
      await call(
        teacher,
        "patch",
        `/staff/assignments/${assignment}/submissions/${r.body.item._id}`,
        { marks: 8, feedback: "Explain more" }
      )
    ).status,
    200
  );
  assert.equal(
    (await call(parent, "get", `/parent/assignments/${assignment}/submissions`)).body
      .items[0].marks,
    8
  );
});
test("partial payments reject overpayment and duplicate retries", async () => {
  let r = await call(admin, "post", "/staff/invoices", {
    studentId: s1,
    title: "Tuition",
    amount: 10000,
    dueDate: "2026-10-01",
  });
  assert.equal(r.status, 201, r.text);
  invoice = r.body.item._id;
  const p = {
    amount: 4000,
    method: "CASH",
    requestKey: "test-payment-request-1",
  };
  assert.equal(
    (await call(admin, "post", `/staff/invoices/${invoice}/payments`, p)).status,
    201
  );
  assert.equal(
    (await call(admin, "post", `/staff/invoices/${invoice}/payments`, p)).status,
    200
  );
  assert.equal(
    (
      await call(admin, "post", `/staff/invoices/${invoice}/payments`, {
        ...p,
        amount: 7000,
        requestKey: "test-payment-request-2",
      })
    ).status,
    400
  );
  assert.equal(
    (await call(parent, "get", "/parent/invoices")).body.items[0].balance,
    6000
  );
  assert.equal((await call(teacher, "get", "/staff/invoices")).status, 403);
});
test("timetable rejects overlap", async () => {
  const p = {
    classId: c1,
    day: "Monday",
    start: "09:00",
    end: "10:00",
    subject: "Math",
    room: "1",
  };
  assert.equal((await call(admin, "post", "/staff/timetable", p)).status, 201);
  assert.equal((await call(admin, "post", "/staff/timetable", p)).status, 409);
  assert.equal((await call(parent, "get", "/parent/timetable")).body.items.length, 1);
});
test("AI absence explicit, quiz answer key private, server grades", async () => {
  const r = await call(teacher, "post", "/staff/lectures", {
    title: "Fractions",
    classId: c1,
    subject: "Math",
    transcript:
      "Fractions express parts of a whole. A numerator counts selected parts and a denominator counts equal parts in the whole.",
  });
  assert.equal(r.status, 201, r.text);
  const id = r.body.item._id;
  assert.equal(
    (await call(teacher, "post", `/staff/lectures/${id}/generate`)).status,
    503
  );
  await Lecture.updateOne(
    { _id: id },
    {
      $set: {
        state: "READY",
        summary: "Parts of a whole.",
        topics: ["Fractions"],
        homework: "Explain one half.",
        questions: [
          {
            prompt: "Half equals?",
            options: ["0.5", "2", "3", "4"],
            correctIndex: 0,
            explanation: "One divided by two.",
          },
        ],
      },
    }
  );
  assert.equal((await call(student, "get", `/student/lectures/${id}`)).status, 403);
  const pub = await call(teacher, "post", `/staff/lectures/${id}/publish`, {
    summary: "Parts of a whole.",
    homework: "Explain one half.",
    dueDate: "2026-10-01",
    maxMarks: 10,
  });
  assert.equal(pub.status, 200, pub.text);
  const quiz = await call(student, "get", `/student/lectures/${id}`);
  assert.equal(quiz.body.item.questions[0].correctIndex, undefined);
  assert.equal(quiz.body.item.questions[0].explanation, undefined);
  const a = await call(student, "post", `/student/lectures/${id}/attempts`, {
    answers: [0],
  });
  assert.equal(a.status, 201, a.text);
  assert.equal(a.body.item.score, 1);
  assert.equal(
    (await call(student, "post", `/student/lectures/${id}/attempts`, { answers: [0] }))
      .status,
    409
  );
});
test("each role can only use its own portal", async () => {
  assert.equal((await call(student, "get", "/staff/classes")).status, 403);
  assert.equal((await call(student, "get", "/parent/profile")).status, 403);
  assert.equal((await call(student, "get", "/finance/invoices")).status, 403);
  assert.equal((await call(parent, "get", "/student/profile")).status, 403);
  assert.equal((await call(parent, "get", "/finance/invoices")).status, 403);
  assert.equal((await call(parent, "get", "/staff/students")).status, 403);
  assert.equal((await call(teacher, "get", "/student/profile")).status, 403);
  assert.equal((await call(teacher, "get", "/finance/invoices")).status, 403);
  assert.equal((await call(other, "get", "/staff/admin/users")).status, 403);
});
test("disabled user loses existing token access", async () => {
  const u = await User.findOne({ email: "teacher@test.invalid" });
  assert.equal(
    (
      await call(admin, "patch", `/staff/admin/users/${u._id}/active`, {
        active: false,
      })
    ).status,
    200
  );
  assert.equal((await call(teacher, "get", "/staff/classes")).status, 401);
});

test("scope changes invalidate old sessions and change visible records", async () => {
  const u = await User.findOne({ email: "parent@test.invalid" });
  const r = await call(admin, "patch", `/staff/admin/users/${u._id}/scope`, {
    branchIds: [],
    classIds: [],
    studentIds: [s2],
    subjectNames: [],
  });
  assert.equal(r.status, 200, r.text);
  assert.equal((await call(parent, "get", "/parent/profile")).status, 401);
  const renewed = await login("parent@test.invalid");
  assert.deepEqual(
    (await call(renewed, "get", "/parent/profile")).body.items.map((s) => s._id),
    [s2]
  );
});
test("concurrent payments cannot exceed outstanding balance", async () => {
  const inv = await call(admin, "post", "/staff/invoices", {
    studentId: s2,
    title: "Concurrent payment test",
    amount: 10000,
    dueDate: "2026-10-01",
  });
  assert.equal(inv.status, 201, inv.text);
  const results = await Promise.all(
    ["concurrent-request-A", "concurrent-request-B"].map((requestKey) =>
      call(admin, "post", `/staff/invoices/${inv.body.item._id}/payments`, {
        amount: 7000,
        method: "CASH",
        requestKey,
      })
    )
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
});
