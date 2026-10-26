import { Router } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { getTeacherHome } from '../services/teacher-home.service';
import { objectBody, RequestContractError } from '../utils/request-validation';

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.get(
  '/',
  authenticateToken,
  requireRole('teacher'),
  requirePermission(
    PERMISSIONS.TEACHER_TIMETABLE_VIEW,
    PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
    PERMISSIONS.TEACHER_WORK_VIEW,
    PERMISSIONS.TEACHER_NOTICES_VIEW,
  ),
  async (req: AuthenticatedRequest, res) => {
    try {
      objectBody(req.query, []);
      if (req.body !== undefined)
        throw new RequestContractError(400, 'Unsupported request body');
      res.json({ success: true, data: await getTeacherHome(req.user) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Teacher Home is unavailable. Please retry.',
        });
    }
  },
);
export default router;
