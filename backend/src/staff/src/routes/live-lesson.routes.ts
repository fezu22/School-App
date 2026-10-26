import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { objectBody, RequestContractError } from '../utils/request-validation';
import { liveLessonService } from '../services/live-lesson.service';
import { connectionKey } from '../services/live-classroom-state';
export const liveLessonRouter = Router();
liveLessonRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
liveLessonRouter.use(authenticateToken, requireRole('teacher', 'student'));
const token = (req: AuthenticatedRequest) =>
  req.headers.authorization!.slice(7);
const handle =
  (action: (req: AuthenticatedRequest) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (Object.keys(req.query).length)
        throw new RequestContractError(400, 'Unsupported live lesson query');
      res.json({ success: true, data: await action(req) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Live lesson operation failed',
        });
    }
  };
liveLessonRouter.get(
  '/available',
  requirePermission(PERMISSIONS.LIVE_LESSON_JOIN),
  handle(req => {
    if (req.body !== undefined)
      throw new RequestContractError(400, 'Unsupported live lesson body');
    return liveLessonService.available(req.user);
  }),
);
liveLessonRouter.post(
  '/from-timetable/:periodId/preview-config',
  requirePermission(PERMISSIONS.LIVE_LESSON_START),
  handle(req => {
    const body = objectBody(req.body, ['date']);
    return liveLessonService.previewConfig(
      req.user,
      req.params.periodId,
      body.date,
    );
  }),
);
liveLessonRouter.post(
  '/from-timetable/:periodId/start',
  requirePermission(PERMISSIONS.LIVE_LESSON_START),
  handle(req => {
    const body = objectBody(req.body, ['date', 'connectionId']);
    return liveLessonService.start(
      req.user,
      token(req),
      req.params.periodId,
      body.date,
      connectionKey(body.connectionId),
    );
  }),
);
liveLessonRouter.post(
  '/:id/join-token',
  requirePermission(PERMISSIONS.LIVE_LESSON_JOIN),
  handle(req => {
    const body = objectBody(req.body, ['connectionId']);
    return liveLessonService.join(
      req.user,
      token(req),
      req.params.id,
      connectionKey(body.connectionId),
    );
  }),
);
liveLessonRouter.post(
  '/:id/admission',
  requirePermission(PERMISSIONS.LIVE_LESSON_JOIN),
  handle(req => {
    const body = objectBody(req.body, ['connectionId']);
    return liveLessonService.requestAdmission(
      req.user,
      token(req),
      req.params.id,
      body.connectionId,
    );
  }),
);
liveLessonRouter.post(
  '/:id/classroom',
  requirePermission(PERMISSIONS.LIVE_LESSON_VIEW),
  handle(req => {
    const body = objectBody(req.body, ['connectionId', 'state']);
    return liveLessonService.classroom(
      req.user,
      token(req),
      req.params.id,
      body.connectionId,
      body.state,
    );
  }),
);
liveLessonRouter.post(
  '/:id/participants/:participantId/moderate',
  requirePermission(PERMISSIONS.LIVE_LESSON_START),
  handle(req => {
    const body = objectBody(req.body, ['action']);
    return liveLessonService.moderate(
      req.user,
      token(req),
      req.params.id,
      req.params.participantId,
      body.action,
    );
  }),
);
liveLessonRouter.post(
  '/:id/hand',
  requirePermission(PERMISSIONS.LIVE_LESSON_JOIN),
  handle(req => {
    const body = objectBody(req.body, ['connectionId', 'raised']);
    return liveLessonService.hand(
      req.user,
      token(req),
      req.params.id,
      body.connectionId,
      body.raised,
    );
  }),
);
liveLessonRouter.post(
  '/:id/end',
  requirePermission(PERMISSIONS.LIVE_LESSON_END),
  handle(req => {
    objectBody(req.body, []);
    return liveLessonService.end(req.user, token(req), req.params.id);
  }),
);
liveLessonRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.LIVE_LESSON_VIEW),
  handle(req => {
    if (req.body !== undefined)
      throw new RequestContractError(400, 'Unsupported live lesson body');
    return liveLessonService.read(req.user, req.params.id);
  }),
);
