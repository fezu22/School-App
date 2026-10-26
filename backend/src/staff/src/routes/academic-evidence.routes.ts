import {Router, type Response} from 'express';
import {authenticateToken, type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {RequestContractError} from '../utils/request-validation';
import {
  getStudentHomeworkEvidence, getStudentQuizAttempt, getTeacherReviewDetail, listTeacherReviewQueue,
  mutateTeacherReview, startQuizAttempt, submitHomeworkEvidence, submitQuizAttempt,
} from '../services/academic-evidence.service';

const token = (request: AuthenticatedRequest) => request.headers.authorization!.slice(7);
const handle = (action: (request: AuthenticatedRequest) => Promise<unknown>) => async (request: AuthenticatedRequest, response: Response) => {
  try {
    if (request.method === 'GET' && request.body !== undefined) throw new RequestContractError(400, 'Unsupported request body');
    response.setHeader('Cache-Control', 'no-store');
    response.json({success: true, data: await action(request)});
  } catch (error) {
    response.status(error instanceof RequestContractError ? error.status : 500).json({
      success: false, message: error instanceof RequestContractError ? error.message : 'Evidence operation failed. Please retry.',
    });
  }
};

export const studentEvidenceRouter = Router();
studentEvidenceRouter.use(authenticateToken, requireRole('student'));
studentEvidenceRouter.post('/homework/:homeworkId/submit', handle(request =>
  submitHomeworkEvidence(request.user, token(request), request.params.homeworkId, request.body)));
studentEvidenceRouter.get('/homework/:homeworkId', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return getStudentHomeworkEvidence(request.user, request.params.homeworkId);
}));
studentEvidenceRouter.post('/quiz/:quizId/attempts/start', handle(request =>
  startQuizAttempt(request.user, token(request), request.params.quizId, request.body)));
studentEvidenceRouter.post('/quiz/:quizId/attempts/:attemptId/submit', handle(request =>
  submitQuizAttempt(request.user, token(request), request.params.quizId, request.params.attemptId, request.body)));
studentEvidenceRouter.get('/quiz/:quizId/attempts/current', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return getStudentQuizAttempt(request.user, request.params.quizId);
}));
studentEvidenceRouter.get('/quiz/:quizId/attempts/:attemptId', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return getStudentQuizAttempt(request.user, request.params.quizId, request.params.attemptId);
}));

export const teacherReviewRouter = Router();
teacherReviewRouter.use(authenticateToken, requireRole('teacher'));
teacherReviewRouter.get('/', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return listTeacherReviewQueue(request.user);
}));
teacherReviewRouter.get('/:targetType/:evidenceId', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return getTeacherReviewDetail(request.user, request.params.targetType, request.params.evidenceId);
}));
teacherReviewRouter.post('/:targetType/:evidenceId', handle(request =>
  mutateTeacherReview(request.user, token(request), request.params.targetType, request.params.evidenceId, request.body)));
