import {Response} from 'express';
import {BranchScopedRequest} from '../middleware/branch.middleware';
import {ApprovalAccessError} from '../services/approval-authority.policy';
import {dateField, objectBody, objectIdField, RequestContractError} from '../utils/request-validation';
import {ApprovalAction, getEligibleApprovalDelegates, getPendingApprovalRequests, getApprovalRequestById, processApprovalRequest} from '../services/approval-request.service';

const failure = (res: Response, error: unknown) => {
  const expected = error instanceof ApprovalAccessError || error instanceof RequestContractError;
  res.status(expected ? error.status : 500).json({
    success: false,
    message: expected ? error.message : 'Approval request operation failed',
  });
};
const scope = (req: BranchScopedRequest) => {
  if (!req.user) throw new ApprovalAccessError(401, 'Authentication required');
  if (!req.branchId) throw new ApprovalAccessError(403, 'Branch scope is required');
  return {actorId: req.user.userId, branchId: req.branchId};
};

export const getPendingApprovalRequestsController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const requests = await getPendingApprovalRequests(branchId, actorId);
    res.status(200).json({success: true, message: 'Pending approval requests fetched successfully', data: {requests, total: requests.length}});
  } catch (error) {failure(res, error);}
};

export const getApprovalRequestByIdController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const data = await getApprovalRequestById(String(req.params.requestId), branchId, actorId);
    res.status(200).json({success: true, message: 'Approval request fetched successfully', data});
  } catch (error) {failure(res, error);}
};

export const processApprovalRequestController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const input = objectBody(req.body, ['action', 'reason', 'delegatedTo', 'delegationExpiresAt']);
    if (typeof input.action !== 'string' || !['approved', 'rejected', 'changes_requested', 'delegated'].includes(input.action)) {
      throw new ApprovalAccessError(400, 'Invalid approval action');
    }
    if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.trim().length > 500)) {
      throw new ApprovalAccessError(400, 'Invalid decision reason');
    }
    let delegatedTo: string | undefined;
    let delegationExpiresAt: Date | undefined;
    if (input.action === 'delegated') {
      if (typeof input.delegatedTo !== 'string' || typeof input.delegationExpiresAt !== 'string') {
        throw new ApprovalAccessError(400, 'Delegate and expiry are required');
      }
      delegatedTo = objectIdField(input.delegatedTo, 'delegate user ID');
      delegationExpiresAt = dateField(input.delegationExpiresAt, 'delegation expiry');
    } else if (input.delegatedTo !== undefined || input.delegationExpiresAt !== undefined) {
      throw new ApprovalAccessError(400, 'Delegation fields require a delegation action');
    }
    const request = await processApprovalRequest({
      requestId: String(req.params.requestId), actorId, branchId,
      token: req.headers.authorization?.slice(7),
      action: input.action as ApprovalAction,
      reason: input.reason as string | undefined, delegatedTo, delegationExpiresAt,
    });
    res.status(200).json({success: true, message: 'Approval request processed successfully', data: {request}});
  } catch (error) {failure(res, error);}
};

export const getEligibleApprovalDelegatesController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const data = await getEligibleApprovalDelegates(String(req.params.requestId), branchId, actorId);
    res.status(200).json({success: true, message: 'Eligible delegates fetched successfully', data});
  } catch (error) {failure(res, error);}
};
