import {Request, Response} from 'express';

import {getUsageStatus} from '../services/usage.service';

export const getUsageStatusController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    let usageStatus;
    if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
      const {getDatabase} = require('../../../database');
      const {verifiedSchoolDatabase} = require('../../../schoolAccess');
      const scoped = await verifiedSchoolDatabase(getDatabase(), (req as any).authenticatedUserRecord);
      const [branches, users] = await Promise.all([
        scoped.collection('branches').countDocuments({}),
        scoped.collection('users').countDocuments({}),
      ]);
      usageStatus = {
        branches: {used: branches, limit: null, status: 'not_configured'},
        users: {used: users, limit: null, status: 'not_configured'},
      };
    } else {
      usageStatus = await getUsageStatus();
    }

    res.status(200).json({
      success: true,
      message: 'Usage status fetched successfully',
      data: usageStatus,
    });
  } catch (error) {
    const scopeError = (error as any)?.code === 'INTEGRATION_SCHOOL_SCOPE_REQUIRED';
    res.status(scopeError ? (error as any).statusCode : 500).json({
      success: false,
      message: scopeError ? (error as Error).message : 'Failed to fetch usage status',
    });
  }
};
