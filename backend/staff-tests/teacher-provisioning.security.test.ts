import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import User, { type UserRole } from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import Session from '../src/staff/src/models/session';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import { comparePassword } from '../src/staff/src/utils/password';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import { ensureTeacherAccountIndex } from '../src/staff/src/services/teacher-provisioning.service';

// Only this suite's owned replica set is used. Never load dotenv/MONGODB_URI.
let db: MongoMemoryReplSet,
  server: Server,
  base: string,
  admin: string,
  branchId: string;
const originalSecret = process.env.JWT_SECRET;
const grants = [...ROLE_PERMISSIONS.super_admin];
const payload = () => ({
  fullName: 'New Teacher',
  email: ' NEW@EXAMPLE.COM ',
  password: 'StrongPassword123!',
  branchId,
});
const actor = async (role: UserRole) => {
  const user = await new User({
    fullName: 'Test Actor',
    email: `${new mongoose.Types.ObjectId()}@example.com`,
    password: 'fixture-not-a-login-hash',
    role,
    ...(role === 'super_admin' ? {} : { branchId }),
  }).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return token;
};
const http = async (path: string, token?: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json()) as any };
};
before(async () => {
  process.env.JWT_SECRET = 'owned-provisioning-test-only-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { autoIndex: false });
  await ensureTeacherAccountIndex();
  await ensureTeacherAccountIndex();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});
