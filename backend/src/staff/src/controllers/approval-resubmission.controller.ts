import {Response} from 'express';
import {BranchScopedRequest} from '../middleware/branch.middleware';
import {ApprovalAccessError} from '../services/approval-authority.policy';
import {getRequesterResubmission, resubmitApprovalRequest} from '../services/approval-resubmission.service';
import {objectBody, RequestContractError, writeScope} from '../utils/request-validation';

const failure = (res: Response, error: unknown) => res.status(
  error instanceof ApprovalAccessError || error instanceof RequestContractError ? error.status : 500,
).json({success: false, message: error instanceof ApprovalAccessError || error instanceof RequestContractError
  ? error.message : 'Approval resubmission operation failed'});

const checkQuery = (req: BranchScopedRequest) => {
  if (Object.keys(req.query).length) throw new RequestContractError(400, 'Unsupported resubmission query');
};

export const getRequesterResubmissionController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    checkQuery(req);
    const {actorId, branchId} = writeScope(req);
    const data = await getRequesterResubmission(String(req.params.requestId), actorId, branchId);
    res.setHeader('ETag', `"${data.revision}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({success: true, message: 'Request correction details fetched', data});
  } catch (error) {failure(res, error);}
};

export const resubmitApprovalRequestController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    checkQuery(req);
    const {actorId, branchId} = writeScope(req);
    const input = objectBody(req.body, ['reason']);
    const precondition = req.get('If-Match');
    if (!precondition || !/^"(?:0|[1-9]\d*)"$/.test(precondition)) {
      throw new RequestContractError(400, 'A quoted revision from correction details is required in If-Match');
    }
    const data = await resubmitApprovalRequest({requestId: String(req.params.requestId), actorId, branchId,
      token: req.headers.authorization?.slice(7), reason: input.reason, revision: Number(precondition.slice(1, -1))});
    res.setHeader('ETag', `"${data.revision}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({success: true, message: 'Approval request resubmitted', data});
  } catch (error) {failure(res, error);}
};
