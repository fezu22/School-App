import { Router, type Response } from 'express';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { RequestContractError } from '../utils/request-validation';
import {
  getAcademicWorkContext,
  getStudentAcademicWork,
  listStudentAcademicWork,
  previewAcademicWorkAudience,
  publishAcademicWork,
  saveHomework,
  saveQuiz,
} from '../services/academic-work.service';

const token = (request: AuthenticatedRequest) => request.headers.authorization!.slice(7);
const handle = (action: (request: AuthenticatedRequest) => Promise<unknown>) =>
  async (request: AuthenticatedRequest, response: Response) => {
    try {
      if (request.method === 'GET' && request.body !== undefined)
        throw new RequestContractError(400, 'Unsupported request body');
      response.json({ success: true, data: await action(request) });
    } catch (error) {
      response.status(error instanceof RequestContractError ? error.status : 500).json({
        success: false,
        message: error instanceof RequestContractError
          ? error.message
          : 'Academic work operation failed. Please retry.',
      });
    }
  };

export const teacherAcademicWorkRouter = Router();
teacherAcademicWorkRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
teacherAcademicWorkRouter.use(authenticateToken, requireRole('teacher'));
teacherAcademicWorkRouter.get('/context', handle(request => {
  if (Object.keys(request.query).some(key => key !== 'lessonPlanId'))
    throw new RequestContractError(400, 'Unsupported query fields');
  return getAcademicWorkContext(request.user, request.query.lessonPlanId);
}));
teacherAcademicWorkRouter.post('/homework', handle(request =>
  saveHomework(request.user, token(request), request.body),
));
teacherAcademicWorkRouter.patch('/homework/:id', handle(request =>
  saveHomework(request.user, token(request), request.body, request.params.id),
));
teacherAcademicWorkRouter.post('/homework/:id/preview', handle(request => {
  if (request.body !== undefined && Object.keys(request.body as object).length)
    throw new RequestContractError(400, 'Recipient arrays are not accepted');
  return previewAcademicWorkAudience(request.user, 'homework', request.params.id);
}));
teacherAcademicWorkRouter.post('/homework/:id/publish', handle(request =>
  publishAcademicWork(request.user, token(request), 'homework', request.params.id, request.body),
));
teacherAcademicWorkRouter.post('/quiz', handle(request =>
  saveQuiz(request.user, token(request), request.body),
));
teacherAcademicWorkRouter.patch('/quiz/:id', handle(request =>
  saveQuiz(request.user, token(request), request.body, request.params.id),
));
teacherAcademicWorkRouter.post('/quiz/:id/preview', handle(request => {
  if (request.body !== undefined && Object.keys(request.body as object).length)
    throw new RequestContractError(400, 'Recipient arrays are not accepted');
  return previewAcademicWorkAudience(request.user, 'quiz', request.params.id);
}));
teacherAcademicWorkRouter.post('/quiz/:id/publish', handle(request =>
  publishAcademicWork(request.user, token(request), 'quiz', request.params.id, request.body),
));

export const studentAcademicWorkRouter = Router();
studentAcademicWorkRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
studentAcademicWorkRouter.use(authenticateToken, requireRole('student'));
studentAcademicWorkRouter.get('/', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return listStudentAcademicWork(request.user);
}));
studentAcademicWorkRouter.get('/:type/:id', handle(request => {
  if (Object.keys(request.query).length) throw new RequestContractError(400, 'Unsupported query fields');
  return getStudentAcademicWork(request.user, request.params.type, request.params.id);
}));
