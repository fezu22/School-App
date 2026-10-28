const { test } = require('node:test');
const assert = require('node:assert/strict');
const databasePath = require.resolve('./database');
let session;
let user;
let sessionQuery;
let userMatches;
let insertedSession;
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
  getDatabase: () => ({ collection: name => ({
    find: () => ({ limit: () => ({ toArray: async () => userMatches || (user ? [user] : []) }) }),
    findOne: async query => {
      if (name === 'users') return user;
      sessionQuery = query;
      return session && !session.revokedAt && session.expiresAt > query.expiresAt.$gt ? session : null;
    },
    insertOne: async record => { insertedSession = record; return { insertedId: 'fixture' }; },
    updateOne: async (_query, update) => { Object.assign(session, update.$set); },
  }) }),
} };
const { authenticateRequest, logout, login, hashPassword } = require('./auth');
const token = 'a'.repeat(43);
async function authenticate(header) {
  const req = { get: () => header }; let status = 200; let passed = false;
  const res = { status: code => { status = code; return res; }, json: () => res };
  await authenticateRequest(req, res, error => { assert.equal(error, undefined); passed = true; });
  return { status, passed, req };
}
test('bearer enforcement, expiry and logout revocation', async () => {
  user = { id: 'test-user', role: 'student', active: true };
  session = { _id: 'test-session', userId: user.id, expiresAt: new Date(Date.now() + 60000), revokedAt: null };
  assert.equal((await authenticate('')).status, 401);
  assert.equal((await authenticate('Basic invalid')).status, 401);
  const valid = await authenticate(`Bearer ${token}`);
  assert.equal(valid.passed, true);
  assert.equal(valid.req.user.role, 'student');
  assert.equal(sessionQuery.type, 'access');
  assert.equal(sessionQuery.revokedAt, null);
  assert.notEqual(sessionQuery.tokenHash, token);
  session.expiresAt = new Date(Date.now() - 1);
  assert.equal((await authenticate(`Bearer ${token}`)).status, 401);
  session.expiresAt = new Date(Date.now() + 60000);
  await logout(token);
  assert.ok(session.revokedAt instanceof Date);
  assert.equal((await authenticate(`Bearer ${token}`)).status, 401);
});


test('both account disable flags reject an existing session', async () => {
  for (const flag of ['active', 'isActive']) {
    user = { id: 'test-user', role: 'student', [flag]: false };
    session = { _id: 'test-session', userId: user.id, expiresAt: new Date(Date.now() + 60000), revokedAt: null };
    const result = await authenticate(`Bearer ${token}`);
    assert.equal(result.status, 401);
    assert.equal(result.passed, false);
  }
});


test('login rejects disabled, malformed and unlinked accounts before issuing sessions', async () => {
  const password = 'test-only-password-123';
  const valid = { id: 'test-user', role: 'student', ...hashPassword(password) };
  for (const change of [
    { active: false }, { isActive: false }, { id: undefined },
    { id: '' }, { role: '' }, { passwordHash: 'invalid' },
    { passwordSalt: 'invalid' },
  ]) {
    user = { ...valid, ...change };
    assert.equal(await login('student@example.invalid', password), null);
  }
});


test('partner bcrypt accounts receive hashed opaque sessions and canonical ObjectId identity', async () => {
  const {ObjectId} = require('mongodb');
  const bcrypt = require('bcryptjs');
  userMatches = undefined;
  const password = 'fixture-password-only-123';
  user = { _id: new ObjectId(), role: 'teacher', isActive: true,
    email: 'teacher@example.invalid', password: await bcrypt.hash(password, 10) };
  const result = await login(user.email, password);
  assert.equal(result.user.id, user._id.toHexString());
  assert.equal(result.user.role, 'teacher');
  assert.equal(insertedSession.userId, result.user.id);
  assert.notEqual(insertedSession.tokenHash, result.token);
  assert.equal(insertedSession.token, undefined);
  assert.equal(await login(user.email, 'wrong-password'), null);
  session = { ...insertedSession, _id: 'session-id' };
  assert.equal((await authenticate(`Bearer ${result.token}`)).passed, true);
});

test('legacy bcrypt 2y accounts verify passwords before issuing sessions', async () => {
  const {ObjectId} = require('mongodb');
  const bcrypt = require('bcryptjs');
  const password = 'fixture-legacy-password-123';
  const passwordHash = (await bcrypt.hash(password, 10)).replace(/^\$2b\$/, '$2y$');
  user = { _id: new ObjectId(), role: 'super_admin', isActive: true,
    email: 'admin@example.invalid', password: passwordHash };
  insertedSession = undefined;
  assert.equal(await login(user.email, 'wrong-password'), null);
  assert.equal(insertedSession, undefined);
  const result = await login(user.email, password);
  assert.equal(result.user.id, user._id.toHexString());
  assert.equal(result.user.role, 'super_admin');
  assert.equal(user.password, passwordHash);
  user.isActive = false;
  assert.equal(await login(user.email, password), null);
});

test('ambiguous email and identity matches fail closed', async () => {
  userMatches = [{ id: 'one', role: 'student' }, { id: 'two', role: 'student' }];
  assert.equal(await login('duplicate@example.invalid', 'not-a-real-password'), null);
  session = { _id: 'test', userId: 'one', expiresAt: new Date(Date.now() + 60000), revokedAt: null };
  assert.equal((await authenticate(`Bearer ${token}`)).status, 401);
  userMatches = undefined;
});
