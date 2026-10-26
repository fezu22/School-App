import User from '../models/user';
import mongoose, {type ClientSession} from 'mongoose';
import Branch from '../models/branch';
import Session from '../models/session';
import {verifyAccessToken} from './jwt.service';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import type {Permission} from '../constants/permissions';
import {objectIdField, RequestContractError} from '../utils/request-validation';

export const PRINCIPAL_WRITE_ASSIGNEE_ROLES = ['principal', 'teacher'] as const;

// Same persisted-document write fences as Academic Setup/Enrollment. All
// provisional target/history writes roll back if authority changed. Fences run
// after the target CAS, so even changes during that write are detected. MongoDB
// conflicts/retries concurrent updates to these documents across processes.
export async function withPrincipalWriteAuthority<T>(
  scope: {actorId: string; branchId: string; token?: string}, permission: Permission | undefined,
  write: (session: ClientSession) => Promise<T>,
  validate?: (session: ClientSession) => Promise<void>,
  role: 'principal' | 'teacher' | 'student' = 'principal',
): Promise<T> {
  objectIdField(scope.actorId, 'actor ID');
  objectIdField(scope.branchId, 'branch ID');
  const loginIdentity = () => {
    try {
      const identity = verifyAccessToken(scope.token ?? '');
      if (identity.userId !== scope.actorId || identity.role !== role) throw new Error();
    } catch {throw new RequestContractError(401, 'Session is unavailable');}
  };
  loginIdentity();
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const result = await write(session);
      const branch = await Branch.collection.updateOne(
        {_id: new mongoose.Types.ObjectId(scope.branchId), isActive: true}, {$inc: {__v: 1}}, {session});
      if (!branch.matchedCount) throw new RequestContractError(403, 'Branch is unavailable for operational writes');
      const actor = await User.collection.updateOne(
        {_id: new mongoose.Types.ObjectId(scope.actorId), branchId: new mongoose.Types.ObjectId(scope.branchId), role, isActive: true},
        {$inc: {__v: 1}}, {session});
      if (!actor.matchedCount) throw new RequestContractError(403, 'Principal write actor is not authorized');
      // Match the same token record as authenticateToken/isTokenRevoked. A
      // second unrevoked row must not revive a revoked first token record.
      const currentLogin = await Session.findOne({token: scope.token}).session(session).lean();
      if (!currentLogin) throw new RequestContractError(401, 'Session is unavailable');
      const login = await Session.collection.updateOne(
        {_id: currentLogin._id, token: scope.token, userId: new mongoose.Types.ObjectId(scope.actorId), role, isRevoked: false},
        {$inc: {__v: 1}}, {session});
      if (!login.matchedCount) throw new RequestContractError(401, 'Session is unavailable');
      if (validate) await validate(session);
      loginIdentity();
      if (permission && !ROLE_PERMISSIONS[role].includes(permission)) throw new RequestContractError(403, 'Permission denied');
      return result;
    }, {readPreference: 'primary', readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}});
  } catch (error) {
    const failure = error as {code?: number; message?: string};
    if (failure.code === 20 || failure.message?.includes('This MongoDB deployment does not support retryable writes'))
      throw new RequestContractError(503, 'Principal writes require a MongoDB replica set or sharded cluster');
    throw error;
  } finally {await session.endSession();}
}

// Used for task assignees and approval delegates/delegators: merely reading a
// snapshot does not fence a concurrent staff transfer or account change.
export async function fencePrincipalWriteUser(id: string, branchId: string, roles: readonly string[], session: ClientSession) {
  const user = await User.collection.updateOne(
    {_id: new mongoose.Types.ObjectId(id), branchId: new mongoose.Types.ObjectId(branchId), role: {$in: [...roles]}, isActive: true},
    {$inc: {__v: 1}}, {session});
  if (!user.matchedCount) throw new RequestContractError(403, 'Staff authority is unavailable');
}

export const principalWriteActor = async (actorId: string, branchId: string) => {
  objectIdField(actorId, 'actor ID');
  objectIdField(branchId, 'branch ID');
  const actor = await User.findById(actorId).where('branchId').equals(branchId)
    .where('role').equals('principal').where('isActive').equals(true).select('_id');
  if (!actor) throw new RequestContractError(403, 'Principal write actor is not authorized');
  return actor;
};

export const principalWriteAssignee = async (assignedTo: unknown, branchId: string) => {
  const id = objectIdField(assignedTo, 'assigned user ID');
  const user = await User.findById(id).where('branchId').equals(branchId).select('_id role isActive');
  // Conceal missing and cross-branch assignees with the same response.
  if (!user) throw new RequestContractError(404, 'Assigned user not found');
  if (!user.isActive || !(PRINCIPAL_WRITE_ASSIGNEE_ROLES as readonly string[]).includes(user.role)) {
    throw new RequestContractError(403, 'Assigned user is not eligible');
  }
  return user;
};
