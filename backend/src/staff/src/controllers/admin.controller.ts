import {Request, Response} from 'express';
import {getSuperAdminDashboard} from '../services/admin.service';

export const getSuperAdminDashboardController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // The integrated dashboard must not turn school Super Admin into a
    // platform-wide branch directory. Other staff modules still need adoption.
    let dashboard;
    if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
      const {getDatabase} = require('../../../database');
      const {verifiedSchoolDatabase} = require('../../../schoolAccess');
      const scoped = await verifiedSchoolDatabase(getDatabase(), (req as any).authenticatedUserRecord);
      const collection = scoped.collection('branches');
      const [total, active, inactive, list] = await Promise.all([
        collection.countDocuments({}),
        collection.countDocuments({isActive: true}),
        collection.countDocuments({isActive: false}),
        collection.find({}, {projection: {name: 1, code: 1, address: 1, city: 1, phone: 1, email: 1, isActive: 1, createdAt: 1, updatedAt: 1}}).sort({createdAt: -1}).toArray(),
      ]);
      dashboard = {branches: {total, active, inactive, list}};
    } else {
      dashboard = await getSuperAdminDashboard();
    }

    res.status(200).json({
      success: true,
      message: 'Super Admin dashboard fetched successfully',
      data: dashboard,
    });
  } catch (error) {
    const scopeError = (error as any)?.code === 'INTEGRATION_SCHOOL_SCOPE_REQUIRED';
    res.status(scopeError ? (error as any).statusCode : 500).json({
      success: false,
      message: scopeError ? (error as Error).message : 'Failed to fetch Super Admin dashboard',
    });
  }
};
