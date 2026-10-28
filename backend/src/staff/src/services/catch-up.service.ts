import {type SessionAuthority, sessionIdentity, revalidateAuthenticatedSession, authenticatedTransaction} from './authenticated-session.service';
import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import User from '../models/user';
import Student from '../models/student';

import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../models/periodAttendance';
import { effectiveAttendance } from './attendance-effective.service';
import { LessonDelivery } from '../models/lessonDelivery';
import { Syllabus } from '../models/syllabus';
import { Homework } from '../models/homework';
import { Quiz } from '../models/quiz';
import { AcademicWorkAudience } from '../models/academicWorkAudience';
import { HomeworkSubmission } from '../models/homeworkSubmission';
import { QuizAttempt } from '../models/quizAttempt';
import { TeacherReview } from '../models/teacherReview';
import { CatchUpItem } from '../models/catchUpItem';
import {
  getTeacherScope,
  currentAcademicActor,
  requireActiveAcademicBranch,
  type TeacherAssignmentTuple,
} from './teacher-scope.service';
import {
  withTeacherCommunication,
  type Identity,
} from './teacher-communication-access.service';
import { PERMISSIONS } from '../constants/permissions';
import {
  schoolToday,
  addScheduleDays,
  scheduleDate,
} from './school-date.service';
import { type JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';

const unavailable = () =>
  new RequestContractError(
    404,
    'Catch-up is unavailable or outside your scope',
  );
const conflict = (message = 'Catch-up changed; refresh and retry') =>
  new RequestContractError(409, message);
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operationId = (value: unknown) => {
  const id = textField(value, 'client operation ID', 80, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new RequestContractError(400, 'Invalid client operation ID');
  return id;
};
const revision = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RequestContractError(400, 'Invalid catch-up revision');
  return value;
};
const graceMinutes = () => {
  const value = process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES;
  if (value === undefined) return null;
  if (!/^\d{1,5}$/.test(value) || Number(value) > 10080)
    throw new RequestContractError(500, 'Absence grace policy is unavailable');
  return Number(value);
};
const dueDays = () => {
  const value = process.env.CATCH_UP_DEFAULT_DUE_DAYS ?? '7';
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 60)
    throw new RequestContractError(
      500,
      'Catch-up due-date policy is unavailable',
    );
  return Number(value);
};
const tupleFor = (
  scope: Awaited<ReturnType<typeof getTeacherScope>>,
  row: any,
) =>
  scope.tuples.find(
    v =>
      v.classId === String(row.classId) &&
      v.sectionId === String(row.sectionId) &&
      v.subjectId === String(row.subjectId),
  );

