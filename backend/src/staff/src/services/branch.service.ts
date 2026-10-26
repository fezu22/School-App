import Branch, { IBranch } from '../models/branch';
import { Types } from 'mongoose';

interface CreateBranchInput {
  schoolId?: string;
  name: string;
  code: string;
  address: string;
  city: string;
  phone?: string;
  email?: string;
}

export const createBranch = async (
  data: CreateBranchInput,
): Promise<IBranch> => {
  const existingBranch = await Branch.findOne({
    code: data.code.toUpperCase(),
    ...(data.schoolId ? {schoolId: new Types.ObjectId(data.schoolId)} : {}),
  });

  if (existingBranch) {
    throw new Error('Branch with this code already exists');
  }

  const branch = new Branch({
    ...(data.schoolId ? {schoolId: data.schoolId} : {}),
    name: data.name,
    code: data.code.toUpperCase(),
    address: data.address,
    city: data.city,
    phone: data.phone,
    email: data.email?.toLowerCase(),
  });

  await branch.save();

  return branch;
};

export const getAllBranches = async (): Promise<IBranch[]> => {
  return Branch.find().sort({ createdAt: -1 });
};

export const getBranchById = async (
  branchId: string,
): Promise<IBranch | null> => {
  if (!Types.ObjectId.isValid(branchId)) {
    throw new Error('Invalid branch ID');
  }

  return Branch.findById(branchId);
};
