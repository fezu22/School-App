import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { RequestContractError, objectBody } from '../utils/request-validation';
import {
  getTeacherTimetable,
  getTeacherPeriod,
  acknowledgeTeacherSubstitute,
  requestTeacherTimetableIssue,
} from '../services/teacher-timetable.service';
import {
  createTimetableVersion,
  approveTimetableVersion,
  createSubstitute,
  approveSubstitute,
  retireSchedule,
  timetableOptions,
  listTimetableVersions,
} from '../services/timetable-admin.service';
const handle =
  (action: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.status(status).json({ success: true, data: await action(req) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Timetable operation failed',
        });
    }
  };
const query = (req: AuthenticatedRequest, fields: string[]) => {
  if (
    Object.keys(req.query).some(k => !fields.includes(k)) ||
    (req.method === 'GET' && req.body !== undefined)
  )
    throw new RequestContractError(400, 'Unsupported timetable request fields');
};
export const teacherTimetableRouter = Router();
teacherTimetableRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
teacherTimetableRouter.use(authenticateToken, requireRole('teacher'));
teacherTimetableRouter.get(
  '/',
  requirePermission(PERMISSIONS.TEACHER_TIMETABLE_VIEW),
  handle(req => {
    query(req, ['date']);
    return getTeacherTimetable(req.user, req.query.date);
  }),
);
teacherTimetableRouter.get(
  '/week',
  requirePermission(PERMISSIONS.TEACHER_TIMETABLE_VIEW),
  handle(req => {
    query(req, ['start']);
    return getTeacherTimetable(req.user, req.query.start, true);
  }),
);
teacherTimetableRouter.get(
  '/periods/:periodId',
  requirePermission(PERMISSIONS.TEACHER_TIMETABLE_VIEW),
  handle(req => {
    query(req, ['date']);
    return getTeacherPeriod(req.user, req.params.periodId, req.query.date);
  }),
);
teacherTimetableRouter.post(
  '/periods/:periodId/acknowledge',
  requirePermission(PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE),
  handle(req => {
    query(req, []);
    const b = objectBody(req.body, ['date']);
    return acknowledgeTeacherSubstitute(req.user, req.params.periodId, b.date);
  }),
);
teacherTimetableRouter.post(
  '/periods/:periodId/issues',
  requirePermission(PERMISSIONS.TEACHER_TIMETABLE_ISSUE),
  handle(req => {
    query(req, []);
    const b = objectBody(req.body, ['date', 'reason', 'clientOperationId']);
    return requestTeacherTimetableIssue(
      req.user,
      req.params.periodId,
      b.date,
      b.reason,
      b.clientOperationId,
    );
  }),
);
export const timetableAdminRouter = Router();
timetableAdminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
timetableAdminRouter.use(
  authenticateToken,
  requireRole('principal', 'super_admin'),
  requirePermission(PERMISSIONS.TIMETABLE_MANAGE),
);

timetableAdminRouter.get('/options', handle(req => {
  query(req, ['branchId', 'teacherId', 'classId', 'sectionId', 'subjectId', 'offset']);
  return timetableOptions(req.user, req.query);
}));
timetableAdminRouter.get('/versions', handle(req => {
  query(req, ['branchId', 'offset']);
  return listTimetableVersions(req.user, req.query);
}));

timetableAdminRouter.get('/options', handle(req => {
  query(req, ['branchId', 'teacherId', 'offset']);
  return timetableOptions(req.user, req.query);
}));
timetableAdminRouter.get('/versions', handle(req => {
  query(req, ['branchId', 'offset']);
  return listTimetableVersions(req.user, req.query);
}));
timetableAdminRouter.post(
  '/versions',
  handle(req => {
    query(req, []);
    return createTimetableVersion(req.user, req.body);
  }, 201),
);
timetableAdminRouter.post(
  '/substitutes',
  handle(req => {
    query(req, []);
    return createSubstitute(req.user, req.body);
  }, 201),
);
timetableAdminRouter.post(
  '/versions/:id/approve',
  handle(req => {
    query(req, []);
    objectBody(req.body, []);
    return approveTimetableVersion(req.user, req.params.id);
  }),
);
timetableAdminRouter.post(
  '/substitutes/:id/approve',
  handle(req => {
    query(req, []);
    objectBody(req.body, []);
    return approveSubstitute(req.user, req.params.id);
  }),
);
timetableAdminRouter.post(
  '/versions/:id/retire',
  handle(req => {
    query(req, []);
    objectBody(req.body, []);
    return retireSchedule(req.user, req.params.id, false);
  }),
);
timetableAdminRouter.post(
  '/substitutes/:id/retire',
  handle(req => {
    query(req, []);
    objectBody(req.body, []);
    return retireSchedule(req.user, req.params.id, true);
  }),
);
