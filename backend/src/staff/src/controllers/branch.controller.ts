import {Request, Response} from 'express';
import {Types} from 'mongoose';
import {createBranch, getAllBranches, getBranchById} from '../services/branch.service';
import {BranchScopedRequest} from '../middleware/branch.middleware';
import {integratedSchoolContext} from '../utils/school-context';

const projection = {_id: 1, name: 1, code: 1, address: 1, city: 1, phone: 1, email: 1, isActive: 1, createdAt: 1, updatedAt: 1};
const integrated = () => process.env.INTEGRATED_STAFF_ENABLED === 'true';
function failure(error: unknown, res: Response, fallback = 500) {
  const value = error as {code?: string; statusCode?: number; message?: string};
  const scoped = typeof value?.code === 'string' && value.code.startsWith('INTEGRATION_');
  res.status(scoped ? value.statusCode || 503 : fallback).json({success: false, message: scoped ? value.message : 'Branch operation failed. Check the supplied details and retry.'});
}

export const createBranchController = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({success: false, message: 'Provide valid branch details'}); return;
    }
    const {name, code, address, city, phone, email} = body;
    if ([name, code, address, city].some(value => typeof value !== 'string' || !value.trim()) ||
      (phone !== undefined && typeof phone !== 'string') || (email !== undefined && typeof email !== 'string')) {
      res.status(400).json({success: false, message: 'Provide valid name, code, address, city and contact details'}); return;
    }
    const context = integrated() ? await integratedSchoolContext(req) : undefined;
    // School ownership comes exclusively from the authenticated database user.
    const branch = await createBranch({name, code, address, city, phone, email, ...(context ? {schoolId: context.schoolId} : {})});
    res.status(201).json({success: true, message: 'Branch created successfully', branch});
  } catch (error) {failure(error, res, 400);}
};

export const getBranchByIdController = async (req: Request, res: Response): Promise<void> => {
  try {
    const value = req.params.branchId;
    const branchId = Array.isArray(value) ? value[0] : value;
    if (!branchId || !/^[a-f0-9]{24}$/i.test(branchId)) {
      res.status(400).json({success: false, message: 'Invalid branch ID'}); return;
    }
    const context = integrated() ? await integratedSchoolContext(req) : undefined;
    const branch = context ? await context.database.collection('branches').findOne({_id: new Types.ObjectId(branchId)}, {projection}) : await getBranchById(branchId);
    if (!branch) {res.status(404).json({success: false, message: 'Branch not found'}); return;}
    res.status(200).json({success: true, message: 'Branch fetched successfully', data: branch});
  } catch (error) {failure(error, res);}
};

export const getBranches = async (req: Request, res: Response): Promise<void> => {
  try {
    const context = integrated() ? await integratedSchoolContext(req) : undefined;
    const branches = context ? await context.database.collection('branches').find({}, {projection}).sort({createdAt: -1}).toArray() : await getAllBranches();
    res.status(200).json({success: true, branches});
  } catch (error) {failure(error, res);}
};

export const getMyBranch = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    if (!req.branchId) {res.status(403).json({success: false, message: 'Branch scope is required'}); return;}
    const context = integrated() ? await integratedSchoolContext(req) : undefined;
    const branch = context ? await context.database.collection('branches').findOne({_id: new Types.ObjectId(req.branchId)}, {projection}) : await getBranchById(req.branchId);
    if (!branch) {res.status(404).json({success: false, message: 'Branch not found'}); return;}
    res.status(200).json({success: true, branch});
  } catch (error) {failure(error, res);}
};
