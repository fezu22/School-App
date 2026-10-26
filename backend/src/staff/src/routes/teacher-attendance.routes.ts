import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { objectBody, RequestContractError } from '../utils/request-validation';
import {
  getTeacherAttendancePending,
  getTeacherAttendanceSession,
  openTeacherAttendance,
  writeTeacherAttendance,
} from '../services/teacher-attendance.service';
const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(
  authenticateToken,
  requireRole('teacher'),
  requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW),
);
const handle =
  (
    action: (req: AuthenticatedRequest) => Promise<unknown>,
    fields: string[] = [],
  ) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (
        Object.keys(req.query).some(k => !fields.includes(k)) ||
        (req.method === 'GET' && req.body !== undefined)
      )
        throw new RequestContractError(
          400,
          'Unsupported attendance request fields',
        );
      res.json({ success: true, data: await action(req) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Attendance operation failed',
        });
    }
  };
const token = (req: AuthenticatedRequest) =>
  req.headers.authorization!.slice(7);
router.get(
  '/pending',
  handle(
    req => getTeacherAttendancePending(req.user, req.query.date),
    ['date'],
  ),
);
router.get(
  '/occurrences/:periodId',
  handle(
    req =>
      openTeacherAttendance(
        req.user,
        token(req),
        req.params.periodId,
        req.query.date,
      ),
    ['date'],
  ),
);
router.get(
  '/sessions/:sessionId',
  handle(req => getTeacherAttendanceSession(req.user, req.params.sessionId)),
);
for (const action of ['draft', 'submit'] as const)
  router.post(
    `/sessions/:sessionId/${action}`,
    requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_MANAGE),
    handle(req => {
      objectBody(req.body, [
        'revision',
        'rosterVersion',
        'clientOperationId',
        'marks',
      ]);
      return writeTeacherAttendance(
        req.user,
        token(req),
        req.params.sessionId,
        action,
        req.body,
      );
    }),
  );
export default router;
