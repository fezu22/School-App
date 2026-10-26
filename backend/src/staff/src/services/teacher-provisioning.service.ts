import mongoose from 'mongoose';
import User from '../models/user';
import Branch from '../models/branch';
import Session from '../models/session';
import { createUser } from './auth.service';
import { verifyAccessToken } from './jwt.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
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

// This deployment has one school and global Super Admin branch administration.
// No caller-provided tenant/school/role/assignment fields are accepted.
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
  token: string,
  input: unknown,
) => {
  const body = teacherAccountBody(input);
  permitted();
  const decoded = verifyAccessToken(token);
  if (decoded.userId !== actorId || decoded.role !== 'super_admin')
    throw new RequestContractError(403, 'Super Admin authority is required');
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(
      async () => {
        permitted();
        const login = await Session.collection.updateOne(
          {
            token,
            userId: new mongoose.Types.ObjectId(actorId),
            role: 'super_admin',
            isRevoked: false,
          },
          { $inc: { __v: 1 } },
          { session },
        );
        if (!login.matchedCount)
          throw new RequestContractError(401, 'Session is unavailable');
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
          { ...body, role: 'teacher' },
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