const deliveryContext = async (
  attendance: any,
  studentId: unknown,
  transaction?: ClientSession,
) => {
  const delivery: any = await LessonDelivery.findOne({
    branchId: attendance.branchId,
    classId: attendance.classId,
    sectionId: attendance.sectionId,
    subjectId: attendance.subjectId,
    state: 'recorded',
    'occurrence.periodId': attendance.periodId,
    'occurrence.date': attendance.date,
    'occurrence.timetableVersionId': attendance.timetableVersionId,
  })
    .read('primary')
    .session(transaction ?? null);
  if (!delivery)
    return {
      delivery: null,
      topicIds: [] as mongoose.Types.ObjectId[],
      linkedWork: [] as any[],
    };
  const syllabus: any = await Syllabus.findOne({
    _id: delivery.syllabusId,
    branchId: attendance.branchId,
    classId: attendance.classId,
    subjectId: attendance.subjectId,
    version: delivery.syllabusVersion,
  })
    .read('primary')
    .session(transaction ?? null);
  const latest = delivery.history.find(
    (v: any) => v.revision === delivery.revision,
  );
  if (!syllabus || !latest)
    return {
      delivery: null,
      topicIds: [] as mongoose.Types.ObjectId[],
      linkedWork: [] as any[],
    };
  const canonical = new Set(
    syllabus.units.flatMap((u: any) => u.topics.map((t: any) => String(t._id))),
  );
  const topicIds = latest.topics
    .filter(
      (v: any) => v.state !== 'not_covered' && canonical.has(String(v.topicId)),
    )
    .map((v: any) => v.topicId);
  if (
    topicIds.length !==
    latest.topics.filter((v: any) => v.state !== 'not_covered').length
  )
    return {
      delivery: null,
      topicIds: [] as mongoose.Types.ObjectId[],
      linkedWork: [] as any[],
    };
  const works = await Promise.all([
    Homework.find({
      lessonDeliveryId: delivery._id,
      branchId: attendance.branchId,
      status: 'published',
    }).session(transaction ?? null),
    Quiz.find({
      lessonDeliveryId: delivery._id,
      branchId: attendance.branchId,
      status: 'published',
    }).session(transaction ?? null),
  ]);
  const linkedWork: any[] = [];
  for (const [workType, rows] of [
    ['homework', works[0]],
    ['quiz', works[1]],
  ] as const)
    for (const work of rows as any[]) {
      const entitlement: any = await (AcademicWorkAudience as any)
        .findOne({
          workType,
          workId: work._id,
          publishedRevision: work.publishedRevision,
          studentId,
          state: 'assigned',
        })
        .session(transaction ?? null);
      if (entitlement)
        linkedWork.push({
          workType,
          workId: work._id,
          publishedRevision: work.publishedRevision,
          audienceEntitlementId: entitlement._id,
        });
    }
  return { delivery, topicIds, linkedWork };
};

const reconcile = async (row: any, transaction?: ClientSession) => {
  const effective = (
    await effectiveAttendance(
      String(row.branchId),
      String(row.attendanceSessionId),
      transaction,
    )
  ).get(String(row.studentId));
  if (
    !effective ||
    effective.status !== 'absent' ||
    effective.effectiveRevision !== row.effectiveAbsenceVersion
  ) {
    if (!['stale', 'cancelled'].includes(row.status)) {
      const from = row.status;
      row.status = 'stale';
      row.revision += 1;
      row.history.push({
        revision: row.revision,
        action: 'source_invalidated',
        fromStatus: from,
        toStatus: 'stale',
        createdAt: new Date(),
      });
      await row.save({ session: transaction });
    }
    return row;
  }
  if (row.status === 'waiting_for_delivery_evidence') {
    const attendance = await AttendanceSession.findById(
      row.attendanceSessionId,
    ).session(transaction ?? null);
    if (attendance) {
      const linked = await deliveryContext(
        attendance,
        row.studentId,
        transaction,
      );
      if (linked.delivery) {
        row.lessonDeliveryId = linked.delivery._id;
        row.lessonDeliveryRevision = linked.delivery.revision;
        row.deliveryTeacherId = linked.delivery.teacherId;
        row.syllabusId = linked.delivery.syllabusId;
        row.syllabusVersion = linked.delivery.syllabusVersion;
        row.topicIds = linked.topicIds;
        row.linkedWork = linked.linkedWork;
        row.status = 'pending';
        row.revision += 1;
        row.history.push({
          revision: row.revision,
          action: 'delivery_linked',
          fromStatus: 'waiting_for_delivery_evidence',
          toStatus: 'pending',
          createdAt: new Date(),
        });
        await row.save({ session: transaction });
      }
    }
  }
  return row;
};

