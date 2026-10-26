import { Router } from 'express';

import { getSuperAdminDashboardController } from '../controllers/admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { createPrincipalController } from '../controllers/principal.controller';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import Branch from '../models/branch';
import User from '../models/user';
import {provisionTeacher} from '../services/teacher-provisioning.service';
import {RequestContractError} from '../utils/request-validation';
import {integratedSchoolContext} from '../utils/school-context';

const router = Router();

router.get(
  '/dashboard',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.BRANCHES_VIEW),
  getSuperAdminDashboardController,
);
router.post(
  '/principals',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.PRINCIPALS_MANAGE),
  createPrincipalController,
);
router.get('/teachers/branches', authenticateToken, requireRole('super_admin'),
  requirePermission(PERMISSIONS.TEACHERS_CREATE), async (req, res): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const actor = await User.findById((req as import('../middleware/auth.middleware').AuthenticatedRequest).user?.userId)
        .select('branchId role isActive').lean();
      if (!actor || actor.branchId || !actor.isActive || actor.role !== 'super_admin')
        throw new RequestContractError(403, 'Global Super Admin authority is required');
      const context = process.env.INTEGRATED_STAFF_ENABLED === 'true' ? await integratedSchoolContext(req) : undefined;
      const branches = context ? await context.database.collection('branches').find({isActive: true}, {projection: {_id: 1, name: 1, code: 1}}).sort({name: 1}).toArray() : await Branch.find({isActive: true}).select('_id name code').sort({name: 1}).lean();
      res.json({success: true, data: branches.map((b: {_id: unknown; name: string; code: string}) => ({id: String(b._id), name: b.name, code: b.code}))});
    } catch (error) {
      res.status(error instanceof RequestContractError ? error.status : 500)
        .json({success: false, message: error instanceof RequestContractError ? error.message : 'Unable to load active branches'});
    }
  });
router.post('/teachers', authenticateToken, requireRole('super_admin'),
  requirePermission(PERMISSIONS.TEACHERS_CREATE), async (req, res): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const actor = (req as import('../middleware/auth.middleware').AuthenticatedRequest).user!;
      const data = await provisionTeacher(actor.userId, req.headers.authorization!.slice(7), req.body);
      res.status(201).json({success: true, message: 'Teacher account created successfully.', data});
    } catch (error) {
      res.status(error instanceof RequestContractError ? error.status : 500)
        .json({success: false, message: error instanceof RequestContractError ? error.message : 'Unable to create Teacher account'});
    }
  });
export default router;
