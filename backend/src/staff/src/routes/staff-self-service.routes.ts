import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { RequestContractError } from '../utils/request-validation';
import {
  listStaffLeave,
  requestStaffLeave,
  listStaffPayslips,
  listStaffDocuments,
  staffFile,
  listStaffAppointments,
  appointmentStudents,
  offerStaffSlot,
  changeStaffAppointment,
} from '../services/staff-self-service.service';

const router = Router();
router.use(authenticateToken, requireRole('teacher'));
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (Object.keys(req.query).length) {
    res
      .status(400)
      .json({ success: false, message: 'Unsupported query fields' });
    return;
  }
  next();
});
const token = (req: AuthenticatedRequest) =>
  req.headers.authorization!.slice(7);
const handle =
  (action: (req: AuthenticatedRequest) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ success: true, data: await action(req) });
    } catch (e) {
      res
        .status(e instanceof RequestContractError ? e.status : 500)
        .json({
          success: false,
          message:
            e instanceof RequestContractError
              ? e.message
              : 'Self-service operation failed. Please retry.',
        });
    }
  };
const get = (
  path: string,
  permission: Permission,
  action: (req: AuthenticatedRequest) => Promise<unknown>,
) => router.get(path, requirePermission(permission), handle(action));
get('/summary', PERMISSIONS.STAFF_SELF_SERVICE_VIEW, async req => {
  const [leave, payslips, documents, appointments] = await Promise.all([
    listStaffLeave(req.user),
    listStaffPayslips(req.user),
    listStaffDocuments(req.user),
    listStaffAppointments(req.user),
  ]);
  return { leave, payslips, documents, appointments };
});
get('/leave', PERMISSIONS.STAFF_SELF_SERVICE_VIEW, req =>
  listStaffLeave(req.user),
);
router.post(
  '/leave',
  requirePermission(PERMISSIONS.STAFF_LEAVE_REQUEST),
  handle(req => requestStaffLeave(req.user, token(req), req.body)),
);
get('/payslips', PERMISSIONS.STAFF_PAYSLIP_VIEW_OWN, req =>
  listStaffPayslips(req.user),
);
get('/payslips/:id', PERMISSIONS.STAFF_PAYSLIP_VIEW_OWN, req =>
  listStaffPayslips(req.user, req.params.id),
);
get('/documents', PERMISSIONS.STAFF_DOCUMENTS_VIEW_OWN, req =>
  listStaffDocuments(req.user),
);
get('/documents/:id', PERMISSIONS.STAFF_DOCUMENTS_VIEW_OWN, req =>
  listStaffDocuments(req.user, req.params.id),
);
for (const kind of ['payslips', 'documents'] as const) {
  get(
    `/${kind}/:id/file-content`,
    kind === 'payslips'
      ? PERMISSIONS.STAFF_PAYSLIP_VIEW_OWN
      : PERMISSIONS.STAFF_DOCUMENTS_VIEW_OWN,
    async req => {
      const file = await staffFile(req.user, kind, req.params.id);
      return { base64: file.content.toString('base64'), mime: file.mime };
    },
  );
  router.get(
    `/${kind}/:id/file`,
    requirePermission(
      kind === 'payslips'
        ? PERMISSIONS.STAFF_PAYSLIP_VIEW_OWN
        : PERMISSIONS.STAFF_DOCUMENTS_VIEW_OWN,
    ),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const file = await staffFile(req.user, kind, req.params.id);
        const extension =
          file.mime === 'application/pdf'
            ? 'pdf'
            : file.mime === 'image/png'
            ? 'png'
            : 'jpg';
        res.setHeader('Content-Type', file.mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${
            kind === 'payslips' ? 'payslip' : 'document'
          }.${extension}"`,
        );
        res.send(file.content);
      } catch (e) {
        res
          .status(e instanceof RequestContractError ? e.status : 500)
          .json({
            success: false,
            message:
              e instanceof RequestContractError
                ? e.message
                : 'File is unavailable. Please retry.',
          });
      }
    },
  );
}
get('/appointments', PERMISSIONS.STAFF_APPOINTMENTS_VIEW, req =>
  listStaffAppointments(req.user),
);
get('/appointment-students', PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN, req =>
  appointmentStudents(req.user),
);
get('/appointments/:id', PERMISSIONS.STAFF_APPOINTMENTS_VIEW, req =>
  listStaffAppointments(req.user, req.params.id),
);
router.post(
  '/appointments/slots',
  requirePermission(PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN),
  handle(req => offerStaffSlot(req.user, token(req), req.body)),
);
for (const action of ['confirm', 'reschedule', 'cancel', 'complete'] as const)
  router.post(
    `/appointments/:id/${action}`,
    requirePermission(PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN),
    handle(req =>
      changeStaffAppointment(
        req.user,
        token(req),
        req.params.id,
        action,
        req.body,
      ),
    ),
  );
export default router;
