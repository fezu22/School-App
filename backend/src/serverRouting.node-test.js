const {test} = require('node:test');
const assert = require('node:assert/strict');
const {request} = require('node:http');

async function withServer(app, action) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = path => new Promise((resolve, reject) => {
    const req = request({hostname: '127.0.0.1', port: server.address().port, path, method: 'GET'}, res => {
      let body = '';
      res.on('data', part => {body += part;});
      res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(body)}));
    });
    req.on('error', reject);
    req.end();
  });
  try {await action(get);} finally {await new Promise(resolve => server.close(resolve));}
}

test('integrated outer routes retain learner auth, mount papers and refuse unverified live lessons', async () => {
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  // Import app only: startServer, database connection and index initialization
  // are deliberately never called by this smoke test.
  const {app} = require('./server');
  await withServer(app, async get => {
    for (const path of ['/api/students', '/api/students/abc', '/api/students/me', '/api/parents/me', '/api/exam-papers']) assert.equal((await get(path)).status, 401, path);
    for (const path of ['/api/live-lessons', '/api/live-lessons/test', '/api/staff-students/enrollment-options', '/api/attendance-review', '/api/sessions', '/api/sessions/abc/revoke', '/api/usage', '/api/backup', '/api/health']) assert.equal((await get(path)).status, 503, path);
  });
  delete process.env.INTEGRATED_STAFF_ENABLED;
});

test('partner router imports resolve and protected staff endpoints are mounted', async () => {
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  require('tsx/cjs/api').register();
  const imported = require('./staff/src/app.ts');
  await withServer(imported.default || imported, async get => {
    for (const path of ['/api/admin/dashboard', '/api/teacher/home', '/api/staff-students/enrollment-options', '/api/students/enrollment-options']) assert.equal((await get(path)).status, 401, path);
    assert.equal((await get('/api/live-lessons')).status, 503);
  });
  delete process.env.INTEGRATED_STAFF_ENABLED;
});

test('disabled online payments block status reconciliation before database access', async () => {
  delete process.env.ONLINE_PAYMENTS_VERIFIED;
  delete process.env.CARD_PROVIDER_WEBHOOK_SECRET;
  const express = require('express');
  const app = express();
  app.use(require('./parentPaymentRoutes'));
  await withServer(app, async get => {
    const config = await get('/checkout/config');
    assert.equal(config.status, 200);
    assert.equal(config.body.data.enabled, false);
    for (const path of ['/transactions/aaaaaaaaaaaaaaaaaaaaaaaa/status', '/batches/aaaaaaaaaaaaaaaaaaaaaaaa/status', '/checkout/batch']) assert.equal((await get(path)).status, 503);
  });
});

test('SUPER_ADMIN_BOOTSTRAP_SECRET and CARD_PROVIDER_WEBHOOK_SECRET are optional at startup and disable legacy bootstrap when absent', async () => {
  delete process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  delete process.env.CARD_PROVIDER_WEBHOOK_SECRET;
  require('tsx/cjs/api').register();
  const imported = require('./staff/src/app.ts');
  const staffApp = imported.default || imported;
  const server = staffApp.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/bootstrap/super-admin`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({fullName: 'Admin', email: 'admin@example.com', password: 'StrongPassword123!'}),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.message, 'Super Admin bootstrap is disabled');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('unified ZEGO configuration contract aligns server, staff app, and RTC provider, rejects conflicting aliases, and hides serverSecret', () => {
  const { resolveZegoConfiguration, isZegoLiveLessonEnabled } = require('./zegoConfig');
  const { ZegoRtcProvider } = require('./staff/src/services/rtc/zego-rtc-provider');
  const secret32 = '0123456789abcdef0123456789abcdef';

  // 1. Canonical ZEGOCLOUD_* variables enable both server gate and provider
  const canonicalEnv = {
    LIVE_LESSON_ENABLED: 'true',
    ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'true',
    ZEGOCLOUD_APP_ID: '102030',
    ZEGOCLOUD_SERVER_SECRET: secret32,
  };
  assert.equal(isZegoLiveLessonEnabled(canonicalEnv), true);
  const provider1 = new ZegoRtcProvider(canonicalEnv);
  assert.deepEqual(provider1.publicConfig(), { provider: 'zegocloud', appId: 102030 });

  // 2. Aliased ZEGO_* variables also satisfy the unified contract when consistent
  const aliasedEnv = {
    LIVE_LESSONS_VERIFIED: 'true',
    ZEGO_ROOM_PRIVILEGES_ENABLED: 'true',
    ZEGO_APP_ID: '102030',
    ZEGO_SERVER_SECRET: secret32,
  };
  assert.equal(isZegoLiveLessonEnabled(aliasedEnv), true);
  const provider2 = new ZegoRtcProvider(aliasedEnv);
  assert.deepEqual(provider2.publicConfig(), { provider: 'zegocloud', appId: 102030 });

  // 3. Missing room privileges flag fails closed even when AppID and Secret are present
  const missingPrivileges = {
    LIVE_LESSONS_VERIFIED: 'true',
    ZEGO_APP_ID: '102030',
    ZEGO_SERVER_SECRET: secret32,
  };
  assert.equal(isZegoLiveLessonEnabled(missingPrivileges), false);
  assert.throws(() => new ZegoRtcProvider(missingPrivileges));

  // 4. Conflicting alias values are rejected and fail closed
  const conflictingAppId = {
    ...canonicalEnv,
    ZEGO_APP_ID: '999999',
  };
  const conflictConfig = resolveZegoConfiguration(conflictingAppId);
  assert.equal(conflictConfig.enabled, false);
  assert.equal(conflictConfig.conflict, true);
  assert.throws(() => new ZegoRtcProvider(conflictingAppId));

  const conflictingSecret = {
    ...canonicalEnv,
    ZEGO_SERVER_SECRET: 'fedcba9876543210fedcba9876543210',
  };
  assert.equal(isZegoLiveLessonEnabled(conflictingSecret), false);
  assert.throws(() => new ZegoRtcProvider(conflictingSecret));

  const conflictingEnableFlag = {
    ...canonicalEnv,
    LIVE_LESSONS_VERIFIED: 'false',
  };
  assert.equal(isZegoLiveLessonEnabled(conflictingEnableFlag), false);

  // 5. ServerSecret is non-enumerable and never serialized into JSON or publicConfig
  const resolved = resolveZegoConfiguration(canonicalEnv);
  assert.equal(JSON.stringify(resolved).includes(secret32), false);
  assert.equal(JSON.stringify(provider1.publicConfig()).includes(secret32), false);
});

