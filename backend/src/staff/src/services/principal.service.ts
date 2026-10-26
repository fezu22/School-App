import mongoose from 'mongoose';

import Branch from '../models/branch';
import User, {USER_ROLES, IUser} from '../models/user';
import {hashPassword} from '../utils/password';

export interface CreatePrincipalInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  branchId: string;
}

export const createPrincipal = async (
  data: CreatePrincipalInput,
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

  const existingUser = await User.findOne({email});

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const branch = await Branch.findById(branchId).select(
    '_id name code isActive',
  );

  if (!branch) {
    throw new Error('Assigned branch not found');
  }

  if (!branch.isActive) {
    throw new Error('Assigned branch is inactive');
  }

  const hashedPassword = await hashPassword(data.password);

  const principal = new User({
    fullName,
    email,
    phone: data.phone?.trim(),
    password: hashedPassword,
    role: USER_ROLES.PRINCIPAL,
    branchId: branch._id,
    isActive: true,
  });

  await principal.save();

  return principal;
};