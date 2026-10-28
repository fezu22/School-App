import {Router, type Response} from 'express';
import {authenticateToken, type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {RequestContractError, objectBody} from '../utils/request-validation';
import {readSetup, writeSetup, setupBranches, type SetupKind} from '../services/academic-setup.service';
import {readClassSubjects, writeClassSubject} from '../services/class-subject.service';

const handle = (action: (request: AuthenticatedRequest) => Promise<unknown>, status = 200, catalogMutation = false) => async (request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.method === 'GET' && request.body !== undefined) throw new RequestContractError(400, 'Unsupported request body');
    response.status(status).json({success: true, data: await action(request)});
  } catch (error) {
    // Unavailable write targets fail closed without revealing whether a foreign
    // record exists. Reads retain the existing concealed 404 contract.
    if (catalogMutation && request.user?.role === 'principal' && error instanceof RequestContractError && error.status === 404) {
      response.status(403).json({success: false, message: 'Academic setup mutation is not permitted in this branch'});
      return;
    }
    response.status(error instanceof RequestContractError ? error.status : 500).json({success: false, message: error instanceof RequestContractError ? error.message : 'Academic setup operation failed. Please retry.'});
  }
};
export const academicSetupRouter = Router();
academicSetupRouter.use(authenticateToken, requireRole('principal', 'super_admin'));
academicSetupRouter.get('/branches', handle(request => {objectBody(request.query, []); return setupBranches(request.user);}));
const curriculumRead = requirePermission(PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_VIEW);
const curriculumManage = requirePermission(PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_MANAGE);
academicSetupRouter.get('/classes/:classId/subjects', curriculumRead, handle(request => readClassSubjects(request.user, request.params.classId, request.query)));
academicSetupRouter.get('/classes/:classId/subjects/options', curriculumManage, handle(request => readClassSubjects(request.user, request.params.classId, request.query, true)));
academicSetupRouter.post('/classes/:classId/subjects', curriculumManage, handle(request => writeClassSubject(request.user, request.authContext!, request.params.classId, request.query, 'create', undefined, request.body), 201));
for (const action of ['deactivate', 'reactivate'] as const) academicSetupRouter.post('/classes/:classId/subjects/:mappingId/' + action, curriculumManage, handle(request => writeClassSubject(request.user, request.authContext!, request.params.classId, request.query, action, request.params.mappingId, request.body)));
for (const kind of ['periods', 'classes', 'sections', 'subjects', 'rooms'] as SetupKind[]) {
  const grants = {
    rooms: [PERMISSIONS.ACADEMIC_ROOMS_VIEW, PERMISSIONS.ACADEMIC_ROOMS_MANAGE],
    periods: [PERMISSIONS.ACADEMIC_PERIODS_VIEW, PERMISSIONS.ACADEMIC_PERIODS_MANAGE],
    classes: [PERMISSIONS.ACADEMIC_CLASSES_VIEW, PERMISSIONS.ACADEMIC_CLASSES_MANAGE],
    sections: [PERMISSIONS.ACADEMIC_SECTIONS_VIEW, PERMISSIONS.ACADEMIC_SECTIONS_MANAGE],
    subjects: [PERMISSIONS.ACADEMIC_SUBJECTS_VIEW, PERMISSIONS.ACADEMIC_SUBJECTS_MANAGE],
  } as const;
  const view = requirePermission(grants[kind][0]), manage = requirePermission(grants[kind][1]);
  academicSetupRouter.get(`/${kind}`, view, handle(request => readSetup(request.user, kind, request.query)));
  academicSetupRouter.get(`/${kind}/:id`, view, handle(request => readSetup(request.user, kind, request.query, request.params.id)));
  const write = (action: Parameters<typeof writeSetup>[4]) => (request: AuthenticatedRequest) => {
    const query = objectBody(request.query, ['branchId']);
    return writeSetup(request.user, request.authContext!, kind, query.branchId, action, request.params.id, request.body);
  };
  academicSetupRouter.post(`/${kind}`, manage, handle(write('create'), 201, true));
  academicSetupRouter.patch(`/${kind}/:id`, manage, handle(write('update'), 200, true));
  for (const action of kind === 'periods' ? ['activate', 'close', 'archive'] as const : ['deactivate', 'reactivate'] as const) academicSetupRouter.post(`/${kind}/:id/${action}`, manage, handle(write(action), 200, true));
}
