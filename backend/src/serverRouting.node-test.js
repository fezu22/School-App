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
    for (const path of ['/api/live-lessons', '/api/live-lessons/test', '/api/staff-students/enrollment-options', '/api/attendance-review', '/api/sessions', '/api/sessions/abc/revoke', '/api/privileged-requests/pending', '/api/privileged-requests/abc/review', '/api/automation', '/api/automation/test/pause', '/api/usage', '/api/backup', '/api/health']) assert.equal((await get(path)).status, 503, path);
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
