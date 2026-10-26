import Branch from '../models/branch';
import User from '../models/user';

export const getUsageStatus = async () => {
  const [totalBranches, totalUsers] = await Promise.all([
    Branch.countDocuments(),
    User.countDocuments(),
  ]);

  return {
    branches: {
      used: totalBranches,
      limit: null,
      status: 'not_configured',
    },
    users: {
      used: totalUsers,
      limit: null,
      status: 'not_configured',
    },
  };
};