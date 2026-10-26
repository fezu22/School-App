import mongoose from 'mongoose';
import { AssignedWork } from '../models/assignedWork';
import User from '../models/user';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import Session from '../models/session';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  dateField,
  RequestContractError,
} from '../utils/request-validation';
import {
  getTeacherScope,
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  communicationScope,
  communicationMissing,
  exactTuple,
  communicationFence,
  withTeacherCommunication,
  type Identity,
} from './teacher-communication-access.service';
import { verifyAccessToken } from './jwt.service';

type Work = NonNullable<Awaited<ReturnType<typeof AssignedWork.findOne>>>;
const workDTO = (work: Work, canComplete: boolean) => ({
  workId: String(work._id),
  title: work.title,
  summary: work.summary,
  sourceType: work.sourceType,
  source:
    work.sourceType === 'class_follow_up'
      ? {
          classId: String(work.sourceId),
          sectionId: String(work.sectionId),
          subjectId: String(work.subjectId),
        }
      : null,
  status: work.status,
  priority: work.priority,
  dueAt: work.dueAt?.toISOString() ?? null,
  revision: work.revision,
  completedAt: work.completedAt?.toISOString() ?? null,
  createdAt: work.createdAt.toISOString(),
  updatedAt: work.updatedAt.toISOString(),
  canComplete: canComplete && work.status === 'open',
});
const scopeQuery = (scope: Awaited<ReturnType<typeof getTeacherScope>>) => ({
  branchId: scope.branchId,
  assigneeUserId: scope.actorId,
  assigneeRole: 'teacher' as const,
  $or: [
    { sourceType: 'coordinator_follow_up' as const },
    ...(ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_CLASSES_VIEW)
      ? scope.tuples
      : []
    ).map(t => ({
      sourceType: 'class_follow_up' as const,
      sourceId: t.classId,
      sectionId: t.sectionId,
      subjectId: t.subjectId,
    })),
  ],
});
// Batch reconcile source withdrawal, never grant source access from assignment.
// Closure is monotonic when a source is observed unavailable. Queue totals and
// pages share this policy; no dashboard-specific approximation.
const reconcile = async (
  scope: Awaited<ReturnType<typeof getTeacherScope>>,
) => {
  const invalid = await AssignedWork.aggregate<{
    _id: mongoose.Types.ObjectId;
  }>([
    {
      $match: {
        branchId: new mongoose.Types.ObjectId(scope.branchId),
        assigneeUserId: new mongoose.Types.ObjectId(scope.actorId),
        sourceType: 'class_follow_up',
        status: 'open',
      },
    },
    ...[
      [SchoolClass.collection.name, 'sourceId', 'schoolClass'],
      [Section.collection.name, 'sectionId', 'section'],
      [Subject.collection.name, 'subjectId', 'subject'],
    ].map(([from, localField, as]) => ({
      $lookup: {
        from,
        localField,
        foreignField: '_id',
        pipeline: [
          { $project: { _id: 1, branchId: 1, classId: 1, isActive: 1 } },
        ],
        as,
      },
    })),
    {
      $match: {
        $expr: {
          $not: [
            {
              $and: [
                { $eq: [{ $arrayElemAt: ['$schoolClass.isActive', 0] }, true] },
                { $eq: [{ $arrayElemAt: ['$section.isActive', 0] }, true] },
                { $eq: [{ $arrayElemAt: ['$subject.isActive', 0] }, true] },
                {
                  $eq: [
                    { $arrayElemAt: ['$schoolClass.branchId', 0] },
                    '$branchId',
                  ],
                },
                {
                  $eq: [
                    { $arrayElemAt: ['$section.branchId', 0] },
                    '$branchId',
                  ],
                },
                {
                  $eq: [
                    { $arrayElemAt: ['$subject.branchId', 0] },
                    '$branchId',
                  ],
                },
                {
                  $eq: [{ $arrayElemAt: ['$section.classId', 0] }, '$sourceId'],
                },
              ],
            },
          ],
        },
      },
    },
    { $project: { _id: 1 } },
  ]).read('primary');
  if (invalid.length)
    await AssignedWork.updateMany(
      { _id: { $in: invalid.map(i => i._id) }, status: 'open' },
      {
        $set: { status: 'cancelled', cancelledAt: new Date() },
        $inc: { revision: 1 },
        $push: {
          history: {
            action: 'cancelled',
            performedBy: scope.actorId,
            reason: 'source_unavailable',
            at: new Date(),
          },
        },
      },
    );
};
export const getTeacherWorkQueue = async (identity: Identity, offset = 0) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_WORK_VIEW,
  );
  await reconcile(scope);
  const query = { ...scopeQuery(scope), status: 'open' as const };
  const [items, total] = await Promise.all([
    AssignedWork.find(query)
      .select(
        '_id title summary sourceType sourceId sectionId subjectId status priority dueAt revision completedAt createdAt updatedAt',
      )
      .read('primary')
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(50),
    AssignedWork.countDocuments(query).read('primary'),
  ]);
  return {
    total,
    items: items.map(w =>
      workDTO(
        w,
        ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_WORK_COMPLETE),
      ),
    ),
    nextOffset: offset + items.length < total ? offset + items.length : null,
  };
};
// Same reconciliation and scope as Tasks. The displayed count is the whole
// open queue, not a capped page or a claim that every task is urgent.
export const getTeacherWorkAttention = async (identity: Identity) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_WORK_VIEW,
  );
  await reconcile(scope);
  const query = { ...scopeQuery(scope), status: 'open' as const };
  // Count and urgency fold the same matched rows in one evaluation. An insert
  // or completion cannot be observed by only one of two independent reads.
  const [result] = await AssignedWork.aggregate<{
    total: number;
    urgent: number;
  }>([
    { $match: AssignedWork.find(query).cast() },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        urgent: {
          $max: {
            $cond: [
              {
                $or: [
                  { $eq: ['$priority', 'high'] },
                  {
                    $and: [
                      { $eq: [{ $type: '$dueAt' }, 'date'] },
                      { $lte: ['$dueAt', new Date()] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]).read('primary');
  return {
    total: result?.total ?? 0,
    needsAttention: (result?.urgent ?? 0) > 0,
  };
};
export const getTeacherWork = async (identity: Identity, id: unknown) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_WORK_VIEW,
  );
  await reconcile(scope);
  const work = await AssignedWork.findOne({
    ...scopeQuery(scope),
    _id: objectIdField(id, 'work ID'),
    status: { $ne: 'cancelled' },
  }).read('primary');
  if (!work) throw communicationMissing();
  return workDTO(
    work,
    ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_WORK_COMPLETE),
  );
};
export const completeTeacherWork = async (
  identity: Identity,
  token: string,
  id: unknown,
  body: unknown,
) => {
  objectBody(body, []);
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_WORK_COMPLETE,
  );
  await reconcile(scope);
  const workId = objectIdField(id, 'work ID');
  const work = await AssignedWork.findOne({
    ...scopeQuery(scope),
    _id: workId,
  }).read('primary');
  if (!work) throw communicationMissing();
  const tuple =
    work.sourceType === 'class_follow_up'
      ? exactTuple(scope, {
          classId: work.sourceId,
          sectionId: work.sectionId,
          subjectId: work.subjectId,
        })
      : undefined;
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.TEACHER_WORK_COMPLETE,
    tuple,
    async (session, current) => {
      await communicationFence(session, AssignedWork.collection.name, workId);
      const fresh = await AssignedWork.findOne({
        ...scopeQuery(current),
        _id: workId,
      }).session(session);
      if (!fresh) throw communicationMissing();
      if (
        fresh.sourceType !== work.sourceType ||
        String(fresh.sourceId) !== String(work.sourceId) ||
        String(fresh.sectionId) !== String(work.sectionId) ||
        String(fresh.subjectId) !== String(work.subjectId)
      )
        throw new RequestContractError(
          409,
          'Work source changed; reopen the item',
        );
      if (fresh.status === 'cancelled')
        throw new RequestContractError(409, 'Assigned work was withdrawn');
      if (fresh.status === 'completed') return workDTO(fresh, false);
      const completed = await AssignedWork.findOneAndUpdate(
        {
          _id: fresh._id,
          assigneeUserId: current.actorId,
          branchId: current.branchId,
          status: 'open',
          revision: fresh.revision,
        },
        {
          $set: { status: 'completed', completedAt: new Date() },
          $inc: { revision: 1 },
          $push: {
            history: {
              action: 'completed',
              performedBy: current.actorId,
              at: new Date(),
            },
          },
        },
        { session, returnDocument: 'after', runValidators: true },
      );
      if (!completed) throw new RequestContractError(409, 'Work changed');
      return workDTO(completed, false);
    },
    work.sourceType === 'class_follow_up'
      ? PERMISSIONS.TEACHER_CLASSES_VIEW
      : undefined,
  );
};
// Explicit producer boundary. Only branch source owners can assign/withdraw;
// Teacher routes never accept ownership, branch or source mutation fields.
export const manageAssignedWork = async (
  identity: Identity,
  token: string,
  body: unknown,
  cancelId?: unknown,
) => {
  const actor = await currentAcademicActor(identity);
  if (
    !['principal', 'super_admin'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.ASSIGNED_WORK_MANAGE)
  )
    throw new RequestContractError(
      403,
      'Assigned work management is not permitted',
    );
  const input = objectBody(
    body,
    cancelId === undefined
      ? [
          'assigneeUserId',
          'sourceType',
          'sourceId',
          'sectionId',
          'subjectId',
          'title',
          'summary',
          'priority',
          'dueAt',
        ]
      : [],
  );
  const assigneeId =
    cancelId === undefined
      ? objectIdField(input.assigneeUserId, 'assignee ID')
      : undefined;
  const assignee = assigneeId
    ? await User.findById(assigneeId)
        .read('primary')
        .select('_id role branchId isActive')
        .lean()
    : undefined;
  const workId =
    cancelId === undefined
      ? new mongoose.Types.ObjectId().toString()
      : objectIdField(cancelId, 'work ID');
  const old =
    cancelId === undefined
      ? undefined
      : await AssignedWork.findOne({
          _id: workId,
          ...(actor.role === 'principal'
            ? { branchId: String(actor.branchId) }
            : {}),
        }).read('primary');
  if (cancelId !== undefined && !old) throw communicationMissing();
  if (
    assigneeId &&
    (!assignee ||
      assignee.role !== 'teacher' ||
      !assignee.isActive ||
      (actor.role === 'principal' &&
        String(assignee.branchId) !== String(actor.branchId)))
  )
    throw communicationMissing();
  const branchId = await requireActiveAcademicBranch(
    String(old?.branchId ?? assignee?.branchId),
  );
  const sourceType =
    cancelId === undefined
      ? enumField(input.sourceType, 'source type', [
          'coordinator_follow_up',
          'class_follow_up',
        ] as const)
      : old!.sourceType;
  const content: {
    title?: string;
    summary?: string;
    priority?: 'normal' | 'high';
    dueAt?: Date;
    sourceId?: string;
    sectionId?: string;
    subjectId?: string;
  } =
    cancelId === undefined
      ? {
          title: textField(input.title, 'title', 150, 2),
          summary: textField(input.summary, 'summary', 2000, 2),
          priority:
            input.priority === undefined
              ? 'normal'
              : enumField(input.priority, 'priority', [
                  'normal',
                  'high',
                ] as const),
          dueAt:
            input.dueAt === undefined
              ? undefined
              : dateField(input.dueAt, 'dueAt'),
          ...(sourceType === 'class_follow_up'
            ? {
                sourceId: objectIdField(input.sourceId, 'class ID'),
                sectionId: objectIdField(input.sectionId, 'section ID'),
                subjectId: objectIdField(input.subjectId, 'subject ID'),
              }
            : {}),
        }
      : {};
  if (
    sourceType === 'coordinator_follow_up' &&
    ['sourceId', 'sectionId', 'subjectId'].some(k => input[k] !== undefined)
  )
    throw new RequestContractError(400, 'Standalone work has no linked source');
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(async () => {
      const decoded = verifyAccessToken(token);
      if (decoded.userId !== identity?.userId || decoded.role !== actor.role)
        throw new RequestContractError(401, 'Authentication changed');
      const login = await Session.collection.updateMany(
        { token, userId: actor._id, role: actor.role, isRevoked: false },
        { $inc: { __v: 1 } },
        { session },
      );
      if (!login.matchedCount)
        throw new RequestContractError(401, 'Session unavailable');
      await communicationFence(
        session,
        User.collection.name,
        String(actor._id),
      );
      await communicationFence(session, Branch.collection.name, branchId);
      const currentActor = await currentAcademicActor(identity);
      if (
        currentActor.role !== actor.role ||
        !ROLE_PERMISSIONS[currentActor.role].includes(
          PERMISSIONS.ASSIGNED_WORK_MANAGE,
        ) ||
        (currentActor.role === 'principal' &&
          String(currentActor.branchId) !== branchId)
      )
        throw communicationMissing();
      if (cancelId !== undefined) {
        await communicationFence(session, AssignedWork.collection.name, workId);
        const cancelled = await AssignedWork.findOneAndUpdate(
          { _id: workId, branchId, status: { $ne: 'cancelled' } },
          {
            $set: { status: 'cancelled', cancelledAt: new Date() },
            $inc: { revision: 1 },
            $push: {
              history: {
                action: 'cancelled',
                performedBy: actor._id,
                reason: 'owner_withdrawn',
                at: new Date(),
              },
            },
          },
          { session, returnDocument: 'after' },
        );
        return { workId, status: cancelled?.status ?? 'cancelled' };
      }
      await communicationFence(session, User.collection.name, assigneeId!);
      const teacherScope = await getTeacherScope({
        userId: assigneeId!,
        role: 'teacher',
      });
      if (teacherScope.branchId !== branchId) throw communicationMissing();
      if (sourceType === 'class_follow_up') {
        if (
          !ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_CLASSES_VIEW)
        )
          throw communicationMissing();
        const tuple = exactTuple(teacherScope, {
          classId: content.sourceId,
          sectionId: content.sectionId,
          subjectId: content.subjectId,
        });
        for (const [collection, id] of [
          [SchoolClass.collection.name, tuple.classId],
          [Section.collection.name, tuple.sectionId],
          [Subject.collection.name, tuple.subjectId],
        ])
          await communicationFence(session, collection, id);
        exactTuple(
          await getTeacherScope({ userId: assigneeId!, role: 'teacher' }),
          tuple,
        );
      }
      const created = (
        await AssignedWork.create(
          [
            {
              _id: workId,
              branchId,
              assigneeUserId: assigneeId,
              assignedBy: actor._id,
              sourceType,
              ...content,
              history: [
                { action: 'assigned', performedBy: actor._id, at: new Date() },
              ],
            },
          ],
          { session },
        )
      )[0];
      return workDTO(created, false);
    }))!;
  } finally {
    await session.endSession();
  }
};
