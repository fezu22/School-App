const {before, beforeEach, after, test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {MongoMemoryReplSet} = require('mongodb-memory-server');
const {MongoClient, ObjectId} = require('mongodb');
const mongoose = require('mongoose');
let repl, client, db, server, base, hashPassword;
let schoolA, schoolB, branchA, branchB, admin, student, teacher, parent, unmapped;
let serial = 0;
const password = 'Isolated-audit-password-123';
let passwordFields;
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
before(async () => {
  repl = await MongoMemoryReplSet.create({replSet: {count: 1}});
  const uri = repl.getUri();
  client = new MongoClient(uri, {monitorCommands: true});
  await client.connect();
  db = client.db('security_audit_100');
  await mongoose.connect(uri, {dbName: 'security_audit_100', autoIndex: false});
  // The production environment file is deliberately never loaded in this
  // worker. Production startup is forbidden; only its app factory is used.
  const dotenvPath = require.resolve('dotenv');
  require.cache[dotenvPath] = {id: dotenvPath, filename: dotenvPath, loaded: true, exports: {config: () => ({parsed: {}})}};
  const databasePath = require.resolve('../src/database');
  require.cache[databasePath] = {id: databasePath, filename: databasePath, loaded: true, exports: {
    getDatabase: () => db, getClient: () => client,
    connectDatabase: () => {throw new Error('Production database startup forbidden in audit');},
  }};
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  process.env.ONLINE_PAYMENTS_VERIFIED = 'false';
  process.env.LIVE_LESSONS_VERIFIED = 'false';
  process.env.LIVE_LESSON_ENABLED = 'false';
  hashPassword = require('../src/auth').hashPassword;
  passwordFields = hashPassword(password);
  require('tsx/cjs/api').register();
  const imported = require('../src/staff/src/app.ts');
  const app = require('../src/server').createApplication({staff: () => imported.default || imported});
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
async function user(role, schoolId, extra = {}) {
  const record = {_id: new ObjectId(), id: 'audit-user-' + serial++, fullName: 'Owned audit fixture', email: `audit-${serial}@test.invalid`, role, active: true, isActive: true, ...passwordFields, ...(schoolId ? {schoolId} : {}), ...extra};
  record.emailLower = record.email;
  await db.collection('users').insertOne(record);
  const token = crypto.randomBytes(32).toString('base64url');
  const sessionId = new ObjectId();
  await db.collection('refreshTokens').insertOne({_id: sessionId, userId: record.id, tokenHash: digest(token), type: 'access', revokedAt: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000)});
  return {record, token, sessionId};
}
beforeEach(async () => {
  assert.equal(db.databaseName, 'security_audit_100');
  for (const collection of await db.collections()) await collection.deleteMany({});
  schoolA = new ObjectId(); schoolB = new ObjectId(); branchA = new ObjectId(); branchB = new ObjectId();
  await db.collection('schools').insertMany([{_id: schoolA, name: 'Audit A', isActive: true}, {_id: schoolB, name: 'Audit B', isActive: true}]);
  await db.collection('branches').insertMany([
    {_id: branchA, schoolId: schoolA, name: 'Owned branch', code: 'AUDITA', address: 'Fixture', city: 'Fixture', isActive: true},
    {_id: branchB, schoolId: schoolB, name: 'Foreign branch', code: 'AUDITB', address: 'Fixture', city: 'Fixture', isActive: true},
  ]);
  admin = await user('super_admin', schoolA);
  student = await user('student', schoolA, {branchId: branchA});
  teacher = await user('teacher', schoolA, {branchId: branchA});
  parent = await user('parent', schoolA, {branchId: branchA});
  unmapped = await user('super_admin');
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (client) await client.close();
  if (repl) await repl.stop();
});
async function http(path, actor, body, headers = {}) {
  const response = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', headers: {
    ...(actor ? {Authorization: 'Bearer ' + actor.token} : {}),
    ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers,
  }, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const text = await response.text();
  return {status: response.status, data: JSON.parse(text), text, headers: response.headers};
}
const me = actor => http('/api/auth/me', actor);
test('AUDIT-NEW-01: missing bearer cannot open a protected user profile', async () => assert.equal((await me()).status, 401));
test('AUDIT-NEW-02: fabricated opaque bearer cannot authenticate', async () => assert.equal((await me({token: 'x'.repeat(43)})).status, 401));
test('AUDIT-NEW-03: expired access session cannot open a profile', async () => {
  await db.collection('refreshTokens').updateOne({_id: student.sessionId}, {$set: {expiresAt: new Date(0)}});
  assert.equal((await me(student)).status, 401);
});
test('AUDIT-NEW-04: revoked access session cannot open a profile', async () => {
  await db.collection('refreshTokens').updateOne({_id: student.sessionId}, {$set: {revokedAt: new Date()}});
  assert.equal((await me(student)).status, 401);
});
test('AUDIT-NEW-05: legacy account disable immediately removes access', async () => {
  await db.collection('users').updateOne({_id: student.record._id}, {$set: {active: false}});
  assert.equal((await me(student)).status, 401);
});
test('AUDIT-NEW-06: staff account disable immediately removes access', async () => {
  await db.collection('users').updateOne({_id: teacher.record._id}, {$set: {isActive: false}});
  assert.equal((await me(teacher)).status, 401);
});
test('AUDIT-NEW-07: login body cannot promote a Student to Super Admin', async () => {
  const result = await http('/api/auth/login', null, {email: student.record.email, password, role: 'super_admin', schoolId: String(schoolB)});
  assert.equal(result.status, 200);
  assert.equal(result.data.data.user.role, 'student');
});
test('AUDIT-NEW-08: object-shaped email cannot inject a MongoDB login selector', async () => assert.equal((await http('/api/auth/login', null, {email: {$ne: null}, password})).status, 401));
test('AUDIT-NEW-09: object-shaped password cannot bypass verification', async () => assert.equal((await http('/api/auth/login', null, {email: student.record.email, password: {$ne: null}})).status, 401));
test('AUDIT-NEW-10: oversized password is rejected before database or password work', async () => {
  let finds = 0;
  const listener = event => {if (event.commandName === 'find' && event.command.find === 'users') finds++;};
  client.on('commandStarted', listener);
  try {
    assert.equal((await http('/api/auth/login', null, {email: student.record.email, password: 'x'.repeat(4096)})).status, 401);
    assert.equal(finds, 0);
  } finally {client.off('commandStarted', listener);}
});
test('AUDIT-NEW-11: repeated wrong passwords are throttled for one account', async () => {
  let response;
  for (let i = 0; i < 11; i++) response = await http('/api/auth/login', null, {email: `missing-${serial}@test.invalid`, password: 'incorrect'});
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});
test('AUDIT-NEW-12: forged forwarding headers cannot bypass source throttling', async () => {
  let response;
  for (let i = 0; i < 101; i++) response = await http('/api/auth/login', null, {email: `rotate-${serial}-${i}@test.invalid`, password: 'incorrect'}, {'X-Forwarded-For': `198.51.100.${i + 1}`});
  assert.equal(response.status, 429);
});
test('AUDIT-NEW-13: malformed JSON returns sanitized 400 rather than server failure', async () => {
  const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"password":"AUDIT_PRIVATE_CANARY",'});
  const text = await response.text();
  assert.equal(response.status, 400);
  assert.equal(text.includes('AUDIT_PRIVATE_CANARY'), false);
  assert.equal(text.includes('SyntaxError'), false);
});
test('AUDIT-NEW-14: oversized JSON returns bounded 413 rather than server failure', async () => {
  const response = await http('/api/auth/login', null, {email: 'x'.repeat(110000), password: 'incorrect'});
  assert.equal(response.status, 413);
});
test('AUDIT-NEW-15: school administrator cannot list another school branches', async () => {
  const result = await http('/api/branches', admin);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.branches.map(row => row._id), [String(branchA)]);
});
test('AUDIT-NEW-16: foreign school branch ID is concealed like a missing branch', async () => {
  assert.equal((await http('/api/branches/' + branchB, admin)).status, 404);
  assert.equal((await http('/api/branches/' + new ObjectId(), admin)).status, 404);
});
test('AUDIT-NEW-17: forged school ownership cannot redirect branch creation', async () => {
  const result = await http('/api/branches', admin, {name: 'New audit branch', code: 'NEW' + serial, city: 'Fixture', address: 'Fixture', schoolId: String(schoolB)});
  assert.equal(result.status, 201, result.text);
  const row = await db.collection('branches').findOne({_id: new ObjectId(result.data.branch._id)});
  assert.equal(String(row.schoolId), String(schoolA));
});
test('AUDIT-NEW-18: query-string school override cannot widen branch directory', async () => {
  const result = await http('/api/branches?schoolId=' + schoolB, admin);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.branches.map(row => row._id), [String(branchA)]);
});
test('AUDIT-NEW-19: malformed branch ID returns sanitized 400', async () => {
  const result = await http('/api/branches/not-an-object-id', admin);
  assert.equal(result.status, 400);
  assert.equal(result.text.includes('CastError'), false);
});
test('AUDIT-NEW-20: invalid branch fields cannot expose internal exception details', async () => {
  const result = await http('/api/branches', admin, {name: 'Invalid branch', code: {$gt: ''}, address: 'Fixture', city: 'Fixture'});
  assert.equal(result.status, 400);
  assert.equal(/toUpperCase|Cast to|TypeError|stack/.test(result.text), false);
});
test('AUDIT-NEW-21: unmapped administrator cannot fall back to a global branch list', async () => assert.equal((await http('/api/branches', unmapped)).status, 503));
test('AUDIT-NEW-22: school suspension invalidates existing bearer access', async () => {
  await db.collection('schools').updateOne({_id: schoolA}, {$set: {status: 'suspended'}});
  assert.equal((await me(student)).status, 403);
});
test('AUDIT-NEW-23: deleted mapped school cannot retain authenticated access', async () => {
  await db.collection('schools').deleteOne({_id: schoolA});
  assert.equal((await me(student)).status, 503);
});
test('AUDIT-NEW-24: account and branch school mismatch cannot authenticate', async () => {
  await db.collection('users').updateOne({_id: student.record._id}, {$set: {branchId: branchB}});
  assert.equal((await me(student)).status, 403);
});
test('AUDIT-NEW-25: inactive mapped branch immediately removes access', async () => {
  await db.collection('branches').updateOne({_id: branchA}, {$set: {isActive: false}});
  assert.equal((await me(student)).status, 403);
});
test('AUDIT-NEW-26: teacher-provisioning branch selector cannot reveal another school', async () => {
  const result = await http('/api/admin/teachers/branches', admin);
  assert.equal(result.status, 200, result.text);
  assert.deepEqual(result.data.data.map(row => row.id), [String(branchA)]);
});
test('AUDIT-NEW-27: suspended school cannot obtain a scoped database', async () => {
  await db.collection('schools').updateOne({_id: schoolA}, {$set: {isActive: false}});
  await assert.rejects(require('../src/schoolAccess').verifiedSchoolDatabase(db, admin.record));
});
const scoped = () => require('../src/schoolDatabase').createSchoolDatabase(db, schoolA).collection('branches');
test('AUDIT-NEW-28: OR filter cannot escape the school predicate in real MongoDB', async () => {
  const rows = await scoped().find({$or: [{schoolId: schoolB}, {}]}).toArray();
  assert.deepEqual(rows.map(row => String(row._id)), [String(branchA)]);
});
test('AUDIT-NEW-29: cross-school insert is rejected before persistence', () => assert.throws(() => scoped().insertOne({schoolId: schoolB, name: 'forged'})));
test('AUDIT-NEW-30: replacement cannot change school ownership', () => assert.throws(() => scoped().replaceOne({_id: branchA}, {schoolId: schoolB})));
test('AUDIT-NEW-31: bulk operation cannot change school ownership', () => assert.throws(() => scoped().bulkWrite([{updateOne: {filter: {}, update: {$set: {schoolId: schoolB}}}}])));
test('AUDIT-NEW-32: aggregate lookup cannot escape into another school collection', () => assert.throws(() => scoped().aggregate([{$lookup: {from: 'users', as: 'users', pipeline: []}}])));
test('AUDIT-NEW-33: executable MongoDB expressions are rejected', () => assert.throws(() => scoped().find({$where: 'return true'})));
test('AUDIT-NEW-34: anonymous Parent data access is denied', async () => assert.equal((await http('/api/parents/me')).status, 401));
test('AUDIT-NEW-35: Teacher cannot enter school administrator dashboard', async () => assert.equal((await http('/api/admin/dashboard', teacher)).status, 403));
test('AUDIT-NEW-36: Student cannot open Finance summary', async () => assert.equal((await http('/api/finance/summary', student)).status, 403));
test('AUDIT-NEW-37: live classroom remains unavailable without verified integration', async () => assert.equal((await http('/api/live-lessons', teacher)).status, 503));
test('AUDIT-NEW-38: legacy student directory retains bearer authentication', async () => assert.equal((await http('/api/students')).status, 401));
test('AUDIT-NEW-39: obsolete administrator JWT session API remains unavailable', async () => assert.equal((await http('/api/sessions', admin)).status, 503));
test('AUDIT-NEW-40: anonymous paper PDF download cannot bypass authentication', async () => assert.equal((await http('/api/exam-papers/guessed/pdf')).status, 401));
