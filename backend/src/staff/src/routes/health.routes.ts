import {Router} from 'express';

import {getSystemHealthController} from '../controllers/health.controller';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  getSystemHealthController,
);

export default router;