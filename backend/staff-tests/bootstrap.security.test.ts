import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';

import app from '../src/staff/src/app';
import User from '../src/staff/src/models/user';
import Branch from '../src/staff/src/models/branch';
import {createUser} from '../src/staff/src/services/auth.service';
import {comparePassword} from '../src/staff/src/utils/password';

// Never load dotenv or use MONGODB_URI: this suite owns an ephemeral database.
const secret = 'test-only-bootstrap-secret-at-least-32-characters';
const account = {
  fullName: 'Initial Administrator',
  email: 'initial@example.com',
  password: 'StrongTestPassword123!',
};
const originalSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
const originalJwtSecret = process.env.JWT_SECRET;
let database: MongoMemoryServer;
let server: Server;
let baseUrl: string;

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), {
    dbName: 'bootstrap_security_tests',
    autoIndex: false,
  });
  // Existing account uniqueness is part of the application model.
  await User.collection.createIndex({email: 1}, {unique: true});
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

beforeEach(async () => {
  mock.restoreAll();
  process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = secret;
  process.env.JWT_SECRET = 'test-only-jwt-secret';
  // Only the in-memory database created above is ever mutated.
  await User.deleteMany({});
  await Branch.deleteMany({});
});

after(async () => {
  mock.restoreAll();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  await mongoose.disconnect();
  if (database) await database.stop();
  if (originalSecret === undefined) delete process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  else process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = originalSecret;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  assert.equal(raw.includes(secret), false, 'Response must not expose bootstrap secret');
  assert.equal(raw.includes(account.password), false, 'Response must not expose password');
  assert.equal(raw.includes('bootstrapKey'), false, 'Response must not expose internal marker');
  return {status: response.status, data: JSON.parse(raw)};
};

const bootstrap = (body: unknown = account, suppliedSecret: string | undefined = secret) =>
  post('/bootstrap/super-admin', body,
    suppliedSecret === undefined ? {} : {'X-Bootstrap-Secret': suppliedSecret});

test('missing secret is rejected before any database operation', async () => {
  mock.method(User.collection, 'createIndex', () => {throw new Error('DB must not be reached');});
  const result = await post('/bootstrap/super-admin', account);
  assert.equal(result.status, 403);
  assert.equal(await User.countDocuments(), 0);
});

test('incorrect secret is rejected without creating an account', async () => {
  assert.equal((await bootstrap(account, 'incorrect')).status, 403);
  assert.equal(await User.countDocuments(), 0);
});

test('unconfigured, empty or weak server secret disables bootstrap', async () => {
  for (const value of [undefined, '', 'too-short']) {
    if (value === undefined) delete process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
    else process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = value;
    assert.equal((await bootstrap()).status, 503);
  }
  assert.equal(await User.countDocuments(), 0);
});

test('correct secret creates one validated, hashed Super Admin with safe response', async () => {
  const result = await bootstrap({...account, email: ' INITIAL@EXAMPLE.COM ', fullName: ' Initial Administrator '});
  assert.equal(result.status, 201);
  assert.equal(result.data.user.role, 'super_admin');
  assert.equal(result.data.user.email, account.email);
  assert.equal(result.data.user.isActive, true);
  assert.equal(result.data.user.password, undefined);
  assert.equal(result.data.accessToken, undefined);
  const user = await User.findOne({email: account.email}).select('+bootstrapKey');
  assert.ok(user);
  assert.equal(user.role, 'super_admin');
  assert.equal(user.branchId, null);
  assert.equal(user.bootstrapKey, 'super-admin');
  assert.notEqual(user.password, account.password);
  assert.equal(await comparePassword(account.password, user.password), true);
  assert.equal(await User.countDocuments(), 1);
  const index = (await User.collection.indexes()).find(item => item.name === 'unique_super_admin_bootstrap');
  assert.equal(index?.unique, true);
  assert.deepEqual(index?.partialFilterExpression, {bootstrapKey: {$type: 'string'}});
});

test('second bootstrap is rejected', async () => {
  assert.equal((await bootstrap()).status, 201);
  assert.equal((await bootstrap({...account, email: 'second@example.com'})).status, 409);
  assert.equal(await User.countDocuments({role: 'super_admin'}), 1);
});

test('pre-existing inactive Super Admin without a bootstrap marker also blocks bootstrap', async () => {
  const user = await createUser({...account, role: 'super_admin'});
  await User.updateOne({_id: user._id}, {$set: {isActive: false}});
  assert.equal((await bootstrap({...account, email: 'another@example.com'})).status, 409);
  assert.equal(await User.countDocuments(), 1);
});

test('caller roles and privileged/internal fields are rejected', async () => {
  for (const fields of [
    {role: 'super_admin'}, {role: 'student'}, {permissions: ['*']},
    {branchId: new mongoose.Types.ObjectId().toString()}, {isActive: false},
    {bootstrapKey: 'super-admin'}, {SUPER_ADMIN_BOOTSTRAP_SECRET: secret},
  ]) {
    assert.equal((await bootstrap({...account, ...fields})).status, 400);
  }
  assert.equal(await User.countDocuments(), 0);
  // The accepted request has no role field; only the server chooses the role.
  assert.equal((await bootstrap()).data.user.role, 'super_admin');
});

test('invalid bodies, types, email and passwords are rejected', async () => {
  for (const body of [
    null, [], {}, true, 'invalid', {...account, fullName: 42}, {...account, fullName: ' '},
    {...account, fullName: 'x'.repeat(101)}, {...account, email: 'invalid'},
    {...account, email: {}}, {...account, password: 'short'},
    {...account, password: ' '.repeat(12)}, {...account, password: 'x'.repeat(73)},
    {...account, password: 'é'.repeat(37)}, {...account, phone: 123},
  ]) {
    assert.equal((await bootstrap(body)).status, 400);
  }
  assert.equal(await User.countDocuments(), 0);
});

test('malformed JSON does not expose submitted credentials or a parser stack', async () => {
  const response = await fetch(`${baseUrl}/bootstrap/super-admin`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Bootstrap-Secret': secret},
    body: `{"password":"${account.password}",`,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {success: false, message: 'Invalid bootstrap request'});
  assert.equal(await User.countDocuments(), 0);
});

test('duplicate email fails safely without reserving bootstrap permanently', async () => {
  const branch = await Branch.create({name: 'Test', code: 'TEST', address: 'Test', city: 'Test'});
  await createUser({...account, role: 'student', branchId: branch._id.toString()});
  assert.equal((await bootstrap()).status, 409);
  assert.equal(await User.countDocuments({role: 'super_admin'}), 0);
  assert.equal((await bootstrap({...account, email: 'unique@example.com'})).status, 201);
});

test('concurrent requests against MongoDB create exactly one bootstrap account', {timeout: 30000}, async () => {
  // Force every request past the existence check so the unique index, rather
  // than sequential execution or the precheck, must prevent duplicate admins.
  const contenders = 6;
  let arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>(resolve => {release = resolve;});
  mock.method(User, 'exists', async () => {
    if (++arrived === contenders) release();
    await barrier;
    return null;
  });
  const results = await Promise.all(Array.from({length: contenders}, (_, index) =>
    bootstrap({...account, email: `concurrent-${index}@example.com`})));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, contenders - 1);
  assert.equal(await User.countDocuments({role: 'super_admin'}), 1);
});

