import { Types } from 'mongoose';
import {getBranchPrincipalTasks} from './principal-task.service';
import Branch from '../models/branch';
import Student from '../models/student';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import User from '../models/user';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { ApprovalAccessError } from './approval-authority.policy';
import { validateApprovalId } from './approval-scope.service';
import {
  APPROVAL_TYPES,
  ApprovalType,
} from '../models/approvalRequest';
import { getBranchAttendanceSummary } from './attendance.service';
import { getBranchFeeSummary } from './fee.service';
import { getBranchSafetyAlertSummary } from './safety-alert.service';
import { getBranchSchoolNotices } from './school-notice.service';
import { getReviewablePendingApprovalRequests } from './approval-request.service';

export interface PrincipalDashboardData {
  branch: {
    id: string;
    name: string;
    code: string;
    city: string;
    isActive: boolean;
  };

  students: {
    total: number;
    active: number;
  };

  classes: {
    total: number;
    active: number;
  };

  sections: {
    total: number;
    active: number;
  };

  attendance: Awaited<ReturnType<typeof getBranchAttendanceSummary>>;

  tasks: Awaited<ReturnType<typeof getBranchPrincipalTasks>>;

  notices: Awaited<ReturnType<typeof getBranchSchoolNotices>>;

  feeSummary: Awaited<ReturnType<typeof getBranchFeeSummary>>;

  safetyAlerts: Awaited<ReturnType<typeof getBranchSafetyAlertSummary>>;

  pendingApprovals: {
    total: number;
    byType: Record<ApprovalType, number>;
  };
}

const createEmptyApprovalCounts = (): Record<ApprovalType, number> => ({
  [APPROVAL_TYPES.LESSON_PLAN]: 0,
  [APPROVAL_TYPES.ATTENDANCE_CORRECTION]: 0,
  [APPROVAL_TYPES.LEAVE]: 0,
  [APPROVAL_TYPES.REFUND]: 0,
  [APPROVAL_TYPES.DISCOUNT]: 0,
  [APPROVAL_TYPES.RESULT]: 0,
  [APPROVAL_TYPES.PAPER]: 0,
  [APPROVAL_TYPES.PURCHASE]: 0,
  [APPROVAL_TYPES.PAYROLL]: 0,
  [APPROVAL_TYPES.CERTIFICATE]: 0,
});

export const getPrincipalDashboard = async (
  branchId: string,
  actorId: string,
): Promise<PrincipalDashboardData> => {
  if (!Types.ObjectId.isValid(branchId)) {
    throw new Error('Invalid branch ID');
  }

  const branchObjectId = new Types.ObjectId(branchId);

  validateApprovalId(actorId, 'actor ID');
  const actor = await User.findById(actorId).where('branchId').equals(branchId)
    .where('role').equals('principal').where('isActive').equals(true).select('role');
  if (!actor) throw new ApprovalAccessError(403, 'Principal dashboard actor is not authorized');
  const canViewApprovals = ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW);

  const schoolNoticesPromise = getBranchSchoolNotices(branchId);

  const principalTasksPromise = getBranchPrincipalTasks(branchId);

  const branch = await Branch.findById(branchObjectId).select(
    '_id name code city isActive',
  );

  if (!branch) {
    throw new Error('Branch not found');
  }

  const attendanceSummaryPromise = getBranchAttendanceSummary(branchId);
  const feeSummaryPromise = getBranchFeeSummary(branchId);
  const safetyAlertSummaryPromise = getBranchSafetyAlertSummary(branchId);

  const [
    totalStudents,
    activeStudents,
    totalClasses,
    activeClasses,
    totalSections,
    activeSections,
    pendingApprovals,
    attendanceSummary,
    feeSummary,
    safetyAlerts,
    schoolNotices,
    principalTasks,
  ] = await Promise.all([
    Student.collection.countDocuments({
      branchId: branchObjectId,
    }),

    Student.collection.countDocuments({
      branchId: branchObjectId,
      isActive: true,
    }),

    SchoolClass.collection.countDocuments({
      branchId: branchObjectId,
    }),

    SchoolClass.collection.countDocuments({
      branchId: branchObjectId,
      isActive: true,
    }),

    Section.collection.countDocuments({
      branchId: branchObjectId,
    }),

    Section.collection.countDocuments({
      branchId: branchObjectId,
      isActive: true,
    }),

    // Dashboard permission does not grant approval visibility. Skip approval
    // reads entirely when view is absent; preserve the all-zero response shape.
    canViewApprovals ? getReviewablePendingApprovalRequests(branchId, actorId) : [],

    attendanceSummaryPromise,
    feeSummaryPromise,
    safetyAlertSummaryPromise,
    schoolNoticesPromise,
    principalTasksPromise,
  ]);

  const approvalsByType = createEmptyApprovalCounts();

  for (const request of pendingApprovals) {
    approvalsByType[request.approvalType] += 1;
  }

  return {
    branch: {
      id: branch._id.toString(),
      name: branch.name,
      code: branch.code,
      city: branch.city,
      isActive: branch.isActive,
    },

    students: {
      total: totalStudents,
      active: activeStudents,
    },

    classes: {
      total: totalClasses,
      active: activeClasses,
    },

    sections: {
      total: totalSections,
      active: activeSections,
    },

    attendance: attendanceSummary,

    feeSummary,

    safetyAlerts,

    tasks: principalTasks,


    notices: schoolNotices,

    pendingApprovals: {
      total: pendingApprovals.length,
      byType: approvalsByType,
    },
  };
};
