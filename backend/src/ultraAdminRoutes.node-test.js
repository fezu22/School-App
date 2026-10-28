const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { createUltraAdminRouter } = require('./ultraAdminRoutes');

function createInMemoryDb() {
  const store = {
    users: [],
    schools: [],
    branches: [],
    students: [],
    refreshTokens: [],
    platformAuditLogs: [],
  };
  let failCollectionOnInsert = null;
  let insertDelayMs = 0;

  function matches(doc, query = {}) {
    return Object.entries(query).every(([key, val]) => {
      if (key === '$or') return val.some(sub => matches(doc, sub));
      if (val && typeof val === 'object' && !(val instanceof ObjectId) && !(val instanceof Date)) {
        if (val.$in) return val.$in.some(v => String(doc[key]) === String(v));
        if (val.$gt) return doc[key] > val.$gt;
        if (val.$ne !== undefined) return doc[key] !== val.$ne;
      }
      if (val === null) return doc[key] == null;
      return String(doc[key]) === String(val);
    });
  }

  const createdIndexes = [];
  let transactionSessionsUsed = 0;

  return {
    store,
    createdIndexes,
    getTransactionSessionsUsed() {
      return transactionSessionsUsed;
    },
    enableTransactionClient() {
      this.client = {
        startSession() {
          transactionSessionsUsed += 1;
          let snapshot = null;
          return {
            async withTransaction(fn) {
              snapshot = JSON.parse(JSON.stringify(store));
              try {
                await fn();
              } catch (err) {
                for (const key of Object.keys(store)) {
                  store[key].length = 0;
                  if (snapshot[key]) {
                    store[key].push(...snapshot[key]);
                  }
                }
                throw err;
              }
            },
            async endSession() {},
          };
        },
      };
    },
    setFailOnInsert(collectionName) {
      failCollectionOnInsert = collectionName;
    },
    setInsertDelayMs(ms) {
      insertDelayMs = ms;
    },
    collection(name) {
      if (!store[name]) store[name] = [];
      const rows = store[name];
      return {
        createIndex: async (spec, options = {}) => {
          createdIndexes.push({ collection: name, spec, options });
          return options.name || 'idx';
        },
        findOne: async query => rows.find(r => matches(r, query)) || null,
        find: query => {
          const filtered = rows.filter(r => matches(r, query));
          return {
            sort() { return this; },
            limit(n) { return { toArray: async () => filtered.slice(0, n) }; },
            toArray: async () => filtered,
          };
        },
        countDocuments: async query => rows.filter(r => matches(r, query)).length,
        insertOne: async doc => {
          if (insertDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, insertDelayMs));
          }
          if (failCollectionOnInsert === name) {
            throw new Error(`Simulated mid-write failure on ${name}.insertOne`);
          }
          rows.push({ ...doc });
          return { insertedId: doc._id || new ObjectId() };
        },
        updateOne: async (query, update) => {
          const target = rows.find(r => matches(r, query));
          if (!target) return { matchedCount: 0, modifiedCount: 0 };
          if (update.$set) Object.assign(target, update.$set);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        updateMany: async (query, update) => {
          let modifiedCount = 0;
          for (const row of rows) {
            if (matches(row, query)) {
              if (update.$set) Object.assign(row, update.$set);
              modifiedCount += 1;
            }
          }
          return { matchedCount: modifiedCount, modifiedCount };
        },
        deleteOne: async query => {
          const idx = rows.findIndex(r => matches(r, query));
          if (idx === -1) return { deletedCount: 0 };
          rows.splice(idx, 1);
          return { deletedCount: 1 };
        },
      };
    },
  };
}

function invokeRouter(router, { method, url, headers = {}, body, user }) {
  return new Promise((resolve, reject) => {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const req = {
      method,
      url,
      path: url.split('?')[0],
      headers: normalizedHeaders,
      get: name => normalizedHeaders[String(name).toLowerCase()],
      body,
      user,
    };
    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
    };
    router.handle(req, res, err => (err ? reject(err) : resolve({ status: 404, body: {} })));
  });
}

