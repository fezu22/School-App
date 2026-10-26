import { NextFunction, Response } from 'express';

import { AuthenticatedRequest } from './auth.middleware';
import { Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';

export const requirePermission = (...requiredPermissions: Permission[]) => {
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

    const userPermissions = ROLE_PERMISSIONS[req.user.role];

    const hasPermission = requiredPermissions.every(permission =>
      userPermissions.includes(permission),
    );

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: 'Permission denied',
      });
      return;
    }

    next();
  };
};
