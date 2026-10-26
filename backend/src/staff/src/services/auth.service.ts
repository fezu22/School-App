import User, { IUser, UserRole } from '../models/user';
import { comparePassword, hashPassword } from '../utils/password';
import Branch from '../models/branch';
import type { ClientSession } from 'mongoose';

interface CreateUserInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
  branchId?: string;
}

export const createUser = async (
  data: CreateUserInput,
  options: { bootstrap?: true; session?: ClientSession } = {},
): Promise<IUser> => {
  if (options.bootstrap && data.role !== 'super_admin') {
    throw new Error('Bootstrap requires the Super Admin role');
  }
  const existingUser = await User.findOne({
    email: data.email.toLowerCase(),
  }).session(options.session ?? null);
  if (data.role === 'super_admin' && data.branchId) {
    throw new Error('Super admin cannot be assigned to a branch');
  }

  if (data.role !== 'super_admin' && !data.branchId) {
    throw new Error('Branch is required for this user role');
  }
  if (existingUser) {
    throw new Error('User with this email already exists');
  }
  if (data.role !== 'super_admin') {
    const branch = await Branch.findById(data.branchId).session(
      options.session ?? null,
    );

    if (!branch) {
      throw new Error('Assigned branch not found');
    }

    if (!branch.isActive) {
      throw new Error('Assigned branch is inactive');
    }
  }

  const hashedPassword = await hashPassword(data.password);

  const user = new User({
    fullName: data.fullName,
    email: data.email.toLowerCase(),
    phone: data.phone,
    password: hashedPassword,
    role: data.role,
    branchId: data.branchId,
    ...(options.bootstrap ? { bootstrapKey: 'super-admin' } : {}),
  });

  await user.save(options.session ? { session: options.session } : {});

  return user;
};

export const authenticateUser = async (
  email: string,
  password: string,
): Promise<IUser> => {
  const user = await User.findOne({
    email: email.toLowerCase(),
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  const passwordMatches = await comparePassword(password, user.password);

  if (!passwordMatches) {
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    throw new Error('User account is inactive');
  }

  return user;
};
