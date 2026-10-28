import {type SessionAuthority, sessionIdentity} from './authenticated-session.service';
import {HydratedDocument} from 'mongoose';
import ApprovalRequest, {IApprovalRequest} from '../models/approvalRequest';
import User from '../models/user';
import {ApprovalAccessError} from './approval-authority.policy';
import {assertApprovalReferences, validateApprovalId} from './approval-scope.service';
import {textField, RequestContractError} from '../utils/request-validation';
import {withPrincipalWriteAuthority} from './principal-write-access.service';

const requesterRecord = async (requestId: string, actorId: string, branchId: string) => {
  validateApprovalId(requestId, 'request ID');
  validateApprovalId(actorId, 'requester ID');
  validateApprovalId(branchId, 'branch ID');
  const actor = await User.findById(actorId).where('branchId').equals(branchId)
    .where('isActive').equals(true).where('role').in(['principal', 'teacher', 'student']).select('_id');
  if (!actor) throw new ApprovalAccessError(403, 'Requester is not authorized');
  const request = await ApprovalRequest.findOne({_id: requestId, branchId});
  if (!request) throw new ApprovalAccessError(404, 'Approval request not found');
  if (!request.requesterId.equals(actor._id)) throw new ApprovalAccessError(403, 'Only the original requester may resubmit');
  await assertApprovalReferences(request);
  return request;
};

// Owner-facing DTO intentionally omits reviewer identities, attachments and mixed payloads.
export const serializeResubmission = (request: HydratedDocument<IApprovalRequest>) => ({
  _id: request._id.toString(), status: request.status, reason: request.reason,
  revision: request.__v ?? 0, canResubmit: request.status === 'changes_requested' && request.entityType !== 'lesson_plan',
  // Staff leave reviewer notes are HR-private on every requester-facing path.
  ...(request.entityType === 'staff_leave' ? {} : {
    changeReason: [...request.history].reverse().find(entry => entry.action === 'changes_requested')?.reason,
  }),
});

export const getRequesterResubmission = async (requestId: string, actorId: string, branchId: string) =>
  serializeResubmission(await requesterRecord(requestId, actorId, branchId));

export const resubmitApprovalRequest = async (data: {
  requestId: string; actorId: string; branchId: string; token?: SessionAuthority; reason: unknown; revision: number;
}) => {
  const reason = textField(data.reason, 'request reason', 500, 1);
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new ApprovalAccessError(400, 'Invalid request revision');
  const request = await requesterRecord(data.requestId, data.actorId, data.branchId);
  if (request.entityType === 'lesson_plan') throw new ApprovalAccessError(400, 'Revise and submit through the typed lesson workflow');
  if (request.status !== 'changes_requested' || (request.__v ?? 0) !== data.revision) {
    throw new ApprovalAccessError(409, 'Request changed or is not awaiting resubmission');
  }
  let identity;
  try {identity = sessionIdentity(data.token ?? '');}
  catch {throw new RequestContractError(401, 'Session is unavailable');}
  if (!['principal', 'teacher', 'student'].includes(identity.role)) throw new RequestContractError(403, 'Requester is not authorized');
  const updated = await withPrincipalWriteAuthority(data, undefined, async session => {
    const result = await ApprovalRequest.findOneAndUpdate({
      _id: request._id, branchId: request.branchId, requesterId: request.requesterId,
      status: 'changes_requested', __v: request.__v ?? {$exists: false}, updatedAt: request.updatedAt,
      reason: request.reason, approvalType: request.approvalType, amount: request.amount ?? null,
      entityType: request.entityType, entityId: request.entityId,
      reviewedBy: request.reviewedBy ?? null, reviewedAt: request.reviewedAt ?? null,
      delegatedTo: request.delegatedTo ?? null, delegatedBy: request.delegatedBy ?? null,
      delegationExpiresAt: request.delegationExpiresAt ?? null,
    }, {
      $set: {reason, status: 'pending'},
      $unset: {reviewedBy: 1, reviewedAt: 1, delegatedTo: 1, delegatedBy: 1, delegationExpiresAt: 1},
      $push: {history: {action: 'resubmitted', performedBy: request.requesterId, reason, createdAt: new Date()}},
      $inc: {__v: 1},
    }, {returnDocument: 'after', runValidators: true, session});
    if (!result) throw new ApprovalAccessError(409, 'Approval request changed or was already resubmitted');
    return result;
  }, undefined, identity.role as 'principal' | 'teacher' | 'student');
  return serializeResubmission(updated);
};
