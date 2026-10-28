const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { Buffer } = require('node:buffer');
const { getDatabase } = require('./database');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PASSWORD_KEYLEN = 64;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.scryptSync(password, salt, PASSWORD_KEYLEN).toString('hex');
  return { passwordHash, passwordSalt: salt };
}

function passwordMatches(password, user) {
  if (typeof password !== 'string' ||
      !/^[a-f0-9]{128}$/i.test(user?.passwordHash || '') ||
      !/^[a-f0-9]{32}$/i.test(user?.passwordSalt || '')) return false;
  const actual = crypto.scryptSync(password, user.passwordSalt, PASSWORD_KEYLEN);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicIdentity(user) {
  if (typeof user?.id === 'string' && user.id.trim()) return user.id;
  return user?._id instanceof ObjectId ? user._id.toHexString() : null;
}

function safeUser(user) {
  return { id: publicIdentity(user), role: String(user.role).toLowerCase(),
    ...(user.schoolId ? { schoolId: String(user.schoolId) } : {}),
    branchId: user.branchId ? String(user.branchId) : undefined,
    fullName: user.fullName || user.name || '', email: user.email };
}

async function findIdentity(reference, db = getDatabase()) {
  const value = reference instanceof ObjectId ? reference.toHexString() : reference;
  if (typeof value !== 'string' || !value.trim()) return null;
  const alternatives = [{ id: value }];
  if (ObjectId.isValid(value)) alternatives.push({ _id: new ObjectId(value) });
  const matches = await db.collection('users').find({ $or: alternatives }).limit(2).toArray();
  return matches.length === 1 ? matches[0] : null;
}

async function schoolAvailability(user, database) {
  const role = typeof user?.role === 'string' ? user.role.trim().toLowerCase() : '';
  const { isLegacySingleSchoolMode } = require('./schoolAccess');
  const { schoolObjectId } = require('./schoolDatabase');
  const db = database || getDatabase();
  if (user.schoolId == null || user.schoolId === '') {
    if (role === 'ultra_admin') return null;
    if (!isLegacySingleSchoolMode()) {
      return { status: 503, error: 'Account school mapping is unavailable.' };
    }
    if (user.branchId) {
      let branchId;
      try { branchId = schoolObjectId(user.branchId); }
      catch { return { status: 503, error: 'Account branch mapping is unavailable.' }; }
      const branch = await db.collection('branches').findOne({ _id: branchId });
      if (!branch) return { status: 503, error: 'Account branch mapping is unavailable.' };
      if (branch.schoolId != null && branch.schoolId !== '') {
        return { status: 403, error: 'Account and branch school scope do not match.' };
      }
      if (branch.active === false || branch.isActive === false) {
        return { status: 403, error: 'Branch access is disabled.' };
      }
    }
    return null;
  }
  if (role === 'ultra_admin') {
    return { status: 403, error: 'Platform authority cannot be scoped to a school account.' };
  }
  if (isLegacySingleSchoolMode()) {
    return { status: 503, error: 'SaaS school-scoped accounts cannot authenticate in legacy single-school mode.' };
  }
  let schoolId;
  try {schoolId = schoolObjectId(user.schoolId);}
  catch {return {status: 503, error: 'Account school mapping is unavailable.'};}
  const school = await db.collection('schools').findOne({_id: schoolId});
  if (!school) return {status: 503, error: 'Account school mapping is unavailable.'};
  if (school.active === false || school.isActive === false || ['suspended', 'deleted', 'archived'].includes(school.status)) return {status: 403, error: 'School access is suspended.'};
  if (user.branchId) {
    let branchId;
    try {branchId = schoolObjectId(user.branchId);}
    catch {return {status: 503, error: 'Account branch mapping is unavailable.'};}
    const branch = await db.collection('branches').findOne({_id: branchId});
    if (!branch) return {status: 503, error: 'Account branch mapping is unavailable.'};
    let owner;
    try {owner = schoolObjectId(branch.schoolId);}
    catch {return {status: 503, error: 'Branch school mapping is unavailable.'};}
    if (!owner.equals(schoolId)) return {status: 403, error: 'Account and branch school scope do not match.'};
    if (branch.active === false || branch.isActive === false) return {status: 403, error: 'Branch access is disabled.'};
  }
  return null;
}

// Shared opaque-session validation for realtime handshakes and subsequent
// delivery. Only hashes are retained by sockets; no bearer is stored or sent.
async function getSessionIdentity(db, accessTokenHash, expected = {}) {
  if (typeof accessTokenHash !== 'string' || !/^[a-f0-9]{64}$/i.test(accessTokenHash)) return null;
  const session = await db.collection('refreshTokens').findOne({tokenHash: accessTokenHash, type: 'access', revokedAt: null, expiresAt: {$gt: new Date()}});
  if (!session || (expected.userId !== undefined && String(session.userId) !== String(expected.userId))) return null;
  const record = await findIdentity(session.userId, db);
  if (!record || record.active === false || record.isActive === false || !publicIdentity(record) || !record.role) return null;
  const user = safeUser(record);
  if (expected.role !== undefined && user.role !== expected.role) return null;
  if (await schoolAvailability(record, db)) return null;
  return {user, record, session};
}

async function authenticateRequest(req, res, next) {
  const header = typeof req.get('Authorization') === 'string' ? req.get('Authorization') : '';
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/.exec(header);
  if (!match) return res.status(401).json({ success: false, error: 'Authentication is required.' });
  try {
    const session = await getDatabase().collection('refreshTokens').findOne({
      tokenHash: tokenHash(match[1]),
      type: 'access',
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return res.status(401).json({ success: false, error: 'Session is invalid or expired.' });
    const user = await findIdentity(session.userId);
    if (!user || user.active === false || user.isActive === false || !publicIdentity(user) || !user.role) return res.status(401).json({ success: false, error: 'Authenticated user was not found.' });
    const unavailable = await schoolAvailability(user);
    if (unavailable) return res.status(unavailable.status).json({success: false, error: unavailable.error});
    req.user = safeUser(user);
    req.authenticatedUserRecord = user;
    await getDatabase().collection('refreshTokens').updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } });
    return next();
  } catch (error) { return next(error); }
}

async function login(email, password) {
  const emailLower = normalizeEmail(email);
  if (!emailLower || emailLower.length > 320 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 1024) return null;
  const matches = await getDatabase().collection('users').find({ $or: [{ emailLower }, { email: emailLower }] }).limit(2).toArray();
  const user = matches.length === 1 ? matches[0] : null;
  if (!user || user.active === false || user.isActive === false || !publicIdentity(user) ||
      typeof user.role !== 'string' || !user.role.trim()) return null;
  let valid = false;
  if (user.passwordHash || user.passwordSalt) valid = passwordMatches(password, user);
  else if (typeof user.password === 'string' && /^\$2[ab]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password)) {
    const cost = Number(user.password.slice(4, 6));
    if (cost >= 10 && cost <= 14) valid = await bcrypt.compare(password, user.password);
  }
  if (!valid) return null;
  if (await schoolAvailability(user)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await getDatabase().collection('refreshTokens').insertOne({ tokenHash: tokenHash(token), type: 'access', userId: publicIdentity(user), createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS), revokedAt: null });
  return { token, expiresAt: expiresAt.toISOString(), user: safeUser(user) };
}

async function logout(token) {
  if (!token) return;
  await getDatabase().collection('refreshTokens').updateOne({ tokenHash: tokenHash(token), type: 'access', revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = { authenticateRequest, hashPassword, login, logout, normalizeEmail, getSessionIdentity };
