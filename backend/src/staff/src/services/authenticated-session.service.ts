import mongoose, { type ClientSession } from 'mongoose';
import Session from '../models/session';
import User from '../models/user';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { resolveAcademicSchool } from './school-authority.service';
import { RequestContractError } from '../utils/request-validation';

export type AuthContext = Readonly<
  JwtPayload & {
    authMode: 'integrated_opaque' | 'standalone_jwt';
    sessionId: string;
  }
>;
// Strings are a compatibility interface for trusted standalone service callers.
// Integrated routes MUST pass middleware-created contexts, never bearer strings.
export type SessionAuthority = AuthContext | string;
type Binding = {
  context: AuthContext;
  token?: string;
  hash?: string;
  owner: string;
  deadline?: number;
  permissions: readonly string[];
  schoolId: string;
  branchId: string;
};
const bindings = new WeakMap<object, Binding>();
const transactions = new WeakMap<ClientSession, Set<Binding>>();
const unavailable = () =>
  new RequestContractError(401, 'Session is unavailable');
const integrated = () => process.env.INTEGRATED_STAFF_ENABLED === 'true';

async function bind(
  identity: JwtPayload,
  row: any,
  mode: AuthContext['authMode'],
  secret: { token?: string; hash?: string },
) {
  const actor = await User.findById(identity.userId)
    .read('primary')
    .select('_id role schoolId branchId isActive active')
    .lean();
  if (
    !actor ||
    !actor.isActive ||
    actor.active === false ||
    actor.role !== identity.role
  )
    throw unavailable();
  const scope = await resolveAcademicSchool(actor);
  const context: AuthContext = Object.freeze({
    userId: identity.userId,
    role: identity.role,
    authMode: mode,
    sessionId: String(row._id),
  });
  bindings.set(context, {
    context,
    ...secret,
    owner: String(row.userId),
    deadline:
      mode === 'integrated_opaque'
        ? new Date(row.expiresAt).getTime()
        : undefined,
    permissions: [...(ROLE_PERMISSIONS[identity.role] ?? [])],
    schoolId: String(scope.schoolId ?? ''),
    branchId: String(scope.branchId ?? ''),
  });
  return context;
}

// Only authenticated middleware creates contexts; authenticity is object identity,
// not client-supplied fields or a mode guessed from token syntax.
export async function opaqueAuthContext(
  identity: JwtPayload,
  row: any,
): Promise<AuthContext> {
  if (!integrated() || !row?._id || !row.tokenHash || row.type !== 'access')
    throw unavailable();
  return bind(identity, row, 'integrated_opaque', { hash: row.tokenHash });
}
export async function jwtAuthContext(
  identity: JwtPayload,
  token: string,
): Promise<AuthContext> {
  if (integrated()) throw unavailable();
  const row = await Session.findOne({ token }).read('primary').lean();
  if (
    !row ||
    row.isRevoked ||
    String(row.userId) !== identity.userId ||
    row.role !== identity.role
  )
    throw unavailable();
  return bind(identity, row, 'standalone_jwt', { token });
}
export function isAuthContext(value: unknown): value is AuthContext {
  return typeof value === 'object' && value !== null && bindings.has(value);
}
export function sessionIdentity(
  authority: SessionAuthority | undefined,
): JwtPayload {
  if (typeof authority === 'string') {
    if (integrated()) throw unavailable();
    try {
      return verifyAccessToken(authority);
    } catch {
      throw unavailable();
    }
  }
  if (
    !isAuthContext(authority) ||
    (authority.authMode === 'integrated_opaque') !== integrated()
  )
    throw unavailable();
  const binding = bindings.get(authority)!;
  if (
    binding.deadline !== undefined &&
    (!Number.isFinite(binding.deadline) || binding.deadline <= Date.now())
  )
    throw unavailable();
  if (binding.token) {
    try {
      const identity = verifyAccessToken(binding.token);
      if (
        identity.userId !== authority.userId ||
        identity.role !== authority.role
      )
        throw unavailable();
    } catch {
      throw unavailable();
    }
  }
  return authority;
}

