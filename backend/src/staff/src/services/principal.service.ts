import mongoose from 'mongoose';

import User, {USER_ROLES, IUser} from '../models/user';
import {hashPassword} from '../utils/password';
import type {JwtPayload} from './jwt.service';
import {currentAcademicActor} from './teacher-scope.service';
import {requireAcademicBranch} from './school-authority.service';
import {withAcademicCatalogLock} from './academic-catalog-lock.service';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {PERMISSIONS} from '../constants/permissions';
import {RequestContractError} from '../utils/request-validation';

export interface CreatePrincipalInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  branchId: string;
}

export const createPrincipal = async (
  data: CreatePrincipalInput,
  identity: JwtPayload | undefined,
): Promise<IUser> => {
  const fullName = data.fullName.trim();
  const email = data.email.trim().toLowerCase();
  const branchId = data.branchId.trim();

  if (!fullName || !email || !data.password || !branchId) {
    throw new Error(
      'Full name, email, password and branch are required',
    );
  }

  if (!mongoose.isValidObjectId(branchId)) {
    throw new Error('Invalid branch ID');
  }

  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'super_admin' || !ROLE_PERMISSIONS.super_admin.includes(PERMISSIONS.PRINCIPALS_MANAGE))
    throw new RequestContractError(403, 'Principal administration is not permitted');
  const branch = await requireAcademicBranch(actor, branchId);
  const existingUser = await User.findOne({email});

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const hashedPassword = await hashPassword(data.password);

  const persist = async (session?: mongoose.ClientSession) => {
    const current = await currentAcademicActor(identity, session);
    if (current.role !== 'super_admin' || !ROLE_PERMISSIONS.super_admin.includes(PERMISSIONS.PRINCIPALS_MANAGE))
      throw new RequestContractError(403, 'Principal administration is not permitted');
    await requireAcademicBranch(current, branchId, session);
    const principal = new User({
      fullName,
      email,
      phone: data.phone?.trim(),
      password: hashedPassword,
      role: USER_ROLES.PRINCIPAL,
      branchId: branch._id,
      isActive: true,
      ...(current.schoolId ? {schoolId: current.schoolId} : {}),
    });
    await principal.save(session ? {session} : {});
    return principal;
  };
  // Integrated/mapped authority always takes the ownership transaction. Preserve
  // the pre-existing unmapped standalone provisioning contract (including its
  // standalone MongoDB support); it is not an integrated school-scope fallback.
  return actor.schoolId ? withAcademicCatalogLock(branchId, persist) : persist();
};
