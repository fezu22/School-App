import { NextFunction, Response } from 'express';

import User from '../models/user';
import { AuthenticatedRequest } from './auth.middleware';

export interface BranchScopedRequest extends AuthenticatedRequest {
  branchId?: string;
}
export const requireBranchScope = async (
  req: BranchScopedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    const user = await User.findById(req.user.userId).select(
      'role branchId isActive',
    );

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        success: false,
        message: 'User account is inactive',
      });
      return;
    }

    if (user.role === 'super_admin') {
      next();
      return;
    }

    if (!user.branchId) {
      res.status(403).json({
        success: false,
        message: 'User is not assigned to a branch',
      });
      return;
    }
    req.branchId = user.branchId.toString();

    next();
  } catch {
    res.status(500).json({
      success: false,
      message: 'Failed to verify branch scope',
    });
  }
};