test('Ultra Admin bootstrap requires configured secret, provisions first admin once, and logs audit', async () => {
  const db = createInMemoryDb();
  const router = createUltraAdminRouter({ database: () => db });

  delete process.env.PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET;
  const disabled = await invokeRouter(router, {
    method: 'POST',
    url: '/bootstrap',
    body: { fullName: 'Platform Owner', email: 'ultra@platform.test', password: 'StrongPassword123!' },
  });
  assert.equal(disabled.status, 503);

  process.env.PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET = '0123456789abcdef0123456789abcdef_secret';
  const wrongSecret = await invokeRouter(router, {
    method: 'POST',
    url: '/bootstrap',
    headers: { 'X-Platform-Bootstrap-Secret': 'wrong' },
    body: { fullName: 'Platform Owner', email: 'ultra@platform.test', password: 'StrongPassword123!' },
  });
  assert.equal(wrongSecret.status, 403);

  const created = await invokeRouter(router, {
    method: 'POST',
    url: '/bootstrap',
    headers: { 'X-Platform-Bootstrap-Secret': process.env.PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET },
    body: { fullName: 'Platform Owner', email: 'ultra@platform.test', password: 'StrongPassword123!' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.role, 'ultra_admin');
  assert.equal(db.store.platformAuditLogs.length, 1);

  const duplicate = await invokeRouter(router, {
    method: 'POST',
    url: '/bootstrap',
    headers: { 'X-Platform-Bootstrap-Secret': process.env.PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET },
    body: { fullName: 'Second Owner', email: 'ultra2@platform.test', password: 'StrongPassword123!' },
  });
  assert.equal(duplicate.status, 409);
  delete process.env.PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET;
});

test('Ultra Admin provisions school, supports school detail, distinguishes recorded subscription from billing provider, suspends school, and denies student records', async () => {
  const db = createInMemoryDb();
  const ultraId = new ObjectId();
  const ultraUser = {
    id: ultraId.toHexString(),
    fullName: 'Ultra Admin',
    email: 'ultra@platform.test',
    role: 'ultra_admin',
  };
  const router = createUltraAdminRouter({ database: () => db });

  // School Super Admin cannot access Ultra Admin endpoints
  const deniedSuperAdmin = await invokeRouter(router, {
    method: 'GET',
    url: '/overview',
    user: { id: 'school-sa-1', role: 'super_admin' },
  });
  assert.equal(deniedSuperAdmin.status, 403);

  // Provision a new school + initial Super Admin
  const provisioned = await invokeRouter(router, {
    method: 'POST',
    url: '/schools',
    user: ultraUser,
    body: {
      name: 'Greenwood Academy',
      code: 'GWA',
      plan: 'growth',
      superAdminFullName: 'Amina Tariq',
      superAdminEmail: 'amina@greenwood.edu',
      superAdminPassword: 'CampusPassword123!',
    },
  });
  assert.equal(provisioned.status, 201);
  assert.equal(provisioned.body.data.school.code, 'GWA');
  assert.equal(provisioned.body.data.school.subscriptionVerification, 'recorded_only');
  assert.equal(provisioned.body.data.initialSuperAdmin.role, 'super_admin');
  const schoolId = provisioned.body.data.school.id;

  // Fetch school detail
  const detail = await invokeRouter(router, {
    method: 'GET',
    url: `/schools/${schoolId}`,
    user: ultraUser,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.school.code, 'GWA');
  assert.equal(detail.body.data.branches.length, 1);
  assert.equal(detail.body.data.superAdmins.length, 1);

  // Attempt to fake billingProviderVerified is rejected with 403
  const fakeBilling = await invokeRouter(router, {
    method: 'PATCH',
    url: `/schools/${schoolId}/subscription`,
    user: ultraUser,
    body: { plan: 'enterprise', billingProviderVerified: true },
  });
  assert.equal(fakeBilling.status, 403);

  // Updating recorded subscription status works and stays marked recorded_only
  const subUpdated = await invokeRouter(router, {
    method: 'PATCH',
    url: `/schools/${schoolId}/subscription`,
    user: ultraUser,
    body: { plan: 'enterprise', subscriptionStatus: 'active_recorded' },
  });
  assert.equal(subUpdated.status, 200);
  assert.equal(subUpdated.body.data.plan, 'enterprise');
  assert.equal(subUpdated.body.data.subscriptionStatus, 'active_recorded');
  assert.equal(subUpdated.body.data.subscriptionVerification, 'recorded_only');

  // Suspending the school revokes active sessions for users of that school
  const superAdminId = provisioned.body.data.initialSuperAdmin.id;
  db.store.refreshTokens.push({
    _id: new ObjectId(),
    tokenHash: 'a'.repeat(64),
    type: 'access',
    userId: superAdminId,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const suspended = await invokeRouter(router, {
    method: 'PATCH',
    url: `/schools/${schoolId}/status`,
    user: ultraUser,
    body: { status: 'suspended', reason: 'Annual renewal overdue' },
  });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.data.school.status, 'suspended');
  assert.equal(suspended.body.data.revokedSessions, 1);

  // Restoring school
  const restored = await invokeRouter(router, {
    method: 'PATCH',
    url: `/schools/${schoolId}/status`,
    user: ultraUser,
    body: { status: 'active', reason: 'Renewal settled' },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.school.isActive, true);

  // Ultra Admin is denied student-record access by default
  const studentDenied = await invokeRouter(router, {
    method: 'GET',
    url: '/students',
    user: ultraUser,
  });
  assert.equal(studentDenied.status, 403);
});

test('Atomic school onboarding rolls back orphan records on mid-write failure and prevents simultaneous duplicate creation', async () => {
  const db = createInMemoryDb();
  db.enableTransactionClient();
  const ultraUser = {
    id: new ObjectId().toHexString(),
    fullName: 'Ultra Admin',
    email: 'ultra@platform.test',
    role: 'ultra_admin',
  };
  const router = createUltraAdminRouter({ database: () => db });

  const onboardingPayload = {
    name: 'Crescent Heights School',
    code: 'CHS',
    plan: 'starter',
    superAdminFullName: 'Bilal Ahmed',
    superAdminEmail: 'bilal@crescent.edu',
    superAdminPassword: 'CampusPassword123!',
    idempotencyKey: 'idem-chs-001',
  };

  // 1. Mid-write failure when inserting initial Super Admin into `users` rolls back `schools` and `branches` via transaction session
  db.setFailOnInsert('users');
  const failedAttempt = await invokeRouter(router, {
    method: 'POST',
    url: '/schools',
    user: ultraUser,
    body: onboardingPayload,
  });
  assert.equal(failedAttempt.status, 500);
  assert.equal(db.store.schools.length, 0);
  assert.equal(db.store.branches.length, 0);
  assert.equal(db.store.users.length, 0);
  assert.equal(db.store.platformAuditLogs.length, 0);
  assert.ok(db.getTransactionSessionsUsed() >= 1);

  // 2. Mid-write failure when inserting `platformAuditLogs` rolls back `schools`, `branches`, and `users`
  db.setFailOnInsert('platformAuditLogs');
  const failedAuditAttempt = await invokeRouter(router, {
    method: 'POST',
    url: '/schools',
    user: ultraUser,
    body: onboardingPayload,
  });
  assert.equal(failedAuditAttempt.status, 500);
  assert.equal(db.store.schools.length, 0);
  assert.equal(db.store.branches.length, 0);
  assert.equal(db.store.users.length, 0);

  // 3. Simultaneous requests with the same school code or Super Admin email only provision once
  db.setFailOnInsert(null);
  db.setInsertDelayMs(15);
  const [sim1, sim2] = await Promise.all([
    invokeRouter(router, {
      method: 'POST',
      url: '/schools',
      user: ultraUser,
      body: onboardingPayload,
    }),
    invokeRouter(router, {
      method: 'POST',
      url: '/schools',
      user: ultraUser,
      body: onboardingPayload,
    }),
  ]);
  db.setInsertDelayMs(0);

  const statuses = [sim1.status, sim2.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(db.store.schools.length, 1);
  assert.equal(db.store.branches.length, 1);
  assert.equal(db.store.users.length, 1);
  assert.equal(String(db.store.users[0].branchId), String(db.store.branches[0].id));
  const indexNames = db.createdIndexes.map(idx => idx.options.name);
  assert.ok(indexNames.includes('unique_school_code'));
  assert.ok(indexNames.includes('unique_school_onboarding_idempotency'));
  assert.ok(indexNames.includes('unique_branch_code_per_school'));
  assert.ok(indexNames.includes('unique_user_email_lower'));

  // 4. Retrying with the exact same idempotencyKey and payload returns idempotent replay without duplicating records
  const replay = await invokeRouter(router, {
    method: 'POST',
    url: '/schools',
    user: ultraUser,
    body: onboardingPayload,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(db.store.schools.length, 1);

  // 5. Reusing the same idempotencyKey with different parameters is rejected with 409
  const mismatchedReplay = await invokeRouter(router, {
    method: 'POST',
    url: '/schools',
    user: ultraUser,
    body: { ...onboardingPayload, name: 'Different School Name' },
  });
  assert.equal(mismatchedReplay.status, 409);
});
