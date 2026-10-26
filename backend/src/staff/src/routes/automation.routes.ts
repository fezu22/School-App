import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {
  getAutomationsController,
  toggleAutomationPauseController,
} from '../controllers/automation.controller';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE),
  getAutomationsController,
);

router.patch(
  '/:key/pause',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.AUTOMATIONS_MANAGE),
  toggleAutomationPauseController,
);

export default router;
