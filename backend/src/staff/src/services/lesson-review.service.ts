import mongoose from 'mongoose';
import ApprovalRequest from '../models/approvalRequest';
import { LessonPlan } from '../models/lessonPlan';
import User from '../models/user';
import Session from '../models/session';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment from '../models/teacherAssignment';
import { Syllabus } from '../models/syllabus';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  academicMissing,
  revisionField,
  teacherAcademicContext,
} from './syllabus.service';
import { planAcademicContext } from './academic-plan-context.service';
import { communicationFence } from './teacher-communication-access.service';
import { assertApprovalAuthority } from './approval-authority.policy';
import { lessonDTO, operationId, hash } from './lesson-plan.service';
import type { JwtPayload } from './jwt.service';
import { verifyAccessToken } from './jwt.service';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';
import { resolveCoverage } from './syllabus-coverage.service';
import { LessonDelivery } from '../models/lessonDelivery';
import { deliveryDTO } from './lesson-delivery.service';
import { serializeApproval } from './approval-scope.service';
import { ApprovalAccessError } from './approval-authority.policy';

const academicReviewer = async (
  identity: JwtPayload | undefined,
  manage = false,
) => {
  const actor = await currentAcademicActor(identity);
  if (
    actor.role !== 'principal' ||
    !ROLE_PERMISSIONS.principal.includes(
      manage
        ? PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE
        : PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
    )
  )
    throw new RequestContractError(
      403,
      'Principal academic review is not permitted',
    );
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  assertApprovalAuthority(String(actor._id), branchId, {
    approvalType: 'lesson_plan',
  });
  return { actor, branchId };
};
const context = async (
  identity: JwtPayload | undefined,
  id: unknown,
  manage = false,
) => {
  const { actor, branchId } = await academicReviewer(identity, manage);
  const approval = await ApprovalRequest.findOne({
    _id: objectIdField(id, 'approval ID'),
    branchId,
    entityType: 'lesson_plan',
    approvalType: 'lesson_plan',
  }).read('primary');
  if (!approval) throw academicMissing();
  const plan = await LessonPlan.findOne({
    _id: approval.entityId,
    branchId,
    teacherId: approval.requesterId,
  }).read('primary');
  if (
    !plan ||
    !plan.submissions.some(s => s.revision === approval.lessonPlanRevision)
  )
    throw academicMissing();
  if (String(plan.teacherId) === String(actor._id))
    throw new RequestContractError(403, 'Self review is not permitted');
  const academic = await planAcademicContext(plan);
  const assigned = await teacherAcademicContext(
    { userId: String(plan.teacherId), role: 'teacher' },
    {
      classId: String(plan.classId),
      sectionId: String(plan.sectionId),
      subjectId: String(plan.subjectId),
    },
  );
  if (assigned.tuple.assignmentId !== String(plan.assignmentId))
    throw academicMissing();
  return { actor, branchId, approval, plan, academic };
};
export const listLessonReviews = async (identity: JwtPayload | undefined) => {
  const { branchId } = await academicReviewer(identity);
  const rows = await ApprovalRequest.find({
    branchId,
    approvalType: 'lesson_plan',
    entityType: 'lesson_plan',
  })
    .sort({ updatedAt: -1 })
    .limit(100)
    .read('primary');
  const visible = [];
  for (const row of rows) {
    try {
      await context(identity, String(row._id));
      visible.push(await serializeApproval(row));
    } catch (e) {
      if (
        !(e instanceof RequestContractError || e instanceof ApprovalAccessError)
      )
        throw e;
    }
  }
  return visible;
};
export const getLessonReview = async (
  identity: JwtPayload | undefined,
  id: unknown,
) => {
  const ctx = await context(identity, id);
  const delivery = await LessonDelivery.findOne({
    lessonPlanId: ctx.plan._id,
  }).read('primary');
  return {
    approvalId: String(ctx.approval._id),
    lesson: lessonDTO(ctx.plan),
    submittedRevision: ctx.approval.lessonPlanRevision,
    submittedContent: ctx.plan.submissions.find(
      s => s.revision === ctx.approval.lessonPlanRevision,
    )?.content,
    syllabus: ctx.academic.syllabusDTO,
    className: ctx.academic.className,
    sectionName: ctx.academic.sectionName,
    teacherName: ctx.academic.teacherName,
    canReview:
      ctx.approval.status === 'pending' &&
      ctx.plan.state === 'submitted' &&
      ctx.plan.revision === ctx.approval.lessonPlanRevision &&
      String(ctx.plan.approvalRequestId) === String(ctx.approval._id) &&
      ROLE_PERMISSIONS.principal.includes(
        PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
      ),
    delivery: delivery ? deliveryDTO(delivery) : null,
    coverage: await resolveCoverage(
      ctx.academic.syllabus,
      String(ctx.plan.sectionId),
    ),
  };
};
export const decideLessonReview = async (
  identity: JwtPayload | undefined,
  token: string,
  id: unknown,
  body: unknown,
) => {
  const input = objectBody(body, [
    'action',
    'reviewNote',
    'revision',
    'clientOperationId',
  ]);
  const action = enumField(input.action, 'decision', [
    'approved',
    'needs_revision',
    'rejected',
  ] as const);
  const note = textField(
    input.reviewNote ?? '',
    'review note',
    500,
    action === 'approved' ? 0 : 1,
  );
  const revision = revisionField(input.revision),
    op = operationId(input.clientOperationId);
  const initial = await context(identity, id, true);
  const fingerprint = hash({
    actorId: String(initial.actor._id),
    id: String(initial.approval._id),
    action,
    note,
    revision,
  });
  const tx = await mongoose.startSession();
  try {
    await tx.withTransaction(async () => {
      const decoded = verifyAccessToken(token);
      if (decoded.userId !== identity?.userId || decoded.role !== 'principal')
        throw new RequestContractError(401, 'Authentication changed');
      await communicationFence(
        tx,
        User.collection.name,
        String(initial.actor._id),
      );
      const login = await Session.collection.updateMany(
        {
          token,
          userId: initial.actor._id,
          role: 'principal',
          isRevoked: false,
        },
        { $inc: { __v: 1 } },
        { session: tx },
      );
      if (!login.matchedCount)
        throw new RequestContractError(401, 'Session is unavailable');
      for (const [collection, value] of [
        [Branch.collection.name, initial.branchId],
        [User.collection.name, String(initial.plan.teacherId)],
        [SchoolClass.collection.name, String(initial.plan.classId)],
        [Section.collection.name, String(initial.plan.sectionId)],
        [Subject.collection.name, String(initial.plan.subjectId)],
        [TeacherAssignment.collection.name, String(initial.plan.assignmentId)],
        [Syllabus.collection.name, String(initial.plan.syllabusId)],
      ])
        await communicationFence(tx, collection, value);
      const current = await context(identity, id, true);
      const row = await LessonPlan.findById(current.plan._id).session(tx);
      const approval = await ApprovalRequest.findById(
        current.approval._id,
      ).session(tx);
      if (!row || !approval) throw academicMissing();
      const replay = row.reviews.find(r => r.clientOperationId === op);
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw new RequestContractError(
            409,
            'Operation ID was used for different content',
          );
        return;
      }
      if (
        row.state !== 'submitted' ||
        row.revision !== revision ||
        approval.lessonPlanRevision !== revision ||
        approval.status !== 'pending' ||
        String(row.approvalRequestId) !== String(approval._id)
      )
        throw new RequestContractError(
          409,
          'Lesson revision changed or was already reviewed',
        );
      const now = new Date();
      row.reviews.push({
        submittedRevision: revision,
        action,
        note,
        reviewedBy: current.actor._id,
        reviewedAt: now,
        clientOperationId: op,
        fingerprint,
      });
      row.state = action;
      if (action === 'approved') row.approvedRevision = revision;
      row.revision += 1;
      row.updatedBy = current.actor._id;
      approval.status =
        action === 'needs_revision' ? 'changes_requested' : action;
      approval.reviewedBy = current.actor._id;
      approval.reviewedAt = now;
      approval.history.push({
        action: approval.status,
        performedBy: current.actor._id,
        reason: note,
        createdAt: now,
        authority: 'direct',
      });
      await approval.save({ session: tx });
      await row.save({ session: tx });
      await context(identity, id, true);
      verifyAccessToken(token);
    });
  } finally {
    await tx.endSession();
  }
  return getLessonReview(identity, id);
};
