import { Router } from 'express';

import {
  getCurrentUser,
  login,
  logout,
  register,
  rbacTest,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getCurrentUser);
router.get('/rbac-test', authenticateToken, requireRole('principal'), rbacTest);
router.get(
  '/permission-test',
  authenticateToken,
  requirePermission(PERMISSIONS.STUDENTS_CREATE),
  (_req, res) => {
    res.status(200).json({
      success: true,
      message: 'Permission access granted',
    });
  },
);

export default router;
