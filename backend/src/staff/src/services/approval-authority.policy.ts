import {Types} from 'mongoose';
import {APPROVAL_TYPES, IApprovalRequest} from '../models/approvalRequest';

export class ApprovalAccessError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const financialTypes = new Set<string>([
  APPROVAL_TYPES.REFUND, APPROVAL_TYPES.DISCOUNT,
  APPROVAL_TYPES.PURCHASE, APPROVAL_TYPES.PAYROLL,
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// No business thresholds/default grants: only trusted server configuration grants
// authority. A grant is tied to BOTH the current reviewer and current branch.
export const assertApprovalAuthority = (
  actorId: string,
  branchId: string,
  request: Pick<IApprovalRequest, 'approvalType' | 'amount'>,
): void => {
  if (!Object.values(APPROVAL_TYPES).includes(request.approvalType)) {
    throw new ApprovalAccessError(403, 'Approval category is not authorized');
  }
  const financial = financialTypes.has(request.approvalType);
  if (
    (financial && request.amount === undefined) ||
    (request.amount !== undefined &&
      (typeof request.amount !== 'number' || !Number.isFinite(request.amount) || request.amount < 0))
  ) {
    throw new ApprovalAccessError(400, 'Invalid approval amount');
  }
  // Nonfinancial categories cannot disguise a monetary operation.
  if (!financial && request.amount !== undefined) {
    throw new ApprovalAccessError(400, 'Amount is not supported for this approval category');
  }
  let policy: unknown;
  try {
    policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY || '{}');
  } catch {
    throw new ApprovalAccessError(403, 'Approval authority is not configured');
  }
  const grant = isRecord(policy) && Object.hasOwn(policy, actorId) ? policy[actorId] : undefined;
  if (
    !isRecord(grant) ||
    Object.keys(grant).some(key => !['branchId', 'types', 'limits'].includes(key)) ||
    typeof grant.branchId !== 'string' || !Types.ObjectId.isValid(grant.branchId) ||
    grant.branchId !== branchId ||
    !Array.isArray(grant.types) ||
    grant.types.some(type => !Object.values(APPROVAL_TYPES).includes(type)) ||
    !grant.types.includes(request.approvalType)
  ) {
    throw new ApprovalAccessError(403, 'Approval category is not authorized');
  }
  if (financial) {
    const limit = isRecord(grant.limits) && Object.hasOwn(grant.limits, request.approvalType)
      ? grant.limits[request.approvalType] : undefined;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      throw new ApprovalAccessError(403, 'Financial approval authority is not configured');
    }
    if (request.amount! > limit) {
      throw new ApprovalAccessError(403, 'Approval amount exceeds authority');
    }
  }
};
