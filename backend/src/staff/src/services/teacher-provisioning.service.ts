import {type SessionAuthority, sessionIdentity, revalidateAuthenticatedSession, authenticatedTransaction} from './authenticated-session.service';
import mongoose from 'mongoose';
import User from '../models/user';
import Branch from '../models/branch';

import { createUser } from './auth.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import {currentAcademicActor} from './teacher-scope.service';
import {requireAcademicBranch} from './school-authority.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';

// Establish the existing User login-identity invariant even with autoIndex off.
export const ensureTeacherAccountIndex = () =>
  User.collection.createIndex({ email: 1 }, { unique: true });

const permitted = () => {
  if (!ROLE_PERMISSIONS.super_admin.includes(PERMISSIONS.TEACHERS_CREATE))
    throw new RequestContractError(
      403,
      'Teacher account creation is not permitted',
    );
};

// School ownership is resolved from the persisted actor, never this body.
export const teacherAccountBody = (input: unknown) => {
  const body = objectBody(input, ['fullName', 'email', 'password', 'branchId']);
  const fullName = textField(body.fullName, 'full name', 100, 2);
  const email = textField(body.email, 'email', 254, 3).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new RequestContractError(400, 'Invalid email');
  if (
    typeof body.password !== 'string' ||
    body.password.length < 12 ||
    Buffer.byteLength(body.password, 'utf8') > 72
  )
    throw new RequestContractError(
      400,
      'Password must have at least 12 characters and at most 72 UTF-8 bytes',
    );
  return {
    fullName,
    email,
    password: body.password,
    branchId: objectIdField(body.branchId, 'branch ID'),
  };
};

export const provisionTeacher = async (
  actorId: string,
  token: SessionAuthority,
  input: unknown,
) => {
  const body = teacherAccountBody(input);
  permitted();
  const identity = {userId: actorId, role: 'super_admin' as const};
  const authority = await currentAcademicActor(identity);
  if (authority.branchId) throw new RequestContractError(403, 'Super Admin authority is required');
  await requireAcademicBranch(authority, body.branchId);
  const decoded = sessionIdentity(token);
  if (decoded.userId !== actorId || decoded.role !== 'super_admin')
    throw new RequestContractError(403, 'Super Admin authority is required');
  const session = await mongoose.startSession();
  try {
    return await authenticatedTransaction(session,
      async () => {
        permitted();
        const current = await currentAcademicActor(identity, session);
        await requireAcademicBranch(current, body.branchId, session);
        await revalidateAuthenticatedSession(token, {userId: String(new mongoose.Types.ObjectId(actorId)), role: 'super_admin'}, session);
        const actor = await User.collection.updateOne(
          {
            _id: new mongoose.Types.ObjectId(actorId),
            role: 'super_admin',
            isActive: true,
            branchId: null,
          },
          { $inc: { __v: 1 } },
          { session },
        );
        if (!actor.matchedCount)
          throw new RequestContractError(
            403,
            'Super Admin authority is unavailable',
          );
        const branch = await Branch.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(body.branchId), isActive: true },
          { $inc: { __v: 1 } },
          { session },
        );
        if (!branch.matchedCount)
          throw new RequestContractError(404, 'Active branch is unavailable');
        const user = await createUser(
          { ...body, role: 'teacher', ...(current.schoolId ? {schoolId: String(current.schoolId)} : {}) },
          { session },
        );
        permitted();
        return {
          id: String(user._id),
          fullName: user.fullName,
          email: user.email,
          role: 'teacher' as const,
          branchId: String(user.branchId),
          isActive: user.isActive,
          createdAt: user.createdAt,
        };
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
  } catch (error) {
    if (
      (error as { code?: number }).code === 11000 ||
      (error instanceof Error &&
        error.message === 'User with this email already exists')
    )
      throw new RequestContractError(
        409,
        'A user with this email already exists',
      );
    throw error;
  } finally {
    await session.endSession();
  }
};
