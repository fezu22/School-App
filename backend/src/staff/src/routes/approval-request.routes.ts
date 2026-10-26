import {Router} from 'express';

import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {requireBranchScope} from '../middleware/branch.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {getRequesterResubmissionController, resubmitApprovalRequestController} from '../controllers/approval-resubmission.controller';

import {
  getPendingApprovalRequestsController,
  getEligibleApprovalDelegatesController,
   getApprovalRequestByIdController,
  processApprovalRequestController,
} from '../controllers/approval-request.controller';

const router = Router();

router.get(
  '/:requestId/resubmission',
  authenticateToken,
  requireRole('principal', 'teacher', 'student'),
  requireBranchScope,
  getRequesterResubmissionController,
);
router.patch(
  '/:requestId/resubmit',
  authenticateToken,
  requireRole('principal', 'teacher', 'student'),
  requireBranchScope,
  resubmitApprovalRequestController,
);

router.get(
  '/pending',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW),
  requireBranchScope,
  getPendingApprovalRequestsController,
);

router.get(
  '/:requestId/eligible-delegates',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE),
  requireBranchScope,
  getEligibleApprovalDelegatesController,
);

router.get(
  '/:requestId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW),
  requireBranchScope,
  getApprovalRequestByIdController,
);

router.patch(
  '/:requestId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE),
  requireBranchScope,
  processApprovalRequestController,
);

export default router;
