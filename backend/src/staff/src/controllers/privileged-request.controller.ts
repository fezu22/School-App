import {Request, Response} from 'express';
import {Types} from 'mongoose';

import {
  getPendingPrivilegedRequests,
  reviewPrivilegedRequest,
} from '../services/privileged-request.service';
import {AuthenticatedRequest} from '../middleware/auth.middleware';

export const getPendingPrivilegedRequestsController = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const requests = await getPendingPrivilegedRequests();

    res.status(200).json({
      success: true,
      message: 'Pending privileged requests fetched successfully',
      data: {
        requests,
        total: requests.length,
      },
    });
  } catch (error) {
    console.error('Pending privileged requests error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending privileged requests',
    });
  }
};

export const reviewPrivilegedRequestController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const requestId = String(req.params.requestId);
    const {status} = req.body;

    if (!req.user || !req.user.userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (!status || !['approved', 'rejected'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status. Status must be "approved" or "rejected"',
      });
      return;
    }

    if (!Types.ObjectId.isValid(requestId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid request ID',
      });
      return;
    }

    const updatedRequest = await reviewPrivilegedRequest(
      requestId,
      status,
      req.user.userId,
    );

    res.status(200).json({
      success: true,
      message: `Privileged request ${status} successfully`,
      data: updatedRequest,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to review request';

    if (message === 'Privileged request not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Only pending requests can be reviewed') {
      res.status(409).json({ success: false, message });
      return;
    }

    if (
      message === 'Invalid request ID' ||
      message === 'Invalid status' ||
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
