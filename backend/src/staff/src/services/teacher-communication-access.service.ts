import {type SessionAuthority, sessionIdentity, revalidateAuthenticatedSession, authenticatedTransaction} from './authenticated-session.service';
import mongoose, { type ClientSession } from 'mongoose';
import User from '../models/user';
import Branch from '../models/branch';

import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment from '../models/teacherAssignment';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import type { Permission } from '../constants/permissions';
import { RequestContractError } from '../utils/request-validation';
import {
  getTeacherScope,
  type TeacherAssignmentTuple,
} from './teacher-scope.service';
import { type JwtPayload } from './jwt.service';

export type Identity = JwtPayload | undefined;
export const communicationPermission = (permission: Permission) => {
  if (!ROLE_PERMISSIONS.teacher.includes(permission))
    throw new RequestContractError(403, 'Teacher action is not permitted');
};
export const communicationScope = async (
  identity: Identity,
  permission: Permission,
) => {
  communicationPermission(permission);
  return getTeacherScope(identity);
};
export const communicationMissing = () =>
  new RequestContractError(
    404,
    'Item is unavailable or outside your current scope',
  );
export const exactTuple = (
  scope: Awaited<ReturnType<typeof getTeacherScope>>,
  context: { classId: unknown; sectionId: unknown; subjectId: unknown },
) => {
  const tuple = scope.tuples.find(
    t =>
      t.classId === String(context.classId) &&
      t.sectionId === String(context.sectionId) &&
      t.subjectId === String(context.subjectId),
  );
  if (!tuple) throw communicationMissing();
  return tuple;
};
export const communicationFence = async (
  session: ClientSession,
  collection: string,
  id: string,
) => {
  const result = await mongoose.connection
    .collection(collection)
    .updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $inc: { __v: 1 } },
      { session },
    );
  if (!result.matchedCount) throw communicationMissing();
};
// Match the existing academic mutation fences: committed primary reads after
// locking detect pre-lock changes; later writes to locked records serialize.
export const withTeacherCommunication = async <T>(
  identity: Identity,
  token: SessionAuthority,
  permission: Permission,
  context: TeacherAssignmentTuple | undefined,
  write: (
    session: ClientSession,
    scope: Awaited<ReturnType<typeof getTeacherScope>>,
  ) => Promise<T>,
  sourcePermission?: Permission,
) => {
  const initial = await communicationScope(identity, permission);
  if (sourcePermission) communicationPermission(sourcePermission);
  const session = await mongoose.startSession();
  try {
    return (await authenticatedTransaction(session,
      async () => {
        const decoded = sessionIdentity(token);
        if (decoded.userId !== identity?.userId || decoded.role !== 'teacher')
          throw new RequestContractError(401, 'Authentication changed');
        await revalidateAuthenticatedSession(token, {userId: String(new mongoose.Types.ObjectId(decoded.userId)), role: 'teacher'}, session);
        await communicationFence(
          session,
          User.collection.name,
          initial.actorId,
        );
        await communicationFence(
          session,
          Branch.collection.name,
          initial.branchId,
        );
        if (context) {
          for (const [collection, id] of [
            [TeacherAssignment.collection.name, context.assignmentId],
            [SchoolClass.collection.name, context.classId],
            [Section.collection.name, context.sectionId],
            [Subject.collection.name, context.subjectId],
          ])
            await communicationFence(session, collection, id);
        }
        const current = await communicationScope(identity, permission);
        if (sourcePermission) communicationPermission(sourcePermission);
        if (
          current.branchId !== initial.branchId ||
          (context &&
            exactTuple(current, context).assignmentId !== context.assignmentId)
        )
          throw communicationMissing();
        const result = await write(session, current);
        communicationPermission(permission);
        if (sourcePermission) communicationPermission(sourcePermission);
        // Time-bounded assignments can expire without a database write.
        const final = await getTeacherScope(identity);
        communicationPermission(permission);
        if (sourcePermission) communicationPermission(sourcePermission);
        if (
          final.branchId !== initial.branchId ||
          (context &&
            exactTuple(final, context).assignmentId !== context.assignmentId)
        )
          throw communicationMissing();
        return result;
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    ))!;
  } finally {
    await session.endSession();
  }
};
