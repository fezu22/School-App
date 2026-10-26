import {Response} from 'express';

import {BranchScopedRequest} from '../middleware/branch.middleware';
import {getPrincipalDashboard} from '../services/principal-dashboard.service';
import {ApprovalAccessError} from '../services/approval-authority.policy';

export const getPrincipalDashboardController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({success: false, message: 'Authentication required'});
      return;
    }
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const data = await getPrincipalDashboard(req.branchId, req.user.userId);

    res.status(200).json({
      success: true,
      message: 'Principal dashboard fetched successfully',
      data,
    });
  } catch (error) {
    if (error instanceof ApprovalAccessError) {
      res.status(error.status).json({success: false, message: error.message});
      return;
    }
    const message =
      error instanceof Error ? error.message : 'Failed to fetch principal dashboard';

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Branch not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal dashboard',
    });
  }
};
