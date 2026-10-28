const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isStaffPath} = require('./staffIntegration');
test('staff API routing uses segment boundaries and preserves learner/finance APIs', () => {
  for (const path of ['/api/usage', '/api/backup', '/api/health', '/api/sessions']) assert.equal(isStaffPath(path), true, path);
  for (const path of ['/api/teacher/home', '/api/principal/results?term=1', '/api/student/results', '/api/admin', '/api/staff-students', '/api/staff-students/enrollment-options', '/api/staff-students/abc/enrollments', '/api/attendance-review']) assert.equal(isStaffPath(path), true, path);
  for (const path of ['/api/students', '/api/students/abc', '/api/students/me', '/api/students/me/results', '/api/parents/me', '/api/finance/summary', '/api/auth/login', '/api/teacher-evil', '/api/administer']) assert.equal(isStaffPath(path), false, path);
});
require('tsx/cjs/api').register();
const authPath = require.resolve('./auth');
let record;
let acceptedSession;
let status = 200;
require.cache[authPath] = {id: authPath, filename: authPath, loaded: true, exports: {
  authenticateRequest: async (req, res, next) => {
    if (!record) return res.status(401).json({success: false});
    req.authenticatedUserRecord = record;
    req.authenticatedSessionRecord = acceptedSession;
    return next();
  },
}};
const {authenticateToken} = require('./staff/src/middleware/auth.middleware.ts');
test('staff bridge requires common authentication and maps canonical database identity', async t => {
  const {ObjectId} = require('mongodb');
  const mongoose = require('mongoose');
  const User = require('./staff/src/models/user.ts').default;
  const originalDatabase = mongoose.connection.db;
  const schoolId = new ObjectId();
  mongoose.connection.db = {collection: () => ({findOne: async () => ({_id: schoolId, isActive: true})})};
  t.after(() => {mongoose.connection.db = originalDatabase;});
  t.mock.method(User, 'findById', () => ({read() {return this;}, select() {return this;}, async lean() {return record;}}));
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  const res = {status(code) {status = code; return this;}, json() {return this;}};
  let passed = false;
  await authenticateToken({}, res, () => {passed = true;});
  assert.equal(status, 401); assert.equal(passed, false);
  record = {id: 'legacy-teacher', _id: new ObjectId(), schoolId, role: 'teacher', isActive: true};
  acceptedSession = {_id: new ObjectId(), type: 'access', tokenHash: 'a'.repeat(64), userId: record.id, expiresAt: new Date(Date.now() + 60000)};
  const req = {};
  await authenticateToken(req, res, () => {passed = true;});
  assert.equal(passed, true); assert.equal(req.user.userId, record._id.toHexString());
  assert.equal(req.user.role, 'teacher');
  assert.equal(req.authContext, req.user);
  assert.equal(req.authContext.authMode, 'integrated_opaque');
  assert.equal(req.authContext.sessionId, String(acceptedSession._id));
  assert.equal(require('./staff/src/services/authenticated-session.service.ts').isAuthContext(req.authContext), true);
  acceptedSession = undefined; passed = false;
  await authenticateToken({}, res, () => {passed = true;});
  assert.equal(status, 401); assert.equal(passed, false);
  record = {id: 'unresolved', role: 'teacher'}; passed = false;
  await authenticateToken({}, res, () => {passed = true;});
  assert.equal(status, 503); assert.equal(passed, false);
  delete process.env.INTEGRATED_STAFF_ENABLED;
});