const materialize = async (identity: Identity) => {
  const scope = await getTeacherScope(identity),
    grace = graceMinutes();
  if (grace === null || !scope.tuples.length) return scope;
  const cutoff = new Date(Date.now() - grace * 60000);
  const sessions = await AttendanceSession.find({
    branchId: scope.branchId,
    state: 'submitted',
    submittedAt: { $lte: cutoff },
  }).read('primary');
  for (const attendance of sessions) {
    if (!tupleFor(scope, attendance)) continue;
    const effective = await effectiveAttendance(
      scope.branchId,
      String(attendance._id),
    );
    for (const studentId of attendance.rosterStudentIds) {
      const state = effective.get(String(studentId));
      if (state?.status !== 'absent') continue;
      const [record, student] = await Promise.all([
        PeriodAttendanceRecord.findOne({
          attendanceSessionId: attendance._id,
          studentId,
        }).read('primary'),
        (Student as any)
          .findOne({ _id: studentId, branchId: scope.branchId })
          .read('primary'),
      ]);
      if (!record || !student) continue;
      const linked = await deliveryContext(attendance, studentId);
      const assignedAt = new Date(),
        sourceFingerprint = hash({
          branchId: scope.branchId,
          attendanceSessionId: String(attendance._id),
          studentId: String(studentId),
          effectiveRevision: state.effectiveRevision,
        });
      try {
        await CatchUpItem.create({
          branchId: scope.branchId,
          studentId,
          recipientUserId: student.userId,
          classId: attendance.classId,
          sectionId: attendance.sectionId,
          subjectId: attendance.subjectId,
          attendanceSessionId: attendance._id,
          attendanceRecordId: record._id,
          originalAttendanceStatus: record.status,
          effectiveAbsenceVersion: state.effectiveRevision,
          occurrenceId: attendance.periodId,
          occurrenceDate: attendance.date,
          timetableVersionId: attendance.timetableVersionId,
          lessonDeliveryId: linked.delivery?._id,
          lessonDeliveryRevision: linked.delivery?.revision,
          deliveryTeacherId: linked.delivery?.teacherId,
          syllabusId: linked.delivery?.syllabusId,
          syllabusVersion: linked.delivery?.syllabusVersion,
          topicIds: linked.topicIds,
          linkedWork: linked.linkedWork,
          assignedAt,
          dueAt: addScheduleDays(schoolToday(), dueDays()),
          status: linked.delivery ? 'pending' : 'waiting_for_delivery_evidence',
          sourceFingerprint,
          history: [
            {
              revision: 1,
              action: 'created',
              toStatus: linked.delivery
                ? 'pending'
                : 'waiting_for_delivery_evidence',
              createdAt: assignedAt,
            },
          ],
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
  }
  return scope;
};

const teacherProgress = async (row: any) => {
  const links = [] as any[];
  let reviewedLinkedEvidence = false;
  for (const link of row.linkedWork) {
    const evidence: any =
      link.workType === 'homework'
        ? await HomeworkSubmission.findOne({
            audienceEntitlementId: link.audienceEntitlementId,
          }).read('primary')
        : await QuizAttempt.findOne({
            audienceEntitlementId: link.audienceEntitlementId,
            status: { $ne: 'active' },
          })
            .sort({ attemptNumber: -1 })
            .read('primary');
    const review = evidence
      ? await TeacherReview.findOne({
          evidenceId: evidence._id,
          state: { $in: ['reviewed', 'feedback_released'] },
        }).read('primary')
      : null;
    if (review) reviewedLinkedEvidence = true;
    links.push({
      workType: link.workType,
      workId: String(link.workId),
      publishedRevision: link.publishedRevision,
      state: evidence ? evidence.status : 'not_submitted',
      reviewed: !!review,
    });
  }
  return {
    linkedWork: links,
    manualEvidenceRevision: row.evidenceRevisions.at(-1)?.revision ?? 0,
    reviewState: row.review
      ? row.review.accepted
        ? 'accepted'
        : 'needs_more_work'
      : 'not_reviewed',
    reviewedLinkedEvidence,
  };
};
const studentProgress = async (row: any) => {
  const links = [] as any[];
  for (const link of row.linkedWork) {
    const evidence: any =
      link.workType === 'homework'
        ? await HomeworkSubmission.findOne({
            audienceEntitlementId: link.audienceEntitlementId,
          }).read('primary')
        : await QuizAttempt.findOne({
            audienceEntitlementId: link.audienceEntitlementId,
            status: { $ne: 'active' },
          })
            .sort({ attemptNumber: -1 })
            .read('primary');
    const released: any = evidence
      ? await TeacherReview.findOne({
          evidenceId: evidence._id,
          state: 'feedback_released',
        }).read('primary')
      : null;
    links.push({
      workType: link.workType,
      workId: String(link.workId),
      publishedRevision: link.publishedRevision,
      state: released
        ? 'feedback_released'
        : evidence
        ? 'submitted'
        : 'not_submitted',
      releasedReview: released
        ? {
            reviewRevision: released.revision,
            feedback: released.feedback ?? '',
            totalScore: released.totalScore ?? null,
            maxScore: released.maxScore ?? null,
            criterionScores: released.scores.map((v: any) => ({
              criterionId: v.criterionId,
              score: v.score,
            })),
            releasedAt: released.releasedAt?.toISOString() ?? null,
          }
        : null,
    });
  }
  return {
    linkedWork: links,
    manualEvidenceRevision: row.evidenceRevisions.at(-1)?.revision ?? 0,
  };
};
const topicsFor = async (row: any) => {
  const syllabus: any = row.syllabusId
    ? await Syllabus.findById(row.syllabusId).select('units').lean()
    : null;
  return (syllabus?.units.flatMap((u: any) => u.topics) ?? [])
    .filter((v: any) =>
      row.topicIds.some((id: any) => String(id) === String(v._id)),
    )
    .map((v: any) => ({ topicId: String(v._id), title: v.title }));
};
const teacherDTO = async (row: any, names: TeacherAssignmentTuple) => {
  const topics = await topicsFor(row);
  return {
    catchUpId: String(row._id),
    revision: row.revision,
    status: row.status,
    student: {
      studentId: String(row.studentId),
      fullName: row.studentName ?? '',
      admissionNumber: row.admissionNumber ?? '',
    },
    academic: {
      classId: String(row.classId),
      sectionId: String(row.sectionId),
      subjectId: String(row.subjectId),
      className: names.className,
      sectionName: names.sectionName,
      subjectName: names.subjectName,
    },
    absence: {
      attendanceSessionId: String(row.attendanceSessionId),
      originalStatus: row.originalAttendanceStatus,
      effectiveStatus: row.status === 'stale' ? 'corrected' : 'absent',
      effectiveVersion: row.effectiveAbsenceVersion,
      occurrenceDate: row.occurrenceDate,
      attendanceRemainsSeparate: true,
    },
    lesson: row.lessonDeliveryId
      ? {
          lessonDeliveryId: String(row.lessonDeliveryId),
          revision: row.lessonDeliveryRevision,
          actualTeacherId: String(row.deliveryTeacherId),
          syllabusId: String(row.syllabusId),
          syllabusVersion: row.syllabusVersion,
          topicIds: row.topicIds.map(String),
          topics,
        }
      : null,
    resources: row.resources.map((v: any) => ({
      resourceId: v.resourceId,
      type: v.type,
      label: v.label,
      value: v.value,
    })),
    dueAt: row.dueAt,
    assignedAt: row.assignedAt.toISOString(),
    evidence: row.evidenceRevisions.map((v: any) => ({
      revision: v.revision,
      content: v.content,
      submittedAt: v.submittedAt.toISOString(),
    })),
    review: row.review
      ? {
          revision: row.review.revision,
          evidenceRevision: row.review.evidenceRevision,
          accepted: row.review.accepted,
          note: row.review.note,
          reviewedAt: row.review.reviewedAt?.toISOString(),
        }
      : null,
    progress: await teacherProgress(row),
    history: row.history.map((v: any) => ({
      revision: v.revision,
      action: v.action,
      reason: v.reason ?? '',
      fromStatus: v.fromStatus ?? null,
      toStatus: v.toStatus ?? null,
      createdAt: v.createdAt?.toISOString(),
    })),
  };
};
const studentDTO = async (row: any) => {
  const topics = await topicsFor(row);
  return {
    catchUpId: String(row._id),
    revision: row.revision,
    status: row.status,
    academic: {
      classId: String(row.classId),
      sectionId: String(row.sectionId),
      subjectId: String(row.subjectId),
    },
    absence: {
      originalStatus: row.originalAttendanceStatus,
      effectiveStatus: row.status === 'stale' ? 'corrected' : 'absent',
      occurrenceDate: row.occurrenceDate,
      attendanceRemainsSeparate: true,
    },
    lesson: row.lessonDeliveryId
      ? {
          lessonDeliveryId: String(row.lessonDeliveryId),
          revision: row.lessonDeliveryRevision,
          syllabusVersion: row.syllabusVersion,
          topicIds: row.topicIds.map(String),
          topics,
        }
      : null,
    resources: row.resources.map((v: any) => ({
      resourceId: v.resourceId,
      type: v.type,
      label: v.label,
      value: v.value,
    })),
    dueAt: row.dueAt,
    assignedAt: row.assignedAt.toISOString(),
    evidence: row.evidenceRevisions.map((v: any) => ({
      revision: v.revision,
      content: v.content,
      submittedAt: v.submittedAt.toISOString(),
    })),
    progress: await studentProgress(row),
  };
};

export const listTeacherCatchUps = async (identity: Identity) => {
  const scope = await materialize(identity);
  const rows = await CatchUpItem.find({ branchId: scope.branchId })
    .sort({ updatedAt: -1 })
    .limit(100)
    .read('primary');
  const items = [];
  for (let row of rows as any[]) {
    const tuple = tupleFor(scope, row);
    if (!tuple) continue;
    row = await reconcile(row);
    const student: any = await Student.findById(row.studentId)
      .select('admissionNumber userId')
      .lean();
    const user: any = student
      ? await User.findById(student.userId).select('fullName').lean()
      : null;
    row.studentName = user?.fullName ?? '';
    row.admissionNumber = student?.admissionNumber ?? '';
    items.push(await teacherDTO(row, tuple));
  }
  return { items, total: items.length };
};
const teacherItem = async (identity: Identity, id: unknown) => {
  const scope = await getTeacherScope(identity);
  let row: any = await CatchUpItem.findOne({
    _id: objectIdField(id, 'catch-up ID'),
    branchId: scope.branchId,
  }).read('primary');
  if (!row) throw unavailable();
  const tuple = tupleFor(scope, row);
  if (!tuple) throw unavailable();
  row = await reconcile(row);
  const student: any = await Student.findById(row.studentId)
    .select('userId admissionNumber')
    .lean();
  const user: any = student
    ? await User.findById(student.userId).select('fullName').lean()
    : null;
  row.studentName = user?.fullName ?? '';
  row.admissionNumber = student?.admissionNumber ?? '';
  return { scope, row, tuple };
};
export const getTeacherCatchUp = async (identity: Identity, id: unknown) => {
  const ctx = await teacherItem(identity, id);
  return teacherDTO(ctx.row, ctx.tuple);
};

export const mutateTeacherCatchUp = async (
  identity: Identity,
  token: SessionAuthority,
  id: unknown,
  body: unknown,
) => {
  const input = objectBody(body, [
    'action',
    'revision',
    'clientOperationId',
    'dueAt',
    'reason',
    'resourceType',
    'label',
    'value',
    'accepted',
    'note',
  ]);
  const action = enumField(input.action, 'catch-up action', [
      'add_resource',
      'extend',
      'review',
      'close',
    ] as const),
    expected = revision(input.revision),
    op = operationId(input.clientOperationId);
  const initial = await teacherItem(identity, id),
    payloadHash = hash({ ...input, catchUpId: String(initial.row._id) });
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE,
    initial.tuple,
    async session => {
      let row: any = await CatchUpItem.findById(initial.row._id).session(
        session,
      );
      if (!row) throw unavailable();
      row = await reconcile(row, session);
      const replay = row.history.find((v: any) => v.operationId === op);
      if (replay) {
        if (replay.fingerprint !== payloadHash)
          throw conflict('Operation ID was reused');
        return teacherDTO(row, initial.tuple);
      }
      if (row.revision !== expected) throw conflict();
      if (['stale', 'cancelled', 'completed'].includes(row.status))
        throw conflict('Catch-up is not actionable');
      const from = row.status,
        now = new Date();
      if (action === 'add_resource') {
        const type = enumField(input.resourceType, 'resource type', [
          'text',
          'chapter',
          'resource_link',
        ] as const);
        const label = textField(input.label, 'resource label', 200, 1),
          value = textField(input.value, 'resource value', 2000, 1);
        if (type === 'resource_link' && !/^https:\/\//i.test(value))
          throw new RequestContractError(400, 'Resource links must use HTTPS');
        row.resources.push({
          resourceId: `r_${row.revision + 1}_${row.resources.length + 1}`,
          type,
          label,
          value,
          addedBy: initial.scope.actorId,
          addedAt: now,
        });
        if (row.status === 'waiting_for_delivery_evidence')
          row.status = 'pending';
      } else if (action === 'extend') {
        const dueAt = scheduleDate(input.dueAt),
          reason = textField(input.reason, 'extension reason', 500, 3);
        if (dueAt <= row.dueAt || dueAt < schoolToday())
          throw new RequestContractError(
            400,
            'Extension due date must be later',
          );
        row.dueAt = dueAt;
        row.status = 'extended';
        input.reason = reason;
      } else if (action === 'review') {
        if (!row.evidenceRevisions.length)
          throw conflict('Student recovery evidence is required');
        if (typeof input.accepted !== 'boolean')
          throw new RequestContractError(400, 'Review decision is required');
        const note = textField(input.note, 'review note', 2000, 3);
        row.review = {
          revision: (row.review?.revision ?? 0) + 1,
          evidenceRevision: row.evidenceRevisions.at(-1)!.revision,
          accepted: input.accepted,
          note,
          reviewedBy: initial.scope.actorId,
          reviewedAt: now,
        };
        row.status = 'under_review';
      } else {
        const p = await teacherProgress(row),
          latest = row.evidenceRevisions.at(-1)?.revision;
        if (
          !(
            latest &&
            row.review?.accepted &&
            row.review.evidenceRevision === latest
          ) &&
          !p.reviewedLinkedEvidence
        )
          throw conflict(
            'Accepted recovery evidence is required before closing',
          );
        row.status = 'completed';
      }
      row.revision += 1;
      row.history.push({
        revision: row.revision,
        action,
        actorId: initial.scope.actorId,
        reason: String(input.reason ?? input.note ?? ''),
        fromStatus: from,
        toStatus: row.status,
        createdAt: now,
        operationId: op,
        fingerprint: payloadHash,
      });
      await row.save({ session });
      return teacherDTO(row, initial.tuple);
    },
  );
};

const studentActor = async (identity: JwtPayload | undefined) => {
  const actor: any = await currentAcademicActor(identity);
  if (actor.role !== 'student')
    throw new RequestContractError(403, 'Student catch-up is not permitted');
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  const student: any = await (Student as any)
    .findOne({ userId: actor._id, branchId, isActive: true })
    .read('primary');
  if (!student) throw unavailable();
  return { actor, student, branchId };
};
export const listStudentCatchUps = async (identity: JwtPayload | undefined) => {
  const ctx = await studentActor(identity);
  const rows = await CatchUpItem.find({
    branchId: ctx.branchId,
    studentId: ctx.student._id,
    recipientUserId: ctx.actor._id,
  })
    .sort({ updatedAt: -1 })
    .read('primary');
  const items = [];
  for (let row of rows) {
    row = await reconcile(row);
    items.push(await studentDTO(row));
  }
  return { items, total: items.length };
};
export const getStudentCatchUp = async (
  identity: JwtPayload | undefined,
  id: unknown,
) => {
  const ctx = await studentActor(identity);
  let row: any = await CatchUpItem.findOne({
    _id: objectIdField(id, 'catch-up ID'),
    branchId: ctx.branchId,
    studentId: ctx.student._id,
    recipientUserId: ctx.actor._id,
  }).read('primary');
  if (!row) throw unavailable();
  row = await reconcile(row);
  return studentDTO(row);
};
export const submitStudentCatchUpEvidence = async (
  identity: JwtPayload | undefined,
  token: SessionAuthority,
  id: unknown,
  body: unknown,
) => {
  const input = objectBody(body, ['content', 'clientOperationId']);
  const content = textField(input.content, 'recovery evidence', 12000, 1),
    op = operationId(input.clientOperationId);
  const ctx = await studentActor(identity),
    payloadHash = hash({ catchUpId: String(id), content });
  const session = await mongoose.startSession();
  try {
    return (await authenticatedTransaction(session,
      async () => {
        const decoded = sessionIdentity(token);
        if (decoded.userId !== identity?.userId || decoded.role !== 'student')
          throw new RequestContractError(401, 'Authentication changed');
        await revalidateAuthenticatedSession(token, {userId: String(ctx.actor._id), role: 'student'}, session);
        let row: any = await CatchUpItem.findOne({
          _id: objectIdField(id, 'catch-up ID'),
          branchId: ctx.branchId,
          studentId: ctx.student._id,
          recipientUserId: ctx.actor._id,
        }).session(session);
        if (!row) throw unavailable();
        row = await reconcile(row, session);
        const replay = row.evidenceRevisions.find(
          (v: any) => v.operationId === op,
        );
        if (replay) {
          if (replay.fingerprint !== payloadHash)
            throw conflict('Operation ID was reused');
          return studentDTO(row);
        }
        if (!['pending', 'in_progress', 'extended'].includes(row.status))
          throw conflict('Catch-up does not accept evidence');
        const now = new Date();
        row.evidenceRevisions.push({
          revision: row.evidenceRevisions.length + 1,
          content,
          submittedAt: now,
          operationId: op,
          fingerprint: payloadHash,
        });
        const from = row.status;
        row.status = 'submitted';
        row.revision += 1;
        row.history.push({
          revision: row.revision,
          action: 'student_submitted',
          actorId: ctx.actor._id,
          fromStatus: from,
          toStatus: 'submitted',
          createdAt: now,
          operationId: op,
          fingerprint: payloadHash,
        });
        await row.save({ session });
        return studentDTO(row);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    ))!;
  } finally {
    await session.endSession();
  }
};
export const suppressCatchUpsForCorrection = async (
  branchId: string,
  sessionId: string,
  studentId: string,
  correctionId: string,
  transaction: ClientSession,
) => {
  const rows: any[] = await CatchUpItem.find({
    branchId,
    attendanceSessionId: sessionId,
    studentId,
    status: { $nin: ['stale', 'cancelled'] },
  }).session(transaction);
  for (const row of rows) {
    const from = row.status;
    row.status = 'stale';
    row.revision += 1;
    row.history.push({
      revision: row.revision,
      action: 'source_invalidated',
      reason: `Attendance correction ${correctionId}`,
      fromStatus: from,
      toStatus: 'stale',
      createdAt: new Date(),
    });
    await row.save({ session: transaction });
  }
};
export const ensureCatchUpIndexes = () => CatchUpItem.createIndexes();
