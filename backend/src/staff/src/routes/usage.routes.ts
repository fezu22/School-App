import {Router} from 'express';

import {getUsageStatusController} from '../controllers/usage.controller';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  getUsageStatusController,
);

export default router;