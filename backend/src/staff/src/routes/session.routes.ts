import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {
  getSessionsController,
  revokeSessionController,
} from '../controllers/session.controller';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.SESSIONS_MANAGE),
  getSessionsController,
);

router.patch(
  '/:sessionId/revoke',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.SESSIONS_MANAGE),
  revokeSessionController,
);

export default router;
