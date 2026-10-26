import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {teacherClasses, teacherRoster} from '../controllers/teacher.controller';

const router = Router();
router.use((_req, res, next) => {res.setHeader('Cache-Control', 'no-store'); next();});
router.use(authenticateToken, requireRole('teacher'), requirePermission(PERMISSIONS.TEACHER_CLASSES_VIEW));
router.get('/classes', teacherClasses);
router.get('/classes/:classId', teacherClasses);
router.get('/classes/:classId/sections/:sectionId/subjects/:subjectId', teacherClasses);
router.get('/classes/:classId/sections/:sectionId/subjects/:subjectId/students', teacherRoster);
export default router;
