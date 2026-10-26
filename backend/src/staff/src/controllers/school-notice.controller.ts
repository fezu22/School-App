import { Response } from 'express';

import { BranchScopedRequest } from '../middleware/branch.middleware';
import {
  getBranchSchoolNotices,
  getSchoolNoticeById,
} from '../services/school-notice.service';

export const getSchoolNoticesController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const data = await getBranchSchoolNotices(req.branchId);

    res.status(200).json({
      success: true,
      message: 'School notices fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch school notices';

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch school notices',
    });
  }
};

export const getSchoolNoticeByIdController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const noticeIdParam = req.params.noticeId;
    const noticeId = Array.isArray(noticeIdParam)
      ? noticeIdParam[0]
      : noticeIdParam;

    if (!noticeId) {
      res.status(400).json({
        success: false,
        message: 'School notice ID is required',
      });
      return;
    }

    const data = await getSchoolNoticeById(noticeId, req.branchId);

    res.status(200).json({
      success: true,
      message: 'School notice fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch school notice';

    if (message === 'Invalid notice ID' || message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'School notice not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch school notice',
    });
  }
};
