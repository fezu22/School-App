import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {createAssignment, revokeAssignment} from '../controllers/teacher.controller';
import {getAssignmentOptions, getManagedTeacherAssignments} from '../services/teacher-assignment-admin.service';
import {RequestContractError} from '../utils/request-validation';
import type {AuthenticatedRequest} from '../middleware/auth.middleware';

const router = Router();
router.use((_req, res, next) => {res.setHeader('Cache-Control', 'no-store'); next();});
router.use(authenticateToken, requireRole('principal', 'super_admin'), requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE));
const read = (action: (req: AuthenticatedRequest) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: import('express').Response) => {
    try {
      if (req.body !== undefined) throw new RequestContractError(400, 'Unsupported request body');
      res.json({success: true, data: await action(req)});
    } catch (error) {
      res.status(error instanceof RequestContractError ? error.status : 500).json({success: false,
        message: error instanceof RequestContractError ? error.message : 'Assignment administration is unavailable'});
    }
  };
router.get('/options', read(req => getAssignmentOptions(req.user, req.query)));
router.get('/teachers/:teacherId', read(req => getManagedTeacherAssignments(req.user, req.params.teacherId, req.query)));
router.post('/', createAssignment);
router.patch('/:assignmentId/revoke', revokeAssignment);
export default router;
