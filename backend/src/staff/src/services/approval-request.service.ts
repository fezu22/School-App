import {type SessionAuthority} from './authenticated-session.service';
import {Types, UpdateQuery} from 'mongoose';
import ApprovalRequest, {IApprovalRequest} from '../models/approvalRequest';
import User from '../models/user';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {ApprovalAccessError, assertApprovalAuthority} from './approval-authority.policy';
import {assertApprovalReferences, serializeApproval, validateApprovalId} from './approval-scope.service';
import {withPrincipalWriteAuthority, fencePrincipalWriteUser} from './principal-write-access.service';

export type ApprovalAction = 'approved' | 'rejected' | 'changes_requested' | 'delegated';
export interface ApprovalActionInput {
  requestId: string;
  actorId: string;
  token?: SessionAuthority;
  branchId: string;
  action: ApprovalAction;
  reason?: string;
  delegatedTo?: string;
  delegationExpiresAt?: Date;
}

const authorizedActor = async (actorId: string, branchId: string) => {
  validateApprovalId(actorId, 'actor ID');
  validateApprovalId(branchId, 'branch ID');
  const actor = await User.findById(actorId).where('branchId').equals(branchId)
    .where('role').equals('principal').where('isActive').equals(true);
  if (!actor) throw new ApprovalAccessError(403, 'Approval reviewer is not authorized');
  return actor;
};

// Reuse PR-2 checks for processing, capabilities and candidate reads.
const authorizeReview = async (
  request: IApprovalRequest, actorId: string, branchId: string,
  currentActor?: Awaited<ReturnType<typeof authorizedActor>>,
) => {
  const actor = currentActor ?? await authorizedActor(actorId, branchId);
  if (request.status !== 'pending') throw new ApprovalAccessError(409, 'Only pending approval requests can be processed');
  if (request.requesterId.equals(actor._id)) {
    throw new ApprovalAccessError(403, 'Requester cannot review their own request');
  }
  assertApprovalAuthority(actorId, branchId, request);
  await assertApprovalReferences(request);
  const now = new Date();
  const isDelegate = request.delegatedTo?.equals(actor._id) ?? false;
  if (isDelegate) {
    if (!request.delegatedBy || !request.delegationExpiresAt || request.delegationExpiresAt.getTime() <= now.getTime()) {
      throw new ApprovalAccessError(403, 'Delegation is unavailable or expired');
    }
    const delegator = await authorizedActor(request.delegatedBy.toString(), branchId);
    if (delegator._id.equals(request.requesterId)) throw new ApprovalAccessError(403, 'Requester cannot delegate their own request');
    assertApprovalAuthority(delegator._id.toString(), branchId, request);
  }
  return {actor, now, isDelegate};
};

const assertCanDelegate = (request: IApprovalRequest, isDelegate: boolean) => {
  if (['attendance_correction','student_leave','lesson_plan','academic_result'].includes(request.entityType)) throw new ApprovalAccessError(400, 'Use the typed review workflow');
  if (isDelegate) throw new ApprovalAccessError(403, 'Delegated reviewers cannot redelegate');
  if (request.delegatedTo) throw new ApprovalAccessError(409, 'Request already has a delegation');
};

const authorizeDelegate = async (delegateId: string, actorId: string, branchId: string, request: IApprovalRequest) => {
  validateApprovalId(delegateId, 'delegate user ID');
  if (request.requesterId.equals(delegateId) || new Types.ObjectId(actorId).equals(delegateId)) {
    throw new ApprovalAccessError(403, 'Delegate cannot be the requester or delegator');
  }
  const delegate = await authorizedActor(delegateId, branchId);
  assertApprovalAuthority(delegate._id.toString(), branchId, request);
  return delegate;
};

export const getEligibleApprovalDelegates = async (requestId: string, branchId: string, actorId: string) => {
  validateApprovalId(requestId, 'request ID');
  await authorizedActor(actorId, branchId);
  const request = await ApprovalRequest.findOne({_id: requestId, branchId});
  if (!request) throw new ApprovalAccessError(404, 'Approval request not found');
  const {isDelegate} = await authorizeReview(request, actorId, branchId);
  assertCanDelegate(request, isDelegate);
  const users = await User.find().where('branchId').equals(branchId)
    .where('role').equals('principal').where('isActive').equals(true)
    .select('_id fullName').sort({fullName: 1, _id: 1}).lean();
  const candidates = [];
  for (const user of users) {
    try {
      await authorizeDelegate(user._id.toString(), actorId, branchId, request);
      candidates.push({_id: user._id.toString(), fullName: user.fullName});
    } catch (error) {
      if (!(error instanceof ApprovalAccessError)) throw error;
    }
  }
  return candidates;
};

// Shared by inbox and dashboard. Internal records must be projected by callers
// into safe approval DTOs or aggregate counts, never exposed directly.
export const getReviewablePendingApprovalRequests = async (branchId: string, actorId: string) => {
  const actor = await authorizedActor(actorId, branchId);
  const requests = await ApprovalRequest.find({branchId, status: 'pending'})
    .select('-supportingFileUrl -beforeData -afterData').sort({createdAt: -1});
  const visible = [];
  for (const request of requests) {
    try {
      await authorizeReview(request, actorId, branchId, actor);
      visible.push(request);
    } catch (error) {
      if (!(error instanceof ApprovalAccessError)) throw error;
      // Invalid/out-of-scope/unconfigured entries disclose no request content.
    }
  }
  return visible;
};

export const getPendingApprovalRequests = async (branchId: string, actorId: string) => {
  const requests = await getReviewablePendingApprovalRequests(branchId, actorId);
  const visible = [];
  for (const request of requests) visible.push(await serializeApproval(request));
  return visible;
};

