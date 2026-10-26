import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { RequestContractError } from '../utils/request-validation';
import {
  getTeacherInbox,
  getTeacherNotice,
  previewTeacherNotice,
  saveTeacherNotice,
  sendTeacherNotice,
} from '../services/teacher-notice.service';
import {
  getTeacherWorkQueue,
  getTeacherWork,
  completeTeacherWork,
  manageAssignedWork,
} from '../services/teacher-work.service';

const token = (req: AuthenticatedRequest) =>
  req.headers.authorization!.slice(7);
const offset = (req: AuthenticatedRequest) => {
  const value = req.query.offset;
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^\d{1,6}$/.test(value))
    throw new RequestContractError(400, 'Invalid queue offset');
  return Number(value);
};
const handle =
  (
    action: (req: AuthenticatedRequest) => Promise<unknown>,
    queryFields: string[] = [],
  ) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (
        Object.keys(req.query).some(k => !queryFields.includes(k)) ||
        (req.method === 'GET' && req.body !== undefined)
      )
        throw new RequestContractError(400, 'Unsupported request fields');
      res.json({ success: true, data: await action(req) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'School communication operation failed',
        });
    }
  };
export const teacherCommunicationRouter = Router();
teacherCommunicationRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
teacherCommunicationRouter.use(authenticateToken, requireRole('teacher'));
teacherCommunicationRouter.get(
  '/inbox',
  requirePermission(PERMISSIONS.TEACHER_NOTICES_VIEW),
  handle(req => getTeacherInbox(req.user, offset(req)), ['offset']),
);
teacherCommunicationRouter.post(
  '/notices/preview',
  requirePermission(PERMISSIONS.TEACHER_NOTICES_MANAGE),
  handle(req => previewTeacherNotice(req.user, req.body)),
);
teacherCommunicationRouter.post(
  '/notices',
  requirePermission(PERMISSIONS.TEACHER_NOTICES_MANAGE),
  handle(req => saveTeacherNotice(req.user, token(req), req.body)),
);
teacherCommunicationRouter.get(
  '/notices/:noticeId',
  requirePermission(PERMISSIONS.TEACHER_NOTICES_VIEW),
  handle(req => getTeacherNotice(req.user, req.params.noticeId)),
);
teacherCommunicationRouter.patch(
  '/notices/:noticeId',
  requirePermission(PERMISSIONS.TEACHER_NOTICES_MANAGE),
  handle(req =>
    saveTeacherNotice(req.user, token(req), req.body, req.params.noticeId),
  ),
);
teacherCommunicationRouter.post(
  '/notices/:noticeId/send',
  requirePermission(PERMISSIONS.TEACHER_NOTICES_MANAGE),
  handle(req =>
    sendTeacherNotice(req.user, token(req), req.params.noticeId, req.body),
  ),
);
teacherCommunicationRouter.get(
  '/tasks',
  requirePermission(PERMISSIONS.TEACHER_WORK_VIEW),
  handle(req => getTeacherWorkQueue(req.user, offset(req)), ['offset']),
);
teacherCommunicationRouter.get(
  '/tasks/:workId',
  requirePermission(PERMISSIONS.TEACHER_WORK_VIEW),
  handle(req => getTeacherWork(req.user, req.params.workId)),
);
teacherCommunicationRouter.post(
  '/tasks/:workId/complete',
  requirePermission(PERMISSIONS.TEACHER_WORK_COMPLETE),
  handle(req =>
    completeTeacherWork(req.user, token(req), req.params.workId, req.body),
  ),
);
export const assignedWorkManagementRouter = Router();
assignedWorkManagementRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
assignedWorkManagementRouter.use(
  authenticateToken,
  requireRole('principal', 'super_admin'),
  requirePermission(PERMISSIONS.ASSIGNED_WORK_MANAGE),
);
assignedWorkManagementRouter.post(
  '/',
  handle(req => manageAssignedWork(req.user, token(req), req.body)),
);
assignedWorkManagementRouter.post(
  '/:workId/cancel',
  handle(req =>
    manageAssignedWork(req.user, token(req), req.body, req.params.workId),
  ),
);
