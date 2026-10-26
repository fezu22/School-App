import {NextFunction, Response} from 'express';

import {AuthenticatedRequest} from './auth.middleware';
import {UserRole} from '../models/user';

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Access forbidden',
      });
      return;
    }

    next();
  };
};