import { Types, type ClientSession } from 'mongoose';
import { LessonPlan } from '../models/lessonPlan';
import { LessonDelivery } from '../models/lessonDelivery';
import Session from '../models/session';
import User from '../models/user';
import { Syllabus } from '../models/syllabus';
import { PERMISSIONS } from '../constants/permissions';
import {
  academicMissing,
  revisionField,
  teacherAcademicContext,
} from './syllabus.service';
import { getTeacherScope } from './teacher-scope.service';
import { planAcademicContext } from './academic-plan-context.service';
import {
  getTeacherPeriod,
  mutateOccurrence,
} from './teacher-timetable.service';
import {
  communicationFence,
  withTeacherCommunication,
} from './teacher-communication-access.service';
import { schoolDateTime, scheduleDate } from './school-date.service';
import { lessonDTO, operationId, hash } from './lesson-plan.service';
import { resolveCoverage } from './syllabus-coverage.service';
import type { JwtPayload } from './jwt.service';
import { verifyAccessToken } from './jwt.service';
import {
  enumField,
  objectBody,
  objectIdField,
  textField,
  RequestContractError,
} from '../utils/request-validation';

export const deliveryDTO = (row: InstanceType<typeof LessonDelivery>) => ({
  deliveryId: String(row._id),
  lessonPlanId: String(row.lessonPlanId),
  lessonPlanRevision: row.lessonPlanRevision,
  syllabusId: String(row.syllabusId),
  syllabusVersion: row.syllabusVersion,
  revision: row.revision,
  state: row.state,
  history: row.history.map(h => ({
    revision: h.revision,
    deliveryStatus: h.deliveryStatus,
    actualTeachingDate: h.actualTeachingDate,
    topics: h.topics.map(t => ({
      topicId: String(t.topicId),
      state: t.state,
      evidence: t.evidence,
    })),
    teacherNotes: h.teacherNotes,
    correctionReason: h.correctionReason,
    recordedBy: String(h.recordedBy),
    recordedByName: h.recordedByName,
    recordedAt: h.recordedAt.toISOString(),
  })),
});
const deliveryContext = async (
  identity: JwtPayload | undefined,
  value: unknown,
) => {
  const scope = await getTeacherScope(identity);
  const plan = await LessonPlan.findOne({
    _id: objectIdField(value, 'lesson ID'),
    branchId: scope.branchId,
  }).read('primary');
  if (!plan) throw academicMissing();
  let period;
  let tuple;
  if (plan.occurrence) {
    period = await getTeacherPeriod(
      identity,
      String(plan.occurrence.periodId),
      plan.occurrence.date,
    );
    if (
      period.approvedVersion.versionId !==
        String(plan.occurrence.timetableVersionId) ||
      period.classId !== String(plan.classId) ||
      period.sectionId !== String(plan.sectionId) ||
      period.subjectId !== String(plan.subjectId)
    )
      throw academicMissing();
  } else {
    if (String(plan.teacherId) !== scope.actorId) throw academicMissing();
    const ctx = await teacherAcademicContext(identity, {
      classId: String(plan.classId),
      sectionId: String(plan.sectionId),
      subjectId: String(plan.subjectId),
    });
    if (ctx.tuple.assignmentId !== String(plan.assignmentId))
      throw academicMissing();
    tuple = ctx.tuple;
  }
  const academic = await planAcademicContext(plan);
  return { scope, plan, period, tuple, academic };
};
export const getDeliveryContext = async (
  identity: JwtPayload | undefined,
  value: unknown,
) => {
  const ctx = await deliveryContext(identity, value);
  const row = await LessonDelivery.findOne({ lessonPlanId: ctx.plan._id }).read(
    'primary',
  );
  return {
    lesson: lessonDTO(ctx.plan),
    syllabus: ctx.academic.syllabusDTO,
    className: ctx.academic.className,
    sectionName: ctx.academic.sectionName,
    teacherName: ctx.academic.teacherName,
    period: ctx.period ?? null,
    today: schoolDateTime().date,
    canRecord: ctx.plan.state === 'approved' && !!ctx.plan.approvedRevision,
    delivery: row ? deliveryDTO(row) : null,
    coverage: await resolveCoverage(
      ctx.academic.syllabus,
      String(ctx.plan.sectionId),
    ),
  };
};
export const listOccurrenceLessons = async (
  identity: JwtPayload | undefined,
  periodId: unknown,
  date: unknown,
) => {
  const period = await getTeacherPeriod(identity, periodId, date);
  const scope = await getTeacherScope(identity);
  const plans = await LessonPlan.find({
    branchId: scope.branchId,
    state: 'approved',
    'occurrence.periodId': period.periodId,
    'occurrence.date': period.date,
    'occurrence.timetableVersionId': period.approvedVersion.versionId,
    classId: period.classId,
    sectionId: period.sectionId,
    subjectId: period.subjectId,
  })
    .read('primary')
    .limit(100);
  const visible = [];
  for (const plan of plans) {
    try {
      await planAcademicContext(plan);
      visible.push(lessonDTO(plan));
    } catch (e) {
      if (!(e instanceof RequestContractError)) throw e;
    }
  }
  return visible;
};
export const recordDelivery = async (
  identity: JwtPayload | undefined,
  token: string,
  value: unknown,
  body: unknown,
) => {
  const input = objectBody(body, [
    'lessonPlanRevision',
    'revision',
    'clientOperationId',
    'deliveryStatus',
    'actualTeachingDate',
    'topics',
    'teacherNotes',
    'correctionReason',
  ]);
  const op = operationId(input.clientOperationId),
    approvedRevision = revisionField(input.lessonPlanRevision);
  if (
    typeof input.revision !== 'number' ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    throw new RequestContractError(
      400,
      'A nonnegative delivery revision is required',
    );
  const revision = input.revision;
  const status = enumField(input.deliveryStatus, 'delivery status', [
    'delivered',
    'partially_delivered',
    'not_delivered',
  ] as const);
  const actualTeachingDate = scheduleDate(input.actualTeachingDate);
  if (
    !Array.isArray(input.topics) ||
    !input.topics.length ||
    input.topics.length > 100
  )
    throw new RequestContractError(
      400,
      'Evidence is required for every planned topic',
    );
  const topics = input.topics
    .map(v => {
      const t = objectBody(v, ['topicId', 'state', 'evidence']);
      return {
        topicId: objectIdField(t.topicId, 'topic ID'),
        state: enumField(t.state, 'topic state', [
          'completed',
          'partial',
          'not_covered',
        ] as const),
        evidence: textField(t.evidence, 'topic evidence', 1000, 1),
      };
    })
    .sort((a, b) => a.topicId.localeCompare(b.topicId));
  const teacherNotes = textField(
    input.teacherNotes ?? '',
    'teacher notes',
    4000,
  );
  const correctionReason = textField(
    input.correctionReason ?? '',
    'correction reason',
    500,
    revision ? 1 : 0,
  );
  const derived = topics.every(t => t.state === 'completed')
    ? 'delivered'
    : topics.every(t => t.state === 'not_covered')
    ? 'not_delivered'
    : 'partially_delivered';
  if (status !== derived)
    throw new RequestContractError(
      400,
      'Overall delivery status must agree with per-topic evidence',
    );
  const initial = await deliveryContext(identity, value);
  const fingerprint = hash({
    lessonId: String(initial.plan._id),
    approvedRevision,
    revision,
    status,
    actualTeachingDate,
    topics,
    teacherNotes,
    correctionReason,
  });
  const write = async (tx: ClientSession) => {
    const decoded = verifyAccessToken(token);
    if (decoded.userId !== identity?.userId || decoded.role !== 'teacher')
      throw new RequestContractError(401, 'Authentication changed');
    const login = await Session.collection.updateMany(
      {
        token,
        userId: new Types.ObjectId(initial.scope.actorId),
        role: 'teacher',
        isRevoked: false,
      },
      { $inc: { __v: 1 } },
      { session: tx },
    );
    // Raw collection operations require a BSON ID, unlike model query casting.
    if (!login.matchedCount)
      throw new RequestContractError(401, 'Session is unavailable');
    await communicationFence(
      tx,
      Syllabus.collection.name,
      String(initial.plan.syllabusId),
    );
    await communicationFence(
      tx,
      LessonPlan.collection.name,
      String(initial.plan._id),
    );
    const ctx = await deliveryContext(identity, value);
    const plan = await LessonPlan.findById(ctx.plan._id).session(tx);
    if (
      !plan ||
      plan.state !== 'approved' ||
      plan.approvedRevision !== approvedRevision ||
      !plan.submissions.some(s => s.revision === approvedRevision)
    )
      throw new RequestContractError(
        409,
        'An approved current lesson revision is required',
      );
    if (
      new Set(topics.map(t => t.topicId)).size !== plan.topicIds.length ||
      topics.length !== plan.topicIds.length ||
      topics.some(t => !plan.topicIds.some(id => String(id) === t.topicId))
    )
      throw academicMissing();
    const now = schoolDateTime();
    if (
      actualTeachingDate > now.date ||
      actualTeachingDate < plan.teachingDate ||
      (ctx.period &&
        (actualTeachingDate !== ctx.period.date ||
          (ctx.period.date === now.date && now.time < ctx.period.startTime)))
    )
      throw new RequestContractError(
        400,
        'Delivery must be on or after the planned date and cannot precede the occurrence start or school-local today',
      );
    let row = await LessonDelivery.findOne({ lessonPlanId: plan._id }).session(
      tx,
    );
    const replay = row?.history.find(h => h.clientOperationId === op);
    if (replay) {
      if (
        replay.fingerprint !== fingerprint ||
        String(replay.recordedBy) !== ctx.scope.actorId
      )
        throw new RequestContractError(
          409,
          'Operation ID was used for different evidence',
        );
      return;
    }
    if ((row?.revision ?? 0) !== revision || (row && row.state !== 'recorded'))
      throw new RequestContractError(
        409,
        'Delivery evidence changed. Reload before correcting it.',
      );
    if (row && row.history.length >= 100)
      throw new RequestContractError(409, 'Delivery correction limit reached');
    if (!row)
      row = new LessonDelivery({
        branchId: plan.branchId,
        lessonPlanId: plan._id,
        lessonPlanRevision: approvedRevision,
        teacherId: plan.teacherId,
        classId: plan.classId,
        sectionId: plan.sectionId,
        subjectId: plan.subjectId,
        academicYear: plan.academicYear,
        syllabusId: plan.syllabusId,
        syllabusVersion: ctx.academic.syllabus.version,
        unitId: plan.unitId,
        plannedTopicIds: plan.topicIds,
        teachingDate: plan.teachingDate,
        occurrence: ctx.period
          ? {
              periodId: ctx.period.periodId,
              timetableVersionId: ctx.period.approvedVersion.versionId,
              date: ctx.period.date,
              substituteId: ctx.period.substituteId ?? undefined,
            }
          : undefined,
        history: [],
        revision: 0,
      });
    const recorder = await User.findById(ctx.scope.actorId)
      .select('fullName')
      .read('primary');
    if (!recorder) throw academicMissing();
    row.revision += 1;
    row.history.push({
      revision: row.revision,
      deliveryStatus: status,
      actualTeachingDate,
      topics,
      teacherNotes,
      correctionReason,
      recordedBy: ctx.scope.actorId,
      recordedByName: recorder.fullName,
      recordedAt: new Date(),
      clientOperationId: op,
      fingerprint,
    });
    await row.save({ session: tx });
  };
  if (initial.period)
    await mutateOccurrence(
      identity,
      initial.period.periodId,
      initial.period.date,
      PERMISSIONS.TEACHER_LESSONS_MANAGE,
      write,
    );
  else
    await withTeacherCommunication(
      identity,
      token,
      PERMISSIONS.TEACHER_LESSONS_MANAGE,
      initial.tuple,
      write,
    );
  return getDeliveryContext(identity, value);
};
