import {type SessionAuthority} from './authenticated-session.service';
import { createHash } from 'node:crypto';
import {requireClassSubject} from './class-subject-context.service';
import { LessonPlan } from '../models/lessonPlan';
import ApprovalRequest from '../models/approvalRequest';
import { getTeacherPeriod } from './teacher-timetable.service';
import TeacherAssignment from '../models/teacherAssignment';
import { schoolDateTime } from './school-date.service';
import { PERMISSIONS } from '../constants/permissions';
import {
  communicationFence,
  withTeacherCommunication,
} from './teacher-communication-access.service';
import {
  academicMissing,
  academicScope,
  revisionField,
  teacherAcademicContext,
} from './syllabus.service';
import { Syllabus } from '../models/syllabus';
import type { JwtPayload } from './jwt.service';
import {
  dateField,
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';

export const operationId = (v: unknown) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(v))
    throw new RequestContractError(400, 'Invalid operation ID');
  return v;
};
export const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fields = [
  'unitId',
  'topicIds',
  'teachingDate',
  'objectives',
  'teachingActivities',
  'resources',
  'notes',
] as const;
const details = (input: Record<string, unknown>) => {
  if (
    !Array.isArray(input.topicIds) ||
    !input.topicIds.length ||
    input.topicIds.length > 100
  )
    throw new RequestContractError(400, 'Select 1–100 syllabus topics');
  const topicIds = input.topicIds.map(v => objectIdField(v, 'topic ID')).sort();
  if (new Set(topicIds).size !== topicIds.length)
    throw new RequestContractError(400, 'Duplicate topic');
  if (
    typeof input.teachingDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.teachingDate)
  )
    throw new RequestContractError(400, 'Use a date in YYYY-MM-DD format');
  dateField(input.teachingDate, 'teaching date', true);
  return {
    unitId: objectIdField(input.unitId, 'unit ID'),
    topicIds,
    teachingDate: input.teachingDate,
    objectives: textField(input.objectives, 'objectives', 4000, 1),
    teachingActivities: textField(
      input.teachingActivities,
      'teaching activities',
      8000,
      1,
    ),
    resources: textField(input.resources ?? '', 'resources', 4000),
    notes: textField(input.notes ?? '', 'notes', 4000),
  };
};
const mapped = (
  syllabus: InstanceType<typeof Syllabus>,
  content: ReturnType<typeof details>,
) => {
  const unit = syllabus.units.find(u => String(u._id) === content.unitId);
  if (
    !unit ||
    content.topicIds.some(id => !unit.topics.some(t => String(t._id) === id))
  )
    throw academicMissing();
};
export const lessonDTO = (row: InstanceType<typeof LessonPlan>) => ({
  lessonPlanId: String(row._id),
  assignmentId: String(row.assignmentId),
  classId: String(row.classId),
  sectionId: String(row.sectionId),
  subjectId: String(row.subjectId),
  academicYear: row.academicYear,
  syllabusId: String(row.syllabusId),
  unitId: String(row.unitId),
  topicIds: row.topicIds.map(String),
  teachingDate: row.teachingDate,
  objectives: row.objectives,
  teachingActivities: row.teachingActivities,
  resources: row.resources,
  notes: row.notes,
  state: row.state,
  occurrence: row.occurrence ? { periodId: String(row.occurrence.periodId), timetableVersionId: String(row.occurrence.timetableVersionId), date: row.occurrence.date } : null,
  approvalRequestId: row.approvalRequestId?.toString() ?? null,
  approvedRevision: row.approvedRevision ?? null,
  submissions: row.submissions.map(s => ({ revision: s.revision, content: s.content, submittedAt: s.submittedAt.toISOString() })),
  reviews: row.reviews.map(r => ({ submittedRevision: r.submittedRevision, action: r.action, note: r.note, reviewedAt: r.reviewedAt.toISOString() })),
  revision: row.revision,
  submittedAt: row.submittedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});