test('index failure fails closed and does not leak internals', async () => {
  mock.method(User.collection, 'createIndex', async () => {throw new Error(`private ${secret}`);});
  const result = await bootstrap();
  assert.equal(result.status, 500);
  assert.equal(result.data.message, 'Failed to provision Super Admin');
  assert.equal(await User.countDocuments(), 0);
});

test('database query failure is sanitized and creates no account', async () => {
  mock.method(User, 'exists', async () => {throw new Error(`private ${secret}`);});
  assert.equal((await bootstrap()).status, 500);
  assert.equal(await User.countDocuments(), 0);
});

test('account write failure does not consume bootstrap or leak database internals', async () => {
  mock.method(User.prototype, 'save', async () => {throw new Error(`private ${secret}`);});
  assert.equal((await bootstrap()).status, 500);
  assert.equal(await User.countDocuments(), 0);
  mock.restoreAll();
  assert.equal((await bootstrap()).status, 201);
});

test('ordinary user creation is not constrained by the bootstrap singleton', async () => {
  assert.equal((await bootstrap()).status, 201);
  await createUser({...account, email: 'managed@example.com', role: 'super_admin'});
  assert.equal(await User.countDocuments({role: 'super_admin'}), 2);
  assert.equal(await User.countDocuments({bootstrapKey: 'super-admin'}), 1);
});

test('normal authenticated Principal provisioning still works and role guards reject students', async () => {
  assert.equal((await bootstrap()).status, 201);
  const login = await post('/auth/login', {email: account.email, password: account.password});
  assert.equal(login.status, 200);
  const branch = await Branch.create({name: 'Test', code: 'TEST', address: 'Test', city: 'Test'});
  const principal = {...account, email: 'principal@example.com', branchId: branch._id.toString()};
  assert.equal((await post('/admin/principals', principal)).status, 401);
  assert.equal((await post('/admin/principals', principal, {
    Authorization: `Bearer ${login.data.accessToken}`,
  })).status, 201);
  await createUser({...principal, email: 'student@example.com', role: 'student'});
  const studentLogin = await post('/auth/login', {email: 'student@example.com', password: account.password});
  assert.equal((await post('/admin/principals', {...principal, email: 'denied@example.com'}, {
    Authorization: `Bearer ${studentLogin.data.accessToken}`,
  })).status, 403);
});

test('public registration cannot accept a privileged role', async () => {
  const branch = await Branch.create({name: 'Test', code: 'TEST', address: 'Test', city: 'Test'});
  const result = await post('/auth/register', {
    ...account, branchId: branch._id.toString(), role: 'super_admin', permissions: ['*'],
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.user.role, 'student');
  assert.equal(await User.countDocuments({role: 'super_admin'}), 0);
});
