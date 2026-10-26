import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import {
  getTeacherAttendanceReview,
  requestAttendanceAmendment,
  getPrincipalAttendanceReview,
  decideAttendanceAmendment,
} from '../services/attendance-amendment.service';
import { RequestContractError } from '../utils/request-validation';
import { ApprovalAccessError } from '../services/approval-authority.policy';
const router = Router();
router.use(
  [
    '/teacher/attendance/sessions/:sessionId/students/:studentId',
    '/attendance-review',
  ],
  (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  },
);
const handle =
  (action: (req: AuthenticatedRequest) => Promise<unknown>, query = false) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (
        Object.keys(req.query).some(k => !query || k !== 'offset') ||
        (req.method === 'GET' && req.body !== undefined)
      )
        throw new RequestContractError(400, 'Unsupported request fields');
      res.json({ success: true, data: await action(req) });
    } catch (e) {
      res
        .status(
          e instanceof RequestContractError || e instanceof ApprovalAccessError
            ? e.status
            : 500,
        )
        .json({
          success: false,
          message:
            e instanceof RequestContractError ||
            e instanceof ApprovalAccessError
              ? e.message
              : 'Attendance review is unavailable. Please retry.',
        });
    }
  };
const base = '/teacher/attendance/sessions/:sessionId/students/:studentId';
router.get(
  base + '/review',
  authenticateToken,
  requireRole('teacher'),
  handle(req => {
    const v = req.query.offset;
    if (v !== undefined && (typeof v !== 'string' || !/^\d{1,6}$/.test(v)))
      throw new RequestContractError(400, 'Invalid history offset');
    return getTeacherAttendanceReview(
      req.user,
      req.params.sessionId,
      req.params.studentId,
      Number(v ?? 0),
    );
  }, true),
);
router.post(
  base + '/corrections',
  authenticateToken,
  requireRole('teacher'),
  handle(req =>
    requestAttendanceAmendment(
      req.user,
      req.headers.authorization!.slice(7),
      'correction',
      req.params.sessionId,
      req.params.studentId,
      req.body,
    ),
  ),
);
router.post(
  base + '/leaves',
  authenticateToken,
  requireRole('teacher'),
  handle(req =>
    requestAttendanceAmendment(
      req.user,
      req.headers.authorization!.slice(7),
      'leave',
      req.params.sessionId,
      req.params.studentId,
      req.body,
    ),
  ),
);
router.get(
  '/attendance-review/:approvalId',
  authenticateToken,
  requireRole('principal'),
  handle(req => getPrincipalAttendanceReview(req.user, req.params.approvalId)),
);
router.post(
  '/attendance-review/:approvalId/decision',
  authenticateToken,
  requireRole('principal'),
  handle(req =>
    decideAttendanceAmendment(
      req.user,
      req.headers.authorization!.slice(7),
      req.params.approvalId,
      req.body,
    ),
  ),
);
export default router;
