import {Router} from 'express';

import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {getBackupStatusController} from '../controllers/backup.controller';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  getBackupStatusController,
);

export default router;