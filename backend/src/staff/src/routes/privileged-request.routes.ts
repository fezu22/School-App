import {Router} from 'express';

import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {
  getPendingPrivilegedRequestsController,
  reviewPrivilegedRequestController,
} from '../controllers/privileged-request.controller';

const router = Router();

router.get(
  '/pending',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.PRIVILEGED_REQUESTS_MANAGE),
  getPendingPrivilegedRequestsController,
);

router.patch(
  '/:requestId/review',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.PRIVILEGED_REQUESTS_MANAGE),
  reviewPrivilegedRequestController,
);

export default router;