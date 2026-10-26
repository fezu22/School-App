import Branch from '../models/branch';

export const getSuperAdminDashboard = async () => {
  const [totalBranches, activeBranches, inactiveBranches, branches] =
    await Promise.all([
      Branch.countDocuments(),
      Branch.countDocuments({isActive: true}),
      Branch.countDocuments({isActive: false}),
      Branch.find()
        .select('name code address city phone email isActive createdAt updatedAt')
        .sort({createdAt: -1})
        .lean(),
    ]);

  return {
    branches: {
      total: totalBranches,
      active: activeBranches,
      inactive: inactiveBranches,
      list: branches,
    },
  };
};