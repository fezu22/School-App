import { Router } from 'express';

import {
  createBranchController,
  getBranches,
  getBranchByIdController,
} from '../controllers/branch.controller';

import { authenticateToken } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { requireBranchScope } from '../middleware/branch.middleware';
import { getMyBranch } from '../controllers/branch.controller';

const router = Router();

router.post(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.BRANCHES_MANAGE),
  createBranchController,
);

router.get('/', authenticateToken, requireRole('super_admin'), requirePermission(PERMISSIONS.BRANCHES_VIEW), getBranches);
router.get('/my-branch', authenticateToken, requireBranchScope, getMyBranch);
router.get(
  '/:branchId',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.BRANCHES_VIEW),
  getBranchByIdController,
);
export default router;