export async function revalidateAuthenticatedSession(
  authority: SessionAuthority | undefined,
  expected: { userId: string; role: string },
  session?: ClientSession,
) {
  const identity = sessionIdentity(authority);
  if (
    identity.userId !== String(expected.userId) ||
    identity.role !== expected.role
  )
    throw unavailable();
  let context: AuthContext;
  if (typeof authority === 'string') {
    // Retain the FIRST token row, matching standalone middleware; a duplicate
    // unrevoked record cannot revive a revoked first record.
    const prior =
      session &&
      [...(transactions.get(session) ?? [])].find(b => b.token === authority);
    context = prior?.context ?? (await jwtAuthContext(identity, authority));
  } else context = authority!;
  const binding = bindings.get(context)!;
  const options = session ? { session } : {};
  const now = new Date();
  const collection =
    context.authMode === 'integrated_opaque'
      ? mongoose.connection.collection('refreshTokens')
      : Session.collection;
  const query =
    context.authMode === 'integrated_opaque'
      ? {
          _id: new mongoose.Types.ObjectId(context.sessionId),
          tokenHash: binding.hash,
          type: 'access',
          userId: binding.owner,
          revokedAt: null,
          expiresAt: { $gt: now },
        }
      : {
          _id: new mongoose.Types.ObjectId(context.sessionId),
          token: binding.token,
          userId: new mongoose.Types.ObjectId(identity.userId),
          role: identity.role,
          isRevoked: false,
        };
  const row = await collection.findOne(query as any, options);
  if (!row) throw unavailable();
  if (session) {
    const fence = await collection.updateOne(
      query as any,
      { $inc: { __v: 1 } },
      options,
    );
    if (!fence.matchedCount) throw unavailable();
  }
  const actor = await User.findById(identity.userId)
    .session(session ?? null)
    .read('primary')
    .select('_id role schoolId branchId isActive active id')
    .lean();
  if (
    !actor ||
    !actor.isActive ||
    actor.active === false ||
    actor.role !== identity.role
  )
    throw unavailable();
  if (context.authMode === 'integrated_opaque') {
    const raw = await User.collection.findOne({ _id: actor._id }, options);
    if (!raw || String((raw as any).id || raw._id) !== binding.owner)
      throw unavailable();
  }
  const currentScope = await resolveAcademicSchool(actor, session);
  if (
    String(currentScope.schoolId ?? '') !== binding.schoolId ||
    String(currentScope.branchId ?? '') !== binding.branchId
  )
    throw new RequestContractError(
      403,
      'School or Branch authority has changed',
    );
  if (context.authMode === 'integrated_opaque') {
    // Reuse native identity ambiguity, expiry, revocation and school checks,
    // against the SAME row and the SAME MongoDB transaction snapshot.
    const { getSessionIdentity } = require('../../../auth');
    const native = await getSessionIdentity(
      mongoose.connection.db,
      binding.hash,
      {
        sessionId: context.sessionId,
        userId: binding.owner,
        role: identity.role,
      },
      options,
    );
    if (!native || String(native.record._id) !== identity.userId)
      throw unavailable();
  }
  if (
    binding.permissions.some(
      p => !(ROLE_PERMISSIONS[identity.role] as readonly string[]).includes(p),
    )
  )
    throw new RequestContractError(403, 'Permission denied');
  if (session) {
    const set = transactions.get(session) ?? new Set<Binding>();
    set.add(binding);
    transactions.set(session, set);
  }
  sessionIdentity(context);
  return identity;
}

// Explicit shared transaction boundary. Participating fences register the exact
// authenticated session; recheck it AFTER all provisional domain/history writes
// and immediately before the driver's commit, including wall-clock expiry.
export async function authenticatedTransaction<T>(
  session: ClientSession,
  write: (...args: any[]) => Promise<T>,
  options?: any,
): Promise<T> {
  try {
    return (await session.withTransaction(async (...args: any[]) => {
      // Keep the original accepted row across driver retries too. A deleted
      // legacy Session must not be replaced by another row for the same JWT.
      const result = await write(...args);
      for (const binding of [...(transactions.get(session) ?? [])]) {
        await revalidateAuthenticatedSession(
          binding.context,
          binding.context,
          session,
        );
      }
      for (const binding of transactions.get(session) ?? [])
        sessionIdentity(binding.context);
      return result;
    }, options)) as T;
  } finally {
    transactions.delete(session);
  }
}

async function boundSession(authority: SessionAuthority, expected: JwtPayload) {
  await revalidateAuthenticatedSession(authority, expected);
  const context =
    typeof authority === 'string'
      ? await jwtAuthContext(expected, authority)
      : authority;
  return bindings.get(context)!;
}
function sessionDTO(row: any, binding: Binding) {
  return {
    sessionId: String(row._id),
    label: 'School app session',
    createdAt: row.createdAt.toISOString(),
    current: String(row._id) === binding.context.sessionId,
    revoked:
      binding.context.authMode === 'integrated_opaque'
        ? row.revokedAt != null
        : row.isRevoked,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
export async function listAuthenticatedSessions(
  authority: SessionAuthority,
  expected: JwtPayload,
) {
  const binding = await boundSession(authority, expected);
  const rows =
    binding.context.authMode === 'integrated_opaque'
      ? await mongoose.connection
          .collection('refreshTokens')
          .find({ userId: binding.owner, type: 'access' })
          .sort({ createdAt: -1 })
          .toArray()
      : await Session.find({ userId: expected.userId, role: expected.role })
          .sort({ createdAt: -1 })
          .lean();
  return {
    items: rows.map(row => sessionDTO(row, binding)),
    total: rows.length,
    currentSessionPolicy: 'sign_out_only' as const,
  };
}
export async function revokeOtherAuthenticatedSession(
  authority: SessionAuthority,
  expected: JwtPayload,
  id: string,
) {
  const binding = await boundSession(authority, expected);
  if (id === binding.context.sessionId)
    throw new RequestContractError(
      409,
      'Use Log out to revoke the current session',
    );
  const session = await mongoose.startSession();
  try {
    return await authenticatedTransaction(session, async () => {
      await revalidateAuthenticatedSession(binding.context, expected, session);
      const native = binding.context.authMode === 'integrated_opaque';
      const collection = native
        ? mongoose.connection.collection('refreshTokens')
        : Session.collection;
      const query = native
        ? {
            _id: new mongoose.Types.ObjectId(id),
            userId: binding.owner,
            type: 'access',
          }
        : {
            _id: new mongoose.Types.ObjectId(id),
            userId: new mongoose.Types.ObjectId(expected.userId),
            role: expected.role,
          };
      const row = await collection.findOne(query as any, { session });
      if (!row) throw new RequestContractError(404, 'Session is unavailable');
      if (native ? row.revokedAt == null : !row.isRevoked) {
        const revokedAt = new Date();
        await collection.updateOne(
          query as any,
          {
            $set: {
              revokedAt,
              ...(!native
                ? {
                    isRevoked: true,
                    revokedBy: new mongoose.Types.ObjectId(expected.userId),
                  }
                : {}),
            },
          },
          { session },
        );
        Object.assign(row, { revokedAt, isRevoked: true });
      }
      return sessionDTO(row, binding);
    });
  } finally {
    await session.endSession();
  }
}
