import mongoose, { type ClientSession } from 'mongoose';
import Branch from '../models/branch';
import User from '../models/user';
import {
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';

type Actor = {
  _id: unknown;
  role: string;
  schoolId?: unknown;
  branchId?: unknown;
  isActive: boolean;
  active?: boolean;
};
const denied = () =>
  new RequestContractError(403, 'School authority is unavailable');
const missing = () =>
  new RequestContractError(404, 'The selected academic scope is unavailable');

// The existing standalone JWT deployment keeps its legacy contract. Integrated
// requests ALWAYS require school authority; a missing field is never global.
// Explicitly mapped standalone accounts use the same school boundary too.
export async function resolveAcademicSchool<T extends Actor>(
  actor: T,
  session?: ClientSession,
) {
  if (process.env.INTEGRATED_STAFF_ENABLED !== 'true' && actor.schoolId == null)
    return actor;
  const { resolveSchoolAuthority } = require('../../../schoolAccess');
  let authority;
  try {
    authority = await resolveSchoolAuthority(mongoose.connection.db, actor, {
      session,
      allowBranchSchool: true,
    });
  } catch {
    throw denied();
  }
  const schoolId = new mongoose.Types.ObjectId(String(authority.schoolId));
  if (session) {
    // Fence the SAME persisted ownership records used by resolution. Concurrent
    // suspension/reassignment conflicts with this transaction, not a UI cache.
    const user = await User.collection.updateOne(
      {
        _id: actor._id as mongoose.Types.ObjectId,
        role: actor.role,
        isActive: true,
        active: { $ne: false },
        schoolId: (actor.schoolId ?? null) as mongoose.Types.ObjectId | null,
        branchId: (actor.branchId ?? null) as mongoose.Types.ObjectId | null,
      },
      { $inc: { __v: 1 } },
      { session },
    );
    const school = await mongoose.connection.collection('schools').updateOne(
      {
        _id: schoolId,
        active: { $ne: false },
        isActive: { $ne: false },
        status: { $nin: ['suspended', 'deleted', 'archived'] },
      },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!user.matchedCount || !school.matchedCount) throw denied();
    if (actor.branchId) {
      const branch = await Branch.collection.updateOne(
        {
          _id: new mongoose.Types.ObjectId(String(actor.branchId)),
          schoolId,
          active: { $ne: false },
          isActive: { $ne: false },
        },
        { $inc: { __v: 1 } },
        { session },
      );
      if (!branch.matchedCount) throw denied();
    }
  }
  return { ...actor, schoolId };
}

export function schoolBranchFilter(actor: Actor) {
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true' && !actor.schoolId)
    throw denied();
  return {
    ...(actor.schoolId
      ? { schoolId: new mongoose.Types.ObjectId(String(actor.schoolId)) }
      : {}),
    ...(actor.branchId ? { _id: actor.branchId } : {}),
  };
}

export function schoolUserFilter(actor: Actor) {
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true' && !actor.schoolId)
    throw denied();
  // Missing schoolId is compatible only THROUGH an already authorized Branch.
  return actor.schoolId
    ? { $or: [{ schoolId: actor.schoolId }, { schoolId: null }] }
    : {};
}

export async function requireAcademicBranch(
  actor: Actor,
  requested: unknown,
  session?: ClientSession,
  active = true,
) {
  const branchId = objectIdField(requested, 'branch ID');
  if (actor.branchId && String(actor.branchId) !== branchId) throw missing();
  const branch = await Branch.findOne({
    ...schoolBranchFilter(actor),
    _id: branchId,
    ...(active ? { isActive: true, active: { $ne: false } } : {}),
  })
    .session(session ?? null)
    .read('primary')
    .lean();
  if (!branch) throw missing();
  if (session && actor.schoolId) {
    const fence = await Branch.collection.updateOne(
      {
        _id: branch._id,
        schoolId: new mongoose.Types.ObjectId(String(actor.schoolId)),
        ...(active ? { isActive: true, active: { $ne: false } } : {}),
      },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!fence.matchedCount) throw missing();
  }
  return branch;
}
