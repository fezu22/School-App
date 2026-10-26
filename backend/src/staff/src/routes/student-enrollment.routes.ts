import {Router, type Response} from 'express';
import {authenticateToken, type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {objectBody, RequestContractError} from '../utils/request-validation';
import {enrollmentDetail, enrollmentOptions, listEnrollmentStudents, mutateEnrollment} from '../services/student-enrollment.service';
import {admitStudent, editStudentProfile, studentProfile} from '../services/student-admin.service';
const handle = (write: (req: AuthenticatedRequest) => Promise<unknown>, successStatus = 200) => async (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {if (req.method === 'GET' && req.body !== undefined) throw new RequestContractError(400, 'Unsupported request body'); res.status(successStatus).json({success: true, data: await write(req)});}
  catch (error) {res.status(error instanceof RequestContractError ? error.status : 500).json({success: false, message: error instanceof RequestContractError ? error.message : 'Student enrollment operation failed; refresh and retry'});}
};
export const enrollmentRouter = Router();
enrollmentRouter.use(authenticateToken, requireRole('principal', 'super_admin'));

enrollmentRouter.post('/admissions', requireRole('principal'), requirePermission(PERMISSIONS.STUDENTS_CREATE, PERMISSIONS.ENROLLMENT_MANAGE, PERMISSIONS.ENROLLMENT_VIEW, PERMISSIONS.STUDENTS_VIEW),
  handle(req => admitStudent(req.user, req.headers.authorization!.slice(7), req.query, req.body), 201));
enrollmentRouter.get('/:studentId/profile', requireRole('principal'), requirePermission(PERMISSIONS.STUDENTS_VIEW),
  handle(req => studentProfile(req.user, req.params.studentId, req.query)));
enrollmentRouter.patch('/:studentId/profile', requireRole('principal'), requirePermission(PERMISSIONS.STUDENTS_UPDATE, PERMISSIONS.STUDENTS_VIEW),
  handle(req => editStudentProfile(req.user, req.headers.authorization!.slice(7), req.params.studentId, req.query, req.body)));
enrollmentRouter.get('/', requirePermission(PERMISSIONS.ENROLLMENT_VIEW), handle(req => listEnrollmentStudents(req.user, req.query)));
enrollmentRouter.get('/enrollment-options', requirePermission(PERMISSIONS.ENROLLMENT_VIEW), handle(req => enrollmentOptions(req.user, req.query)));
enrollmentRouter.get('/:studentId/enrollments', requirePermission(PERMISSIONS.ENROLLMENT_VIEW), handle(req => enrollmentDetail(req.user, req.params.studentId, req.query)));
enrollmentRouter.post('/:studentId/enrollments', requirePermission(PERMISSIONS.ENROLLMENT_MANAGE), handle(req => mutateEnrollment(req.user, req.headers.authorization!.slice(7), req.params.studentId, undefined, 'enroll', req.query, req.body)));
for (const action of ['transfer', 'promote', 'withdraw'] as const) enrollmentRouter.post('/:studentId/enrollments/:enrollmentId/' + action,
  requirePermission(action === 'promote' ? PERMISSIONS.ENROLLMENT_PROMOTE : action === 'withdraw' ? PERMISSIONS.ENROLLMENT_WITHDRAW : PERMISSIONS.ENROLLMENT_MANAGE),
  handle(req => {objectBody(req.query, ['branchId']); return mutateEnrollment(req.user, req.headers.authorization!.slice(7), req.params.studentId, req.params.enrollmentId, action, req.query, req.body);}));
