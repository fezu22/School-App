import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import {
  getAcademicContext,
  getManagedSyllabus,
  listAcademicContexts,
  manageSyllabus,
} from '../services/syllabus.service';
import { listLessons, writeLesson } from '../services/lesson-plan.service';
import { RequestContractError } from '../utils/request-validation';
import { ApprovalAccessError } from '../services/approval-authority.policy';
import { getLessonReview, decideLessonReview, listLessonReviews } from '../services/lesson-review.service';
import { getDeliveryContext, recordDelivery, listOccurrenceLessons } from '../services/lesson-delivery.service';
import { getTeacherCoverage } from '../services/syllabus-coverage.service';

const handle =
  (action: (req: AuthenticatedRequest) => Promise<unknown>, context = false) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (
        Object.keys(req.query).some(
          k => !context || !['classId', 'sectionId', 'subjectId'].includes(k),
        ) ||
        (req.method === 'GET' && req.body !== undefined)
      )
        throw new RequestContractError(400, 'Unsupported request fields');
      res.json({ success: true, data: await action(req) });
    } catch (e) {
      res
        .status(e instanceof RequestContractError || e instanceof ApprovalAccessError ? e.status : 500)
        .json({
          success: false,
          message:
            e instanceof RequestContractError || e instanceof ApprovalAccessError
              ? e.message
              : 'Academic operation failed. Please retry.',
        });
    }
  };
const token = (r: AuthenticatedRequest) => r.authContext!;
export const academicAdminRouter = Router();
academicAdminRouter.use((_r, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
academicAdminRouter.use(authenticateToken, requireRole('super_admin'));
academicAdminRouter.post(
  '/',
  handle(r => manageSyllabus(r.user, token(r), 'create', undefined, r.body)),
);
academicAdminRouter.get(
  '/:syllabusId',
  handle(r => getManagedSyllabus(r.user, r.params.syllabusId)),
);
academicAdminRouter.patch(
  '/:syllabusId',
  handle(r =>
    manageSyllabus(r.user, token(r), 'update', r.params.syllabusId, r.body),
  ),
);
academicAdminRouter.post(
  '/:syllabusId/publish',
  handle(r =>
    manageSyllabus(r.user, token(r), 'publish', r.params.syllabusId, r.body),
  ),
);
academicAdminRouter.post(
  '/:syllabusId/retire',
  handle(r =>
    manageSyllabus(r.user, token(r), 'retire', r.params.syllabusId, r.body),
  ),
);
export const teacherAcademicRouter = Router();
teacherAcademicRouter.use((_r, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
teacherAcademicRouter.use(authenticateToken, requireRole('teacher'));
teacherAcademicRouter.get(
  '/contexts',
  handle(r => listAcademicContexts(r.user)),
);
teacherAcademicRouter.get(
  '/context',
  handle(r => getAcademicContext(r.user, r.query), true),
);
teacherAcademicRouter.get(
  '/syllabuses/:syllabusId',
  handle(r => getAcademicContext(r.user, r.query, r.params.syllabusId), true),
);
teacherAcademicRouter.get(
  '/lessons',
  handle(r => listLessons(r.user, r.query), true),
);
teacherAcademicRouter.post(
  '/lessons',
  handle(r => writeLesson(r.user, token(r), 'create', undefined, r.body)),
);
teacherAcademicRouter.patch(
  '/lessons/:lessonId',
  handle(r =>
    writeLesson(r.user, token(r), 'update', r.params.lessonId, r.body),
  ),
);
teacherAcademicRouter.post(
  '/lessons/:lessonId/submit',
  handle(r =>
    writeLesson(r.user, token(r), 'submit', r.params.lessonId, r.body),
  ),
);
teacherAcademicRouter.post('/lessons/:lessonId/revise', handle(r => writeLesson(r.user, token(r), 'revise', r.params.lessonId, r.body)));
teacherAcademicRouter.get('/lessons/:lessonId/delivery-context', handle(r => getDeliveryContext(r.user, r.params.lessonId)));
teacherAcademicRouter.post('/lessons/:lessonId/deliveries', handle(r => recordDelivery(r.user, token(r), r.params.lessonId, r.body)));
teacherAcademicRouter.get('/coverage', handle(r => getTeacherCoverage(r.user, r.query), true));
teacherAcademicRouter.get('/occurrences/:periodId/lessons', async (r: AuthenticatedRequest, res: Response) => {
  try {
    if (Object.keys(r.query).some(k => k !== 'date') || r.body !== undefined) throw new RequestContractError(400, 'Unsupported request fields');
    res.json({ success: true, data: await listOccurrenceLessons(r.user, r.params.periodId, r.query.date) });
  } catch (e) { res.status(e instanceof RequestContractError ? e.status : 500).json({ success: false, message: e instanceof RequestContractError ? e.message : 'Academic operation failed. Please retry.' }); }
});
export const principalAcademicRouter = Router();
principalAcademicRouter.use((_r, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
principalAcademicRouter.use(authenticateToken, requireRole('principal'));
principalAcademicRouter.get('/history', handle(r => listLessonReviews(r.user)));
principalAcademicRouter.get('/:approvalId', handle(r => getLessonReview(r.user, r.params.approvalId)));
principalAcademicRouter.post('/:approvalId/decision', handle(r => decideLessonReview(r.user, token(r), r.params.approvalId, r.body)));