export const getApprovalRequestById = async (requestId: string, branchId: string, actorId: string) => {
  validateApprovalId(requestId, 'request ID');
  await authorizedActor(actorId, branchId);
  const request = await ApprovalRequest.findOne({_id: requestId, branchId});
  if (!request) throw new ApprovalAccessError(404, 'Approval request not found');
  assertApprovalAuthority(actorId, branchId, request);
  await assertApprovalReferences(request);
  let canReview = false;
  let canDelegate = false;
  try {
    const {isDelegate} = await authorizeReview(request, actorId, branchId);
    canReview = true;
    assertCanDelegate(request, isDelegate);
    canDelegate = true;
  } catch (error) {
    if (!(error instanceof ApprovalAccessError)) throw error;
  }
  const canManage = ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  return {...await serializeApproval(request), capabilities: {
    canReview: canManage && canReview, canDelegate: canManage && canDelegate,
  }};
};

export const processApprovalRequest = async (data: ApprovalActionInput) => {
  validateApprovalId(data.requestId, 'request ID');
  const actor = await authorizedActor(data.actorId, data.branchId);
  if (!['approved', 'rejected', 'changes_requested', 'delegated'].includes(data.action)) {
    throw new ApprovalAccessError(400, 'Invalid approval action');
  }
  if (data.reason !== undefined && (typeof data.reason !== 'string' || data.reason.trim().length > 500)) {
    throw new ApprovalAccessError(400, 'Invalid decision reason');
  }
  if (['rejected', 'changes_requested'].includes(data.action) && !data.reason?.trim()) {
    throw new ApprovalAccessError(400, 'Reason is required for rejection or change request');
  }
  const request = await ApprovalRequest.findOne({_id: data.requestId, branchId: data.branchId});
  if (!request) throw new ApprovalAccessError(404, 'Approval request not found');
  if (['attendance_correction','student_leave','lesson_plan','academic_result'].includes(request.entityType)) throw new ApprovalAccessError(400, 'Use the typed review workflow');
  const {now, isDelegate} = await authorizeReview(request, data.actorId, data.branchId);
  if (isDelegate && data.action === 'delegated') {
    throw new ApprovalAccessError(403, 'Delegated reviewers cannot redelegate');
  }
  const update: UpdateQuery<IApprovalRequest> = {
    $push: {history: {
      action: data.action, performedBy: actor._id, createdAt: now,
      authority: isDelegate ? 'delegated' : 'direct',
      ...(isDelegate ? {delegatedBy: request.delegatedBy} : {}),
      ...(data.reason?.trim() ? {reason: data.reason.trim()} : {}),
    }},
    $inc: {__v: 1},
  };
  if (data.action === 'delegated') {
    if (!data.delegatedTo) throw new ApprovalAccessError(400, 'Delegate user is required');
    validateApprovalId(data.delegatedTo, 'delegate user ID');
    if (!(data.delegationExpiresAt instanceof Date) || !Number.isFinite(data.delegationExpiresAt.getTime()) || data.delegationExpiresAt.getTime() <= now.getTime()) {
      throw new ApprovalAccessError(400, 'Delegation expiry must be in the future');
    }
    const delegate = await authorizeDelegate(data.delegatedTo, data.actorId, data.branchId, request);
    assertCanDelegate(request, isDelegate);
    update.$set = {delegatedTo: delegate._id, delegatedBy: actor._id, delegationExpiresAt: data.delegationExpiresAt};
  } else {
    update.$set = {status: data.action, reviewedBy: actor._id, reviewedAt: now};
    if (data.action === 'changes_requested') {
      update.$unset = {delegatedTo: 1, delegatedBy: 1, delegationExpiresAt: 1};
    }
  }
  // Compare the authorized snapshot, not just status. An intervening delegation
  // or amount/entity change must not turn an earlier authority check into a write.
  const updated = await withPrincipalWriteAuthority(data, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE, async session => {
    const result = await ApprovalRequest.findOneAndUpdate({
      _id: request._id, branchId: request.branchId, status: 'pending',
      __v: request.__v ?? {$exists: false}, updatedAt: request.updatedAt,
      approvalType: request.approvalType, amount: request.amount ?? null,
      requesterId: request.requesterId, entityType: request.entityType, entityId: request.entityId,
      delegatedTo: request.delegatedTo ?? null, delegatedBy: request.delegatedBy ?? null,
      delegationExpiresAt: request.delegationExpiresAt ?? null,
      // Evaluate expiry against the database clock at the atomic write, including
      // time spent in network queues after application authorization completed.
      ...(isDelegate ? {$expr: {$gt: ['$delegationExpiresAt', '$$NOW']}} : {}),
      ...(data.action === 'delegated' ? {$expr: {$gt: [{$literal: data.delegationExpiresAt}, '$$NOW']}} : {}),
    }, update, {returnDocument: 'after', runValidators: true, session});
    if (!result) throw new ApprovalAccessError(409, 'Approval request changed or was already processed');
    return result;
  }, async session => {
    // Fence every staff identity contributing authority, not just the caller.
    for (const id of [isDelegate ? request.delegatedBy?.toString() : undefined, data.action === 'delegated' ? data.delegatedTo : undefined]) {
      if (!id) continue;
      await fencePrincipalWriteUser(id, data.branchId, ['principal'], session);
      assertApprovalAuthority(id, data.branchId, request);
    }
    assertApprovalAuthority(data.actorId, data.branchId, request);
    await assertApprovalReferences(request);
  });
  return serializeApproval(updated);
};