export const listLessons = async (
  identity: JwtPayload | undefined,
  context: unknown,
) => {
  const { scope, tuple } = await teacherAcademicContext(identity, context);
  const rows = await LessonPlan.find({
    branchId: scope.branchId,
    teacherId: scope.actorId,
    classId: tuple.classId,
    sectionId: tuple.sectionId,
    subjectId: tuple.subjectId,
  })
    .read('primary')
    .sort({ updatedAt: -1 })
    .limit(100);
  return rows.map(lessonDTO);
};
export const writeLesson = async (
  identity: JwtPayload | undefined,
  token: SessionAuthority,
  action: 'create' | 'update' | 'submit' | 'revise',
  id: unknown,
  body: unknown,
) => {
  const input = objectBody(
    body,
    action === 'create'
      ? [
          'classId',
          'sectionId',
          'subjectId',
          'syllabusId',
          'clientOperationId',
          'occurrence',
          ...fields,
        ]
      : action === 'update'
      ? ['revision', 'clientOperationId', ...fields]
      : ['revision', 'clientOperationId'],
  );
  const op = operationId(input.clientOperationId);
  const scope = await academicScope(identity);
  const existing =
    action === 'create'
      ? null
      : await LessonPlan.findOne({
          _id: objectIdField(id, 'lesson ID'),
          teacherId: scope.actorId,
          branchId: scope.branchId,
        }).read('primary');
  if (action !== 'create' && !existing) throw academicMissing();
  const ctx = await teacherAcademicContext(
    identity,
    existing
      ? {
          classId: String(existing.classId),
          sectionId: String(existing.sectionId),
          subjectId: String(existing.subjectId),
        }
      : {
          classId: input.classId,
          sectionId: input.sectionId,
          subjectId: input.subjectId,
        },
  );
  const content = action === 'submit' || action === 'revise' ? null : details(input);
  const occurrenceInput = action === 'create' && input.occurrence != null
    ? objectBody(input.occurrence, ['periodId', 'timetableVersionId', 'date']) : null;
  const occurrence = occurrenceInput ? {
    periodId: objectIdField(occurrenceInput.periodId, 'period ID'),
    timetableVersionId: objectIdField(occurrenceInput.timetableVersionId, 'timetable version ID'),
    date: typeof occurrenceInput.date === 'string' ? occurrenceInput.date : '',
  } : null;
  if (existing && String(existing.assignmentId) !== ctx.tuple.assignmentId) {
    throw academicMissing();
  }
  const expected = action === 'create' ? null : revisionField(input.revision);
  const syllabusId = existing
    ? String(existing.syllabusId)
    : objectIdField(input.syllabusId, 'syllabus ID');
  const fingerprint = hash({
    action,
    classId: ctx.tuple.classId,
    sectionId: ctx.tuple.sectionId,
    subjectId: ctx.tuple.subjectId,
    syllabusId,
    content,
    expected,
    occurrence,
  });
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.TEACHER_LESSONS_MANAGE,
    ctx.tuple,
    async session => {
      await requireClassSubject(scope.branchId, ctx.tuple.classId, ctx.tuple.subjectId, session);
      // Publication shares the Branch fence, so retirement cannot race a lesson write.
      await communicationFence(session, Syllabus.collection.name, syllabusId);
      const current = await teacherAcademicContext(identity, {
        classId: ctx.tuple.classId,
        sectionId: ctx.tuple.sectionId,
        subjectId: ctx.tuple.subjectId,
      });
      const row =
        action === 'create'
          ? await LessonPlan.findOne({
              teacherId: scope.actorId,
              createOperationId: op,
            }).session(session)
          : await LessonPlan.findOne({
              _id: existing!._id,
              teacherId: scope.actorId,
              branchId: scope.branchId,
            }).session(session);
      if (action === 'create' && row) {
        if (row.createFingerprint !== fingerprint)
          throw new RequestContractError(
            409,
            'Operation ID was used for different content',
          );
        return lessonDTO(row);
      }
      if (row && action !== 'create') {
        const applied = row.operations.find(o => o.id === op);
        if (applied) {
          if (applied.fingerprint !== fingerprint)
            throw new RequestContractError(
              409,
              'Operation ID was used for different content',
            );
          return lessonDTO(row);
        }
        const legacySubmission = action === 'submit' && row.state === 'submitted' && !row.approvalRequestId;
        if (row.revision !== expected || (action === 'revise' ? row.state !== 'needs_revision' : row.state !== 'draft' && !legacySubmission))
          throw new RequestContractError(
            409,
            'Lesson changed or was submitted. Reload before editing.',
          );
        if (row.operations.length >= 500)
          throw new RequestContractError(409, 'Draft revision limit reached');
      }
      if (!current.syllabus || String(current.syllabus._id) !== syllabusId)
        throw academicMissing();
      const effective = await TeacherAssignment.findById(
        ctx.tuple.assignmentId,
      ).session(session);
      const selected = content ?? (row ? details(lessonDTO(row)) : null);
      if (!selected) throw academicMissing();
      // Free date planning, with current AND date-effective assignment authority.
      if (
        !effective ||
        selected.teachingDate < schoolDateTime(effective.validFrom).date ||
        (effective.validUntil &&
          selected.teachingDate >
            schoolDateTime(new Date(effective.validUntil.getTime() - 1)).date)
      )
        throw new RequestContractError(
          400,
          'Teaching date is outside the assignment validity',
        );
      mapped(current.syllabus, selected);
      const linked = row?.occurrence ?? occurrence;
      if (linked) {
        const period = await getTeacherPeriod(identity, String(linked.periodId), linked.date);
        if (period.approvedVersion.versionId !== String(linked.timetableVersionId) ||
          period.classId !== ctx.tuple.classId || period.sectionId !== ctx.tuple.sectionId ||
          period.subjectId !== ctx.tuple.subjectId || period.date !== selected.teachingDate)
          throw academicMissing();
      }
      if (action === 'create') {
        const created = new LessonPlan({
          branchId: scope.branchId,
          teacherId: scope.actorId,
          assignmentId: ctx.tuple.assignmentId,
          classId: ctx.tuple.classId,
          sectionId: ctx.tuple.sectionId,
          subjectId: ctx.tuple.subjectId,
          academicYear: current.academicYear,
          syllabusId,
          occurrence: occurrence ?? undefined,
          ...selected,
          createOperationId: op,
          createFingerprint: fingerprint,
          createdBy: scope.actorId,
          updatedBy: scope.actorId,
        });
        await created.save({ session });
        return lessonDTO(created);
      }
      if (!row) throw academicMissing();
      if (action === 'update') row.set(selected);
      const legacySubmission = action === 'submit' && row.state === 'submitted' && !row.approvalRequestId;
      if (!legacySubmission) row.revision += 1;
      row.updatedBy = row.teacherId;
      if (action === 'revise') row.state = 'draft';
      if (action === 'submit') {
        row.state = 'submitted';
        if (!legacySubmission) {
          row.submittedAt = new Date();
          row.submissions.push({
          revision: row.revision,
          content: { ...selected, classId: String(row.classId), sectionId: String(row.sectionId),
            subjectId: String(row.subjectId), academicYear: row.academicYear, syllabusId: String(row.syllabusId),
            occurrence: row.occurrence ? { periodId: String(row.occurrence.periodId), timetableVersionId: String(row.occurrence.timetableVersionId), date: row.occurrence.date } : null, revision: row.revision, state: 'submitted' },
          submittedAt: row.submittedAt,
          submittedBy: row.teacherId,
          });
        }
        const approval = new ApprovalRequest({ branchId: row.branchId, requesterId: row.teacherId,
          entityType: 'lesson_plan', entityId: row._id, lessonPlanRevision: row.revision,
          approvalType: 'lesson_plan', reason: 'Review submitted lesson plan', status: 'pending', history: [] });
        await approval.save({ session });
        row.approvalRequestId = approval._id;
      }
      row.operations.push({ id: op, fingerprint, revision: row.revision });
      await row.save({ session });
      return lessonDTO(row);
    },
  );
};
