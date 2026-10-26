import {NextFunction, Request, Response} from 'express';

import {verifyAccessToken, JwtPayload} from '../services/jwt.service';
import {isTokenRevoked} from '../services/session.service';
import User from '../models/user';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
    const {authenticateRequest} = require('../../../auth');
    await authenticateRequest(req, res, async (error?: Error) => {
      if (error) { next(error); return; }
      const record = (req as any).authenticatedUserRecord;
      const identity = String(record?._id || '');
      if (!/^[a-f0-9]{24}$/i.test(identity)) {
        res.status(503).json({success: false, message: 'Staff account identity mapping is unresolved'});
        return;
      }
      req.user = {userId: identity, role: record.role};
      next();
    });
    return;
  }
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access token is required',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = verifyAccessToken(token);

    const revoked = await isTokenRevoked(token);
    if (revoked) {
      res.status(401).json({
        success: false,
        message: 'Session has been revoked',
      });
      return;
    }

    const activeUser = await User.findById(decodedToken.userId)
      .select('_id role isActive')
      .lean();
    if (
      !activeUser ||
      !activeUser.isActive ||
      activeUser.role !== decodedToken.role
    ) {
      res.status(401).json({
        success: false,
        message: 'User account is unavailable or authorization has changed',
      });
      return;
    }

    req.user = decodedToken;

    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired access token',
    });
  }
};