beforeEach(async () => {
  ROLE_PERMISSIONS.super_admin = [...grants];
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  branchId = String(
    (
      await Branch.create({
        name: 'Active Branch',
        code: 'AB',
        address: 'Private',
        city: 'City',
      })
    )._id,
  );
  admin = await actor('super_admin');
});
after(async () => {
  ROLE_PERMISSIONS.super_admin = grants;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
test('Super Admin provisions hashed Teacher identity; login works without academic assignments', async () => {
  const created = await http('/admin/teachers', admin, payload());
  assert.equal(created.status, 201);
  assert.deepEqual(
    Object.keys(created.json.data).sort(),
    [
      'id',
      'fullName',
      'email',
      'role',
      'branchId',
      'isActive',
      'createdAt',
    ].sort(),
  );
  assert.equal(created.json.data.role, 'teacher');
  assert.equal(created.json.data.email, 'new@example.com');
  const user = await User.findById(created.json.data.id);
  assert.ok(user);
  assert.notEqual(user.password, payload().password);
  assert.equal(await comparePassword(payload().password, user.password), true);
  assert.equal(
    await TeacherAssignment.countDocuments({ teacherId: user._id }),
    0,
  );
  const login = await http('/auth/login', undefined, {
    email: 'new@example.com',
    password: payload().password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.role, 'teacher');
  assert.equal(Object.hasOwn(login.json.user, 'password'), false);
  assert.ok(
    await Session.exists({ token: login.json.accessToken, isRevoked: false }),
  );
  const token = login.json.accessToken;
  assert.deepEqual((await http('/teacher/classes', token)).json.data, []);
  assert.equal(
    (await http(`/teacher/classes/${new mongoose.Types.ObjectId()}`, token))
      .status,
    404,
  );
  const guessed = new mongoose.Types.ObjectId();
  assert.equal(
    (
      await http(
        `/teacher/classes/${guessed}/sections/${guessed}/subjects/${guessed}/students`,
        token,
      )
    ).status,
    404,
  );
  const schedule = await http('/teacher/timetable?date=2026-10-14', token);
  assert.equal(schedule.status, 200);
  assert.deepEqual(schedule.json.data.periods, []);
  assert.equal(
    (await http(`/teacher/timetable/periods/${guessed}?date=2026-10-14`, token))
      .status,
    404,
  );
  assert.equal(
    (
      await http(
        `/teacher/attendance/sessions/${new mongoose.Types.ObjectId()}`,
        token,
      )
    ).status,
    404,
  );
  assert.equal((await http('/teacher/inbox', token)).json.data.total, 0);
  assert.equal((await http('/teacher/tasks', token)).json.data.total, 0);
  await Session.updateOne({ token }, { $set: { isRevoked: true } });
  assert.equal((await http('/teacher/classes', token)).status, 401);
  await Session.updateOne({ token }, { $set: { isRevoked: false } });
  await User.updateOne({ _id: user._id }, { $set: { role: 'student' } });
  assert.equal((await http('/teacher/classes', token)).status, 401);
});
for (const role of ['teacher', 'student', 'principal'] as const)
  test(`${role} cannot provision accounts`, async () => {
    const response = await http(
      '/admin/teachers',
      await actor(role),
      payload(),
    );
    assert.equal(response.status, 403);
    assert.equal(await User.countDocuments({ email: 'new@example.com' }), 0);
  });
test('unauthenticated and signed but unregistered sessions fail closed', async () => {
  assert.equal(
    (await http('/admin/teachers', undefined, payload())).status,
    401,
  );
  const unregistered = generateAccessToken(
    String(new mongoose.Types.ObjectId()),
    'super_admin',
  );
  assert.equal(
    (await http('/admin/teachers', unregistered, payload())).status,
    401,
  );
});
for (const field of [
  'role',
  'isActive',
  'teacherId',
  'classId',
  'schoolId',
  'tenantId',
  'phone',
  'bootstrapKey',
])
  test(`rejects injected ${field} with zero account/assignment writes`, async () => {
    assert.equal(
      (
        await http('/admin/teachers', admin, {
          ...payload(),
          [field]: 'super_admin',
        })
      ).status,
      400,
    );
    assert.equal(await User.countDocuments({ email: 'new@example.com' }), 0);
    assert.equal(await TeacherAssignment.countDocuments(), 0);
  });
for (const branch of ['invalid', '000000000000000000000000'])
  test(`rejects invalid/unavailable branch ${branch}`, async () => {
    assert.equal(
      (await http('/admin/teachers', admin, { ...payload(), branchId: branch }))
        .status,
      branch === 'invalid' ? 400 : 404,
    );
    assert.equal(await User.countDocuments({ email: 'new@example.com' }), 0);
  });
test('inactive branches cannot receive accounts or appear in minimal branch choices', async () => {
  await Branch.updateOne({ _id: branchId }, { $set: { isActive: false } });
  assert.equal((await http('/admin/teachers', admin, payload())).status, 404);
  assert.deepEqual(
    (await http('/admin/teachers/branches', admin)).json.data,
    [],
  );
});
test('active branch choices expose only public identifiers and names', async () => {
  const choices = await http('/admin/teachers/branches', admin);
  assert.equal(choices.status, 200);
  assert.deepEqual(
    Object.keys(choices.json.data[0]).sort(),
    ['id', 'name', 'code'].sort(),
  );
  assert.equal(
    (await http('/admin/teachers/branches', await actor('teacher'))).status,
    403,
  );
});
test('duplicate normalized email returns safe conflict and concurrent creation persists one account', async () => {
  const results = await Promise.all([
    http('/admin/teachers', admin, payload()),
    http('/admin/teachers', admin, payload()),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await User.countDocuments({ email: 'new@example.com' }), 1);
  assert.equal(
    (
      await http('/admin/teachers', admin, {
        ...payload(),
        email: 'new@example.com',
      })
    ).status,
    409,
  );
});
test('permission removal and current actor role/activity/session changes deny creation', async () => {
  ROLE_PERMISSIONS.super_admin = grants.filter(
    p => p !== PERMISSIONS.TEACHERS_CREATE,
  );
  assert.equal((await http('/admin/teachers', admin, payload())).status, 403);
  ROLE_PERMISSIONS.super_admin = [...grants];
  const session = await Session.findOne({ token: admin });
  assert.ok(session);
  await User.updateOne({ _id: session.userId }, { $set: { role: 'teacher' } });
  assert.equal((await http('/admin/teachers', admin, payload())).status, 401);
  await User.updateOne(
    { _id: session.userId },
    { $set: { role: 'super_admin', isActive: false } },
  );
  assert.equal((await http('/admin/teachers', admin, payload())).status, 401);
  await User.updateOne({ _id: session.userId }, { $set: { isActive: true } });
  await Session.updateOne({ _id: session._id }, { $set: { isRevoked: true } });
  assert.equal((await http('/admin/teachers', admin, payload())).status, 401);
  assert.equal(await User.countDocuments({ email: 'new@example.com' }), 0);
});
test('branch-bound Super Admin identity cannot widen school-wide provisioning scope', async () => {
  await User.updateOne({ role: 'super_admin' }, { $set: { branchId } });
  assert.equal((await http('/admin/teachers', admin, payload())).status, 403);
  assert.equal((await http('/admin/teachers/branches', admin)).status, 403);
});
for (const changes of [
  { password: 'short' },
  { password: 'x'.repeat(73) },
  { password: '\u0627'.repeat(40) },
  { email: 'not-email' },
  { fullName: 'x' },
  { branchId: { $ne: null } },
])
  test(`validates credential and identifier contract ${JSON.stringify(
    Object.keys(changes),
  )} ${String(Object.values(changes)[0]).length}`, async () => {
    assert.equal(
      (await http('/admin/teachers', admin, { ...payload(), ...changes }))
        .status,
      400,
    );
  });
test('Principal provisioning retains existing login-compatible contract', async () => {
  const created = await http('/admin/principals', admin, {
    ...payload(),
    email: 'principal-new@example.com',
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.role, 'principal');
  assert.equal(
    (
      await http('/auth/login', undefined, {
        email: 'principal-new@example.com',
        password: payload().password,
      })
    ).status,
    200,
  );
});
test('malformed credential JSON returns sanitized validation without leaking input', async () => {
  const response = await fetch(`${base}/admin/teachers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${admin}`,
      'Content-Type': 'application/json',
    },
    body: '{"password":"private-credential-marker",',
  });
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.equal(text.includes('private-credential-marker'), false);
  assert.deepEqual(JSON.parse(text), {
    success: false,
    message: 'Invalid Teacher account request body',
  });
  assert.equal(await User.countDocuments({ role: 'teacher' }), 0);
});
