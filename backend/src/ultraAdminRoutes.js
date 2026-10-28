const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getClient, getDatabase } = require('./database');
const { authenticateRequest, hashPassword, normalizeEmail } = require('./auth');
const { schoolObjectId } = require('./schoolDatabase');

const VALID_PLANS = new Set(['starter', 'growth', 'enterprise']);
const VALID_SUBSCRIPTION_STATUSES = new Set([
  'trial',
  'active_recorded',
  'past_due',
  'suspended',
]);

const DEFAULT_PLAN_LIMITS = {
  starter: { maxBranches: 2, maxStudents: 500, maxStaff: 50 },
  growth: { maxBranches: 5, maxStudents: 2000, maxStaff: 200 },
  enterprise: { maxBranches: 25, maxStudents: 10000, maxStaff: 1000 },
};

function badRequest(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function cleanText(value, label, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw badRequest(`${label} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function verifyBootstrapHeader(req) {
  const configured = process.env.PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET;
  if (
    typeof configured !== 'string' ||
    configured.trim().length < 32 ||
    /^(unconfigured|placeholder|dummy|replace_me)/i.test(configured.trim())
  ) {
    throw badRequest('Ultra Admin platform bootstrap is disabled.', 503);
  }
  const supplied = req.get('X-Platform-Bootstrap-Secret');
  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw badRequest('Platform bootstrap authorization failed.', 403);
  }
  const digest = value => crypto.createHash('sha256').update(value).digest();
  if (!crypto.timingSafeEqual(digest(supplied), digest(configured))) {
    throw badRequest('Platform bootstrap authorization failed.', 403);
  }
}

function requireUltraAdmin(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication is required.' });
  }
  if (req.user.role !== 'ultra_admin') {
    return res.status(403).json({
      success: false,
      error: 'Ultra Admin platform authority is required.',
    });
  }
  return next();
}

async function recordPlatformAudit(db, actorUserId, action, targetId, metadata = {}, session = undefined) {
  const entry = {
    _id: new ObjectId(),
    id: crypto.randomUUID(),
    actorUserId: String(actorUserId),
    actorRole: 'ultra_admin',
    action,
    targetId: String(targetId || ''),
    metadata,
    createdAt: new Date(),
  };
  await db.collection('platformAuditLogs').insertOne(entry, session ? { session } : undefined);
  return entry;
}

function formatSchoolSummary(school, counts = {}) {
  const id = school._id instanceof ObjectId ? school._id.toHexString() : String(school._id || school.id);
  const plan = VALID_PLANS.has(school.plan) ? school.plan : 'starter';
  const limits = school.usageLimits || DEFAULT_PLAN_LIMITS[plan];
  const billingProviderVerified =
    school.billingProviderVerified === true &&
    typeof school.billingSettlementRef === 'string' &&
    school.billingSettlementRef.length > 0;

  return {
    id,
    name: school.name || 'School',
    code: school.code || '',
    status: school.status || (school.isActive === false || school.active === false ? 'suspended' : 'active'),
    isActive: school.isActive !== false && school.active !== false && school.status !== 'suspended',
    plan,
    subscriptionStatus: school.subscriptionStatus || 'trial',
    subscriptionVerification: billingProviderVerified ? 'provider_verified' : 'recorded_only',
    billingProviderVerified,
    billingSettlementRef: billingProviderVerified ? school.billingSettlementRef : null,
    usageLimits: limits,
    usage: {
      branches: Number(counts.branches || 0),
      staff: Number(counts.staff || 0),
      students: Number(counts.students || 0),
    },
    createdAt: school.createdAt || null,
    updatedAt: school.updatedAt || null,
  };
}

async function ensureOnboardingIndexes(db) {
  const safeCreateIndex = async (collectionName, spec, options) => {
    const col = db.collection(collectionName);
    if (typeof col.createIndex === 'function') {
      await col.createIndex(spec, options).catch(() => {});
    }
  };
  await Promise.all([
    safeCreateIndex('schools', { code: 1 }, { unique: true, name: 'unique_school_code' }),
    safeCreateIndex(
      'schools',
      { onboardingIdempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { onboardingIdempotencyKey: { $type: 'string' } },
        name: 'unique_school_onboarding_idempotency',
      },
    ),
    safeCreateIndex('branches', { schoolId: 1, code: 1 }, { unique: true, name: 'unique_branch_code_per_school' }),
    safeCreateIndex(
      'users',
      { emailLower: 1 },
      {
        unique: true,
        partialFilterExpression: { emailLower: { $type: 'string' } },
        name: 'unique_user_email_lower',
      },
    ),
  ]);
}

function resolveMongoClient(db) {
  if (db?.client && typeof db.client.startSession === 'function') {
    return db.client;
  }
  try {
    const client = typeof getClient === 'function' ? getClient() : null;
    if (client && typeof client.startSession === 'function') {
      return client;
    }
  } catch {
    // Fallback when running with an isolated test double without a live MongoClient
  }
  return null;
}

async function runAtomicOnboarding(db, writeSteps, rollbackSteps) {
  const client = resolveMongoClient(db);
  if (client && typeof client.startSession === 'function') {
    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await writeSteps(session);
      });
      return result;
    } catch (txError) {
      await rollbackSteps().catch(() => {});
      throw txError;
    } finally {
      await session.endSession().catch(() => {});
    }
  }

  try {
    return await writeSteps(undefined);
  } catch (err) {
    await rollbackSteps().catch(() => {});
    throw err;
  }
}

function createUltraAdminRouter({
  database = getDatabase,
  authenticate = authenticateRequest,
} = {}) {
  const router = express.Router();
  const inFlightKeys = new Set();

  // Controlled first Ultra Admin setup (runs before normal Bearer auth)
  router.post('/bootstrap', async (req, res) => {
    const lockKey = 'bootstrap:ultra_admin';
    if (inFlightKeys.has(lockKey)) {
      return res.status(409).json({
        success: false,
        error: 'Ultra Admin bootstrap is already in progress.',
      });
    }
    inFlightKeys.add(lockKey);
    try {
      verifyBootstrapHeader(req);
      const db = database();
      const existing = await db.collection('users').findOne({ role: 'ultra_admin' });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'Initial Ultra Admin has already been provisioned.',
        });
      }

      const fullName = cleanText(req.body?.fullName, 'Full name', 120);
      const emailLower = normalizeEmail(req.body?.email);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!emailLower || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
        throw badRequest('A valid email address is required.');
      }
      if (password.length < 12) {
        throw badRequest('Ultra Admin password must be at least 12 characters.');
      }

      const duplicateEmail = await db.collection('users').findOne({
        $or: [{ emailLower }, { email: emailLower }],
      });
      if (duplicateEmail) {
        return res.status(409).json({ success: false, error: 'Email is already registered.' });
      }

      const now = new Date();
      const userId = new ObjectId();
      const credentials = hashPassword(password);
      const record = {
        _id: userId,
        id: userId.toHexString(),
        fullName,
        email: emailLower,
        emailLower,
        role: 'ultra_admin',
        active: true,
        isActive: true,
        ...credentials,
        createdAt: now,
        updatedAt: now,
      };

      let auditEntry = null;
      await runAtomicOnboarding(
        db,
        async session => {
          await db.collection('users').insertOne(record, session ? { session } : undefined);
          auditEntry = await recordPlatformAudit(
            db,
            record.id,
            'ultra_admin.bootstrapped',
            record.id,
            { email: emailLower },
            session,
          );
        },
        async () => {
          await db.collection('users').deleteOne({ _id: userId });
          if (auditEntry?._id) {
            await db.collection('platformAuditLogs').deleteOne({ _id: auditEntry._id });
          }
        },
      );

      return res.status(201).json({
        success: true,
        data: {
          id: record.id,
          fullName: record.fullName,
          email: record.email,
          role: 'ultra_admin',
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to bootstrap Ultra Admin.',
      });
    } finally {
      inFlightKeys.delete(lockKey);
    }
  });

  router.use((req, res, next) => {
    if (req.user?.id && req.user?.role) return next();
    return authenticate(req, res, next);
  });
  router.use(requireUltraAdmin);

  // Explicit guard: Ultra Admin never receives unrestricted student/parent/academic record access by default
  router.all(
    ['/students', '/students/*splat', '/parents', '/parents/*splat', '/academic', '/academic/*splat', '/records/*splat'],
    (_req, res) => {
      return res.status(403).json({
        success: false,
        error: 'Ultra Admin does not have unrestricted student-record access by default.',
      });
    },
  );

  router.get('/overview', async (_req, res) => {
    try {
      const db = database();
      const schools = await db.collection('schools').find({}).sort({ createdAt: -1 }).limit(200).toArray();
      const auditLogs = await db.collection('platformAuditLogs').find({}).sort({ createdAt: -1 }).limit(50).toArray();

      let activeSchools = 0;
      let suspendedSchools = 0;
      let providerVerifiedCount = 0;
      let recordedSubscriptionCount = 0;

      for (const s of schools) {
        const suspended = s.isActive === false || s.active === false || s.status === 'suspended';
        if (suspended) suspendedSchools += 1;
        else activeSchools += 1;

        if (s.billingProviderVerified === true && s.billingSettlementRef) providerVerifiedCount += 1;
        else recordedSubscriptionCount += 1;
      }

      return res.json({
        success: true,
        data: {
          metrics: {
            totalSchools: schools.length,
            activeSchools,
            suspendedSchools,
            providerVerifiedSubscriptions: providerVerifiedCount,
            recordedOnlySubscriptions: recordedSubscriptionCount,
          },
          recentAuditLogs: auditLogs,
        },
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Unable to load platform overview.' });
    }
  });

  router.get('/schools', async (_req, res) => {
    try {
      const db = database();
      const schools = await db.collection('schools').find({}).sort({ createdAt: -1 }).limit(200).toArray();
      const enriched = await Promise.all(
        schools.map(async school => {
          const schoolId = school._id;
          const [branches, staff, students] = await Promise.all([
            db.collection('branches').countDocuments({ schoolId }),
            db.collection('users').countDocuments({
              schoolId,
              role: { $in: ['super_admin', 'principal', 'teacher', 'finance'] },
            }),
            db.collection('students').countDocuments({ schoolId }),
          ]);
          return formatSchoolSummary(school, { branches, staff, students });
        }),
      );
      return res.json({ success: true, data: enriched });
    } catch {
      return res.status(500).json({ success: false, error: 'Unable to list schools.' });
    }
  });

  router.get('/schools/:schoolId', async (req, res) => {
    try {
      const db = database();
      let schoolId;
      try {
        schoolId = schoolObjectId(req.params.schoolId);
      } catch {
        throw badRequest('A valid school ID is required.');
      }

      const school = await db.collection('schools').findOne({ _id: schoolId });
      if (!school) {
        return res.status(404).json({ success: false, error: 'School was not found.' });
      }

      const [branchesList, staffCount, studentsCount, superAdmins, auditLogs] = await Promise.all([
        db.collection('branches').find({ schoolId }).sort({ createdAt: 1 }).limit(100).toArray(),
        db.collection('users').countDocuments({
          schoolId,
          role: { $in: ['super_admin', 'principal', 'teacher', 'finance'] },
        }),
        db.collection('students').countDocuments({ schoolId }),
        db
          .collection('users')
          .find({ schoolId, role: 'super_admin' })
          .limit(20)
          .toArray(),
        db
          .collection('platformAuditLogs')
          .find({ targetId: schoolId.toHexString() })
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray(),
      ]);

      return res.json({
        success: true,
        data: {
          school: formatSchoolSummary(school, {
            branches: branchesList.length,
            staff: staffCount,
            students: studentsCount,
          }),
          branches: branchesList.map(b => ({
            id: b.id || String(b._id),
            name: b.name,
            code: b.code,
            isActive: b.isActive !== false && b.active !== false,
          })),
          superAdmins: superAdmins.map(u => ({
            id: u.id || String(u._id),
            fullName: u.fullName,
            email: u.email,
            isActive: u.isActive !== false && u.active !== false,
          })),
          auditLogs,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to load school details.',
      });
    }
  });

  router.post('/schools', async (req, res) => {
    let lockKeys = [];
    try {
      const db = database();
      const name = cleanText(req.body?.name, 'School name', 140);
      const code = cleanText(req.body?.code, 'School code', 32).toUpperCase();
      const branchName = cleanText(req.body?.initialBranchName || `${name} Main Campus`, 'Initial branch name', 140);
      const branchCode = cleanText(req.body?.initialBranchCode || `${code}-MAIN`, 'Initial branch code', 32).toUpperCase();
      const adminFullName = cleanText(req.body?.superAdminFullName, 'Initial Super Admin full name', 120);
      const adminEmail = normalizeEmail(req.body?.superAdminEmail);
      const adminPassword = typeof req.body?.superAdminPassword === 'string' ? req.body.superAdminPassword : '';
      const plan = VALID_PLANS.has(req.body?.plan) ? req.body.plan : 'starter';
      const rawIdempotencyKey =
        (typeof req.get === 'function' && req.get('Idempotency-Key')) ||
        req.body?.idempotencyKey ||
        '';
      const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';

      if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        throw badRequest('A valid initial Super Admin email is required.');
      }
      if (adminPassword.length < 10) {
        throw badRequest('Initial Super Admin password must be at least 10 characters.');
      }

      const requestFingerprint = crypto
        .createHash('sha256')
        .update(JSON.stringify({ name, code, branchName, branchCode, adminFullName, adminEmail, plan }))
        .digest('hex');

      if (idempotencyKey) {
        const existingByKey = await db.collection('schools').findOne({ onboardingIdempotencyKey: idempotencyKey });
        if (existingByKey) {
          if (existingByKey.onboardingFingerprint !== requestFingerprint) {
            return res.status(409).json({
              success: false,
              error: 'Idempotency key was already used with different school onboarding parameters.',
            });
          }
          const existingBranch = await db.collection('branches').findOne({ schoolId: existingByKey._id });
          const existingAdmin = await db.collection('users').findOne({
            schoolId: existingByKey._id,
            role: 'super_admin',
          });
          if (existingBranch && existingAdmin) {
            return res.status(200).json({
              success: true,
              idempotentReplay: true,
              data: {
                school: formatSchoolSummary(existingByKey, { branches: 1, staff: 1, students: 0 }),
                initialBranch: { id: existingBranch.id || String(existingBranch._id), name: existingBranch.name, code: existingBranch.code },
                initialSuperAdmin: {
                  id: existingAdmin.id || String(existingAdmin._id),
                  fullName: existingAdmin.fullName,
                  email: existingAdmin.email,
                  role: 'super_admin',
                },
              },
            });
          }
        }
      }

      lockKeys = [
        `schoolCode:${code}`,
        `adminEmail:${adminEmail}`,
        ...(idempotencyKey ? [`idempotency:${idempotencyKey}`] : []),
      ];
      if (lockKeys.some(k => inFlightKeys.has(k))) {
        return res.status(409).json({
          success: false,
          error: 'A concurrent school onboarding request with the same code or Super Admin email is already in progress.',
        });
      }
      lockKeys.forEach(k => inFlightKeys.add(k));
      await ensureOnboardingIndexes(db);

      const existingSchool = await db.collection('schools').findOne({ code });
      if (existingSchool) {
        return res.status(409).json({ success: false, error: 'School code already exists.' });
      }
      const existingUser = await db.collection('users').findOne({
        $or: [{ emailLower: adminEmail }, { email: adminEmail }],
      });
      if (existingUser) {
        return res.status(409).json({ success: false, error: 'Initial Super Admin email is already in use.' });
      }

      const now = new Date();
      const schoolId = new ObjectId();
      const branchId = new ObjectId();
      const superAdminId = new ObjectId();
      const limits = {
        ...DEFAULT_PLAN_LIMITS[plan],
        ...(req.body?.usageLimits && typeof req.body.usageLimits === 'object'
          ? {
              maxBranches: Math.max(1, Number(req.body.usageLimits.maxBranches) || DEFAULT_PLAN_LIMITS[plan].maxBranches),
              maxStudents: Math.max(10, Number(req.body.usageLimits.maxStudents) || DEFAULT_PLAN_LIMITS[plan].maxStudents),
              maxStaff: Math.max(5, Number(req.body.usageLimits.maxStaff) || DEFAULT_PLAN_LIMITS[plan].maxStaff),
            }
          : {}),
      };

      const schoolDoc = {
        _id: schoolId,
        name,
        code,
        status: 'active',
        active: true,
        isActive: true,
        plan,
        subscriptionStatus: 'trial',
        billingProviderVerified: false,
        billingSettlementRef: null,
        usageLimits: limits,
        ...(idempotencyKey
          ? { onboardingIdempotencyKey: idempotencyKey, onboardingFingerprint: requestFingerprint }
          : {}),
        createdAt: now,
        updatedAt: now,
      };

      const branchDoc = {
        _id: branchId,
        id: branchId.toHexString(),
        schoolId,
        name: branchName,
        code: branchCode,
        active: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const credentials = hashPassword(adminPassword);
      const superAdminDoc = {
        _id: superAdminId,
        id: superAdminId.toHexString(),
        schoolId,
        branchId: branchDoc.id,
        fullName: adminFullName,
        email: adminEmail,
        emailLower: adminEmail,
        role: 'super_admin',
        active: true,
        isActive: true,
        ...credentials,
        createdAt: now,
        updatedAt: now,
      };

      let createdAudit = null;
      await runAtomicOnboarding(
        db,
        async session => {
          const opts = session ? { session } : undefined;
          // Double-check uniqueness inside transaction/critical section
          const [dupSchool, dupUser] = await Promise.all([
            db.collection('schools').findOne({ code }, opts),
            db.collection('users').findOne(
              { $or: [{ emailLower: adminEmail }, { email: adminEmail }] },
              opts,
            ),
          ]);
          if (dupSchool) {
            throw badRequest('School code already exists.', 409);
          }
          if (dupUser) {
            throw badRequest('Initial Super Admin email is already in use.', 409);
          }

          await db.collection('schools').insertOne(schoolDoc, opts);
          await db.collection('branches').insertOne(branchDoc, opts);
          await db.collection('users').insertOne(superAdminDoc, opts);
          createdAudit = await recordPlatformAudit(
            db,
            req.user.id,
            'school.provisioned',
            schoolId.toHexString(),
            {
              schoolCode: code,
              plan,
              initialBranchId: branchDoc.id,
              initialSuperAdminId: superAdminDoc.id,
            },
            session,
          );
        },
        async () => {
          if (createdAudit?._id) {
            await db.collection('platformAuditLogs').deleteOne({ _id: createdAudit._id }).catch(() => {});
          }
          await db.collection('users').deleteOne({ _id: superAdminId }).catch(() => {});
          await db.collection('branches').deleteOne({ _id: branchId }).catch(() => {});
          await db.collection('schools').deleteOne({ _id: schoolId }).catch(() => {});
        },
      );

      return res.status(201).json({
        success: true,
        data: {
          school: formatSchoolSummary(schoolDoc, { branches: 1, staff: 1, students: 0 }),
          initialBranch: { id: branchDoc.id, name: branchDoc.name, code: branchDoc.code },
          initialSuperAdmin: {
            id: superAdminDoc.id,
            fullName: superAdminDoc.fullName,
            email: superAdminDoc.email,
            role: 'super_admin',
            branchId: superAdminDoc.branchId,
          },
        },
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate school code, branch code, or Super Admin email conflict.',
        });
      }
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to provision school.',
      });
    } finally {
      lockKeys.forEach(k => inFlightKeys.delete(k));
    }
  });

  router.patch('/schools/:schoolId/status', async (req, res) => {
    try {
      const db = database();
      let schoolId;
      try {
        schoolId = schoolObjectId(req.params.schoolId);
      } catch {
        throw badRequest('A valid school ID is required.');
      }

      const nextStatus = req.body?.status;
      if (!['active', 'suspended'].includes(nextStatus)) {
        throw badRequest('Status must be active or suspended.');
      }
      const reason = cleanText(req.body?.reason || `School status changed to ${nextStatus}`, 'Reason', 300);

      const school = await db.collection('schools').findOne({ _id: schoolId });
      if (!school) {
        return res.status(404).json({ success: false, error: 'School was not found.' });
      }

      const isActive = nextStatus === 'active';
      const now = new Date();
      await db.collection('schools').updateOne(
        { _id: schoolId },
        {
          $set: {
            status: nextStatus,
            active: isActive,
            isActive,
            statusReason: reason,
            updatedAt: now,
          },
        },
      );

      // When suspending a school, immediately revoke active sessions for its users
      let revokedSessions = 0;
      if (!isActive) {
        const schoolUsers = await db
          .collection('users')
          .find({ schoolId }, { projection: { _id: 1, id: 1 } })
          .toArray();
        const userIds = schoolUsers.flatMap(u => [u.id, u._id?.toHexString?.()].filter(Boolean));
        if (userIds.length > 0) {
          const revokeResult = await db.collection('refreshTokens').updateMany(
            { userId: { $in: userIds }, revokedAt: null },
            { $set: { revokedAt: now } },
          );
          revokedSessions = revokeResult.modifiedCount || 0;
        }
      }

      await recordPlatformAudit(db, req.user.id, `school.${nextStatus}`, schoolId.toHexString(), {
        reason,
        revokedSessions,
      });

      const updated = await db.collection('schools').findOne({ _id: schoolId });
      return res.json({
        success: true,
        data: {
          school: formatSchoolSummary(updated),
          revokedSessions,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to update school status.',
      });
    }
  });

  router.patch('/schools/:schoolId/subscription', async (req, res) => {
    try {
      const db = database();
      let schoolId;
      try {
        schoolId = schoolObjectId(req.params.schoolId);
      } catch {
        throw badRequest('A valid school ID is required.');
      }

      const school = await db.collection('schools').findOne({ _id: schoolId });
      if (!school) {
        return res.status(404).json({ success: false, error: 'School was not found.' });
      }

      const plan = req.body?.plan ? req.body.plan : school.plan || 'starter';
      if (!VALID_PLANS.has(plan)) {
        throw badRequest('Plan must be starter, growth, or enterprise.');
      }

      const subscriptionStatus = req.body?.subscriptionStatus || school.subscriptionStatus || 'trial';
      if (!VALID_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
        throw badRequest('Subscription status must be trial, active_recorded, past_due, or suspended.');
      }

      // Never allow manual UI edits to fake billingProviderVerified without a real provider settlement
      if (req.body?.billingProviderVerified === true || req.body?.billingSettlementRef !== undefined) {
        throw badRequest(
          'Real billing-provider payment verification cannot be set manually; recorded subscription status is tracked separately.',
          403,
        );
      }

      const currentLimits = school.usageLimits || DEFAULT_PLAN_LIMITS[plan];
      const nextLimits = {
        maxBranches: Math.max(1, Number(req.body?.usageLimits?.maxBranches) || currentLimits.maxBranches),
        maxStudents: Math.max(10, Number(req.body?.usageLimits?.maxStudents) || currentLimits.maxStudents),
        maxStaff: Math.max(5, Number(req.body?.usageLimits?.maxStaff) || currentLimits.maxStaff),
      };

      const now = new Date();
      await db.collection('schools').updateOne(
        { _id: schoolId },
        {
          $set: {
            plan,
            subscriptionStatus,
            usageLimits: nextLimits,
            updatedAt: now,
          },
        },
      );

      await recordPlatformAudit(db, req.user.id, 'school.subscription_updated', schoolId.toHexString(), {
        plan,
        subscriptionStatus,
        subscriptionVerification: 'recorded_only',
        usageLimits: nextLimits,
      });

      const updated = await db.collection('schools').findOne({ _id: schoolId });
      return res.json({
        success: true,
        data: formatSchoolSummary(updated),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to update subscription settings.',
      });
    }
  });

  router.get('/audit-logs', async (_req, res) => {
    try {
      const db = database();
      const logs = await db.collection('platformAuditLogs').find({}).sort({ createdAt: -1 }).limit(100).toArray();
      return res.json({ success: true, data: logs });
    } catch {
      return res.status(500).json({ success: false, error: 'Unable to load platform audit logs.' });
    }
  });

  return router;
}

module.exports = {
  createUltraAdminRouter,
  requireUltraAdmin,
  formatSchoolSummary,
};
