import {Response} from 'express';
import {Types} from 'mongoose';
import {AuthenticatedRequest} from '../middleware/auth.middleware';
import {getSessions, revokeSession} from '../services/session.service';

export const getSessionsController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const sessions = await getSessions();

    res.status(200).json({
      success: true,
      message: 'Sessions fetched successfully',
      data: {
        sessions,
        total: sessions.length,
      },
    });
  } catch (error) {
    console.error('Fetch sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sessions',
    });
  }
};

export const revokeSessionController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.sessionId);

    if (!req.user || !req.user.userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (!Types.ObjectId.isValid(sessionId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid session ID',
      });
      return;
    }

    const updatedSession = await revokeSession(sessionId, req.user.userId);
    const sessionData = updatedSession.toObject();
    delete sessionData.token;

    res.status(200).json({
      success: true,
      message: 'Session revoked successfully',
      data: sessionData,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to revoke session';

    if (message === 'Session not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Session is already revoked') {
      res.status(409).json({ success: false, message });
      return;
    }

    if (
      message === 'Invalid session ID' ||
      message === 'Invalid reviewer ID'
    ) {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message,
    });
  }
};
