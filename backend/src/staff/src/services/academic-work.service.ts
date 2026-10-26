import {requireClassSubject} from './class-subject-context.service';
import {enrollmentMembership} from './enrollment-membership.service';
import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { Homework } from '../models/homework';
import { Quiz } from '../models/quiz';
import { AcademicWorkAudience } from '../models/academicWorkAudience';
import { LessonPlan } from '../models/lessonPlan';
import { LessonDelivery } from '../models/lessonDelivery';
import { Syllabus } from '../models/syllabus';
import Student from '../models/student';
import User from '../models/user';
import Session from '../models/session';
import { PERMISSIONS } from '../constants/permissions';
import { planAcademicContext } from './academic-plan-context.service';
import { getTeacherPeriod, mutateOccurrence } from './teacher-timetable.service';
import { getTeacherScope, currentAcademicActor, requireActiveAcademicBranch } from './teacher-scope.service';
import { teacherAcademicContext, academicMissing } from './syllabus.service';
import {
  communicationFence,
  communicationPermission,
  withTeacherCommunication,
  type Identity,
} from './teacher-communication-access.service';
import { schoolToday, scheduleDate } from './school-date.service';
import { verifyAccessToken } from './jwt.service';
import type { JwtPayload } from './jwt.service';
import {
  enumField,
  objectBody,
  objectIdField,
  textField,
  RequestContractError,
} from '../utils/request-validation';

type WorkType = 'homework' | 'quiz';
type Plan = InstanceType<typeof LessonPlan>;
const missing = () => new RequestContractError(404, 'Academic work is unavailable or outside your current scope');
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operationId = (value: unknown) => {
  const id = textField(value, 'client operation ID', 80, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new RequestContractError(400, 'Invalid client operation ID');
  return id;
};
const revision = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RequestContractError(400, 'A positive revision is required');
  return value;
};
const localId = (value: unknown, field: string) => {
  const id = textField(value, field, 40, 1);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new RequestContractError(400, `Invalid ${field}`);
  return id;
};
const topicIds = (value: unknown) => {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new RequestContractError(400, 'Select at least one syllabus topic');
  const ids = value.map(v => objectIdField(v, 'topic ID')).sort();
  if (new Set(ids).size !== ids.length) throw new RequestContractError(400, 'Duplicate topic ID');
  return ids;
};
const positiveInteger = (value: unknown, field: string, max: number, optional = false) => {
  if (optional && (value === undefined || value === null)) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max)
    throw new RequestContractError(400, `Invalid ${field}`);
  return value;
};

const homeworkContent = (input: Record<string, unknown>) => ({
  topicIds: topicIds(input.topicIds),
  title: textField(input.title, 'homework title', 200, 1),
  instructions: textField(input.instructions, 'homework instructions', 8000, 1),
  dueAt: scheduleDate(input.dueAt),
});

const questions = (value: unknown) => {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new RequestContractError(400, 'Provide 1–100 quiz questions');
  const questionIds = new Set<string>();
  return value.map(raw => {
    const input = objectBody(raw, [
      'questionId', 'type', 'text', 'options', 'correctOptionIds', 'correctBoolean', 'expectedAnswer',
    ]);
    const questionId = localId(input.questionId, 'question ID');
    if (questionIds.has(questionId)) throw new RequestContractError(400, 'Duplicate question ID');
    questionIds.add(questionId);
    const type = enumField(input.type, 'question type', ['multiple_choice', 'true_false', 'short_answer'] as const);
    const text = textField(input.text, 'question text', 4000, 1);
    if (type === 'multiple_choice') {
      if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 10)
        throw new RequestContractError(400, 'Multiple-choice questions require 2–10 options');
      const optionIds = new Set<string>();
      const options = input.options.map(rawOption => {
        const optionInput = objectBody(rawOption, ['optionId', 'text']);
        const optionId = localId(optionInput.optionId, 'option ID');
        if (optionIds.has(optionId)) throw new RequestContractError(400, 'Duplicate option ID');
        optionIds.add(optionId);
        return { optionId, text: textField(optionInput.text, 'option text', 1000, 1) };
      });
      if (!Array.isArray(input.correctOptionIds) || !input.correctOptionIds.length)
        throw new RequestContractError(400, 'Select a correct option');
      const correctOptionIds = input.correctOptionIds.map(v => localId(v, 'correct option ID')).sort();
      if (new Set(correctOptionIds).size !== correctOptionIds.length || correctOptionIds.some(id => !optionIds.has(id)))
        throw new RequestContractError(400, 'Correct answer references an invalid option');
      if (input.correctBoolean !== undefined || input.expectedAnswer !== undefined)
        throw new RequestContractError(400, 'Unsupported answer fields for multiple choice');
      return { questionId, type, text, options, correctOptionIds };
    }
    if (type === 'true_false') {
      if (typeof input.correctBoolean !== 'boolean') throw new RequestContractError(400, 'True/false answer must be boolean');
      if (input.options !== undefined || input.correctOptionIds !== undefined || input.expectedAnswer !== undefined)
        throw new RequestContractError(400, 'Unsupported answer fields for true/false');
      return { questionId, type, text, options: [], correctOptionIds: [], correctBoolean: input.correctBoolean };
    }
    if (input.options !== undefined || input.correctOptionIds !== undefined || input.correctBoolean !== undefined)
      throw new RequestContractError(400, 'Unsupported answer fields for short answer');
    return {
      questionId,
      type,
      text,
      options: [],
      correctOptionIds: [],
      expectedAnswer: input.expectedAnswer === undefined ? '' : textField(input.expectedAnswer, 'expected answer', 4000),
    };
  });
};

const quizContent = (input: Record<string, unknown>) => {
  const availableFrom = scheduleDate(input.availableFrom);
  const availableUntil = scheduleDate(input.availableUntil);
  if (availableUntil < availableFrom) throw new RequestContractError(400, 'Quiz availability window is inverted');
  return {
    topicIds: topicIds(input.topicIds),
    title: textField(input.title, 'quiz title', 200, 1),
    instructions: textField(input.instructions, 'quiz instructions', 8000, 1),
    questions: questions(input.questions),
    availableFrom,
    availableUntil,
    attemptLimit: positiveInteger(input.attemptLimit, 'attempt limit', 10)!,
    timeLimitMinutes: positiveInteger(input.timeLimitMinutes, 'time limit', 240, true),
    shuffleQuestions: input.shuffleQuestions === undefined ? false : input.shuffleQuestions,
  };
};

const assertQuizBoolean = (content: ReturnType<typeof quizContent>) => {
  if (typeof content.shuffleQuestions !== 'boolean') throw new RequestContractError(400, 'Shuffle setting must be boolean');
  return content;
};

const planAuthority = async (identity: Identity, lessonPlanId: unknown) => {
  communicationPermission(PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE);
  const scope = await getTeacherScope(identity);
  const plan = await LessonPlan.findOne({
    _id: objectIdField(lessonPlanId, 'lesson plan ID'),
    branchId: scope.branchId,
  }).read('primary');
  if (!plan) throw missing();
  let period: Awaited<ReturnType<typeof getTeacherPeriod>> | undefined;
  let tuple: Awaited<ReturnType<typeof teacherAcademicContext>>['tuple'] | undefined;
  if (plan.occurrence) {
    period = await getTeacherPeriod(identity, String(plan.occurrence.periodId), plan.occurrence.date);
    if (
      period.approvedVersion.versionId !== String(plan.occurrence.timetableVersionId) ||
      period.classId !== String(plan.classId) || period.sectionId !== String(plan.sectionId) ||
      period.subjectId !== String(plan.subjectId)
    ) throw missing();
  } else {
    if (String(plan.teacherId) !== scope.actorId) throw missing();
    const context = await teacherAcademicContext(identity, {
      classId: String(plan.classId), sectionId: String(plan.sectionId), subjectId: String(plan.subjectId),
    });
    if (context.tuple.assignmentId !== String(plan.assignmentId)) throw missing();
    tuple = context.tuple;
  }
  const academic = await planAcademicContext(plan);
  return { scope, plan, period, tuple, academic };
};

const validateTopics = (plan: Plan, ids: string[]) => {
  if (ids.some(id => !plan.topicIds.some(topicId => String(topicId) === id))) throw academicMissing();
};

export const resolveAcademicWorkRecipients = async (
  branchId: string,
  context: { classId: string; sectionId: string },
  session?: ClientSession,
) => Student.aggregate<{
  studentId: mongoose.Types.ObjectId;
  recipientUserId: mongoose.Types.ObjectId;
  admissionNumber: string;
  studentName: string;
}>([
  ...enrollmentMembership(branchId, context.classId, context.sectionId),
  { $project: { _id: 1, userId: 1, admissionNumber: 1 } },
  { $lookup: {
    from: User.collection.name, localField: 'userId', foreignField: '_id',
    pipeline: [
      { $match: { branchId: new mongoose.Types.ObjectId(branchId), role: 'student', isActive: true } },
      { $project: { _id: 1, fullName: 1 } },
    ], as: 'identity',
  } },
  { $unwind: '$identity' },
  { $sort: { admissionNumber: 1, _id: 1 } },
  { $project: {
    _id: 0, studentId: '$_id', recipientUserId: '$userId', admissionNumber: 1, studentName: '$identity.fullName',
  } },
]).session(session ?? null).read('primary');

const lockRecipients = async (session: ClientSession, branchId: string, context: { classId: string; sectionId: string }) => {
  const candidates = await Student.find().where('branchId').equals(branchId)
    .where('classId').equals(context.classId).where('sectionId').equals(context.sectionId)
    .select('_id userId').read('primary').session(session).lean();
  for (const [collection, ids] of [
    [Student.collection.name, candidates.map(v => v._id)],
    [User.collection.name, candidates.map(v => v.userId)],
  ] as const) if (ids.length) await mongoose.connection.collection(collection).bulkWrite(
    ids.map(_id => ({ updateOne: { filter: { _id }, update: { $inc: { __v: 1 } } } })), { session },
  );
  const current = await resolveAcademicWorkRecipients(branchId, context, session);
  const locked = new Map(candidates.map(v => [String(v._id), String(v.userId)]));
  if (current.some(v => locked.get(String(v.studentId)) !== String(v.recipientUserId)))
    throw new RequestContractError(409, 'Audience changed; preview and retry');
  return current;
};

const lessonSummary = (ctx: Awaited<ReturnType<typeof planAuthority>>) => ({
  lessonPlanId: String(ctx.plan._id),
  lessonState: ctx.plan.state,
  lessonPlanRevision: ctx.plan.approvedRevision ?? ctx.plan.revision,
  classId: String(ctx.plan.classId),
  sectionId: String(ctx.plan.sectionId),
  subjectId: String(ctx.plan.subjectId),
  className: ctx.academic.className,
  sectionName: ctx.academic.sectionName,
  teacherName: ctx.academic.teacherName,
  academicYear: ctx.plan.academicYear,
  syllabus: ctx.academic.syllabusDTO,
  unitId: String(ctx.plan.unitId),
  topicIds: ctx.plan.topicIds.map(String),
  occurrence: ctx.plan.occurrence ? {
    periodId: String(ctx.plan.occurrence.periodId), date: ctx.plan.occurrence.date,
    isSubstitute: !!ctx.period?.isSubstitute,
  } : null,
});

const homeworkDTO = (row: InstanceType<typeof Homework>) => ({
  homeworkId: String(row._id), type: 'homework' as const, status: row.status, revision: row.revision,
  publishedRevision: row.publishedRevision ?? null, teacherId: String(row.teacherId),
  classId: String(row.classId), sectionId: String(row.sectionId), subjectId: String(row.subjectId),
  academicYear: row.academicYear, syllabusId: String(row.syllabusId), syllabusVersion: row.syllabusVersion,
  lessonPlanId: String(row.lessonPlanId), lessonPlanRevision: row.lessonPlanRevision,
  lessonDeliveryId: row.lessonDeliveryId ? String(row.lessonDeliveryId) : null,
  topicIds: row.topicIds.map(String), title: row.title, instructions: row.instructions, dueAt: row.dueAt,
  latePolicy: row.latePolicy, recipientCount: row.recipientCount,
  publishedAt: row.publishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const teacherQuizDTO = (row: InstanceType<typeof Quiz>) => ({
  quizId: String(row._id), type: 'quiz' as const, status: row.status, revision: row.revision,
  publishedRevision: row.publishedRevision ?? null, teacherId: String(row.teacherId),
  classId: String(row.classId), sectionId: String(row.sectionId), subjectId: String(row.subjectId),
  academicYear: row.academicYear, syllabusId: String(row.syllabusId), syllabusVersion: row.syllabusVersion,
  lessonPlanId: String(row.lessonPlanId), lessonPlanRevision: row.lessonPlanRevision,
  lessonDeliveryId: row.lessonDeliveryId ? String(row.lessonDeliveryId) : null,
  topicIds: row.topicIds.map(String), title: row.title, instructions: row.instructions,
  questions: row.questions.map(q => ({
    questionId: q.questionId, type: q.type, text: q.text,
    options: q.options.map(o => ({ optionId: o.optionId, text: o.text })),
    correctOptionIds: [...q.correctOptionIds], correctBoolean: q.correctBoolean,
    expectedAnswer: q.expectedAnswer ?? '',
  })),
  availableFrom: row.availableFrom, availableUntil: row.availableUntil,
  attemptLimit: row.attemptLimit, timeLimitMinutes: row.timeLimitMinutes ?? null,
  shuffleQuestions: row.shuffleQuestions, recipientCount: row.recipientCount,
  publishedAt: row.publishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const studentQuizDTO = (row: InstanceType<typeof Quiz>) => ({
  quizId: String(row._id), type: 'quiz' as const, publishedRevision: row.publishedRevision!,
  title: row.title, instructions: row.instructions, classId: String(row.classId), sectionId: String(row.sectionId),
  subjectId: String(row.subjectId), topicIds: row.topicIds.map(String), lessonPlanId: String(row.lessonPlanId),
  lessonDeliveryId: row.lessonDeliveryId ? String(row.lessonDeliveryId) : null,
  availableFrom: row.availableFrom, availableUntil: row.availableUntil, attemptLimit: row.attemptLimit,
  timeLimitMinutes: row.timeLimitMinutes ?? null, shuffleQuestions: row.shuffleQuestions,
  questions: row.questions.map(q => ({
    questionId: q.questionId, type: q.type, text: q.text,
    options: q.options.map(o => ({ optionId: o.optionId, text: o.text })),
  })),
});

const findWork = async (
  type: WorkType,
  filter: Record<string, unknown>,
  session?: ClientSession,
) => type === 'homework'
  ? Homework.findOne(filter).read('primary').session(session ?? null)
  : Quiz.findOne(filter).read('primary').session(session ?? null);

const ownerWork = async (identity: Identity, type: WorkType, id: unknown) => {
  const scope = await getTeacherScope(identity);
  communicationPermission(PERMISSIONS.TEACHER_ASSESSMENTS_VIEW);
  const row = await findWork(type, {
    _id: objectIdField(id, `${type} ID`), branchId: scope.branchId, teacherId: scope.actorId,
  });
  if (!row) throw missing();
  const authority = await planAuthority(identity, String(row.lessonPlanId));
  return { scope, row, authority };
};

const runMutation = async <T>(
  identity: Identity,
  token: string,
  authority: Awaited<ReturnType<typeof planAuthority>>,
  write: (session: ClientSession, branchId: string) => Promise<T>,
) => {
  // Recheck only new task mutations, under the shared persisted Branch fence.
  // Historical entitlement/submission/review readers keep their pinned context.
  const guardedWrite = async (session: ClientSession, branchId: string) => {
    await requireClassSubject(branchId, String(authority.plan.classId), String(authority.plan.subjectId), session);
    return write(session, branchId);
  };
  if (authority.period) return mutateOccurrence(
    identity, authority.period.periodId, authority.period.date,
    PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE,
    async (session, period, branchId) => {
      const decoded = verifyAccessToken(token);
      if (decoded.userId !== identity?.userId || decoded.role !== 'teacher') throw new RequestContractError(401, 'Authentication changed');
      const login = await Session.collection.updateMany(
        { token, userId: new mongoose.Types.ObjectId(decoded.userId), role: 'teacher', isRevoked: false },
        { $inc: { __v: 1 } }, { session },
      );
      if (!login.matchedCount) throw new RequestContractError(401, 'Session is unavailable');
      if (period.classId !== String(authority.plan.classId) || period.sectionId !== String(authority.plan.sectionId) ||
        period.subjectId !== String(authority.plan.subjectId)) throw missing();
      return guardedWrite(session, branchId);
    },
  );
  return withTeacherCommunication(
    identity, token, PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE, authority.tuple,
    session => guardedWrite(session, authority.scope.branchId),
  );
};

const fenceAcademicContext = async (session: ClientSession, authority: Awaited<ReturnType<typeof planAuthority>>) => {
  await communicationFence(session, LessonPlan.collection.name, String(authority.plan._id));
  await communicationFence(session, Syllabus.collection.name, String(authority.plan.syllabusId));
};

export const getAcademicWorkContext = async (identity: Identity, lessonPlanId: unknown) => {
  const ctx = await planAuthority(identity, lessonPlanId);
  const audience = await resolveAcademicWorkRecipients(ctx.scope.branchId, {
    classId: String(ctx.plan.classId), sectionId: String(ctx.plan.sectionId),
  });
  const [homework, quizzes] = await Promise.all([
    Homework.find({ branchId: ctx.scope.branchId, teacherId: ctx.scope.actorId, lessonPlanId: ctx.plan._id }).sort({ updatedAt: -1 }).limit(50).read('primary'),
    Quiz.find({ branchId: ctx.scope.branchId, teacherId: ctx.scope.actorId, lessonPlanId: ctx.plan._id }).sort({ updatedAt: -1 }).limit(50).read('primary'),
  ]);
  return {
    lesson: lessonSummary(ctx),
    audience: { recipientCount: audience.length, students: audience.slice(0, 50).map(v => ({
      studentId: String(v.studentId), fullName: v.studentName, admissionNumber: v.admissionNumber,
    })) },
    homework: homework.map(homeworkDTO), quizzes: quizzes.map(teacherQuizDTO),
    publicationPolicy: 'approved_lesson_required' as const,
    schedulingSupported: false,
  };
};

const createOrUpdate = async (
  identity: Identity, token: string, type: WorkType, body: unknown, id?: unknown,
) => {
  const create = id === undefined;
  const allowed = type === 'homework'
    ? ['lessonPlanId', 'topicIds', 'title', 'instructions', 'dueAt', 'clientOperationId', ...(create ? [] : ['revision'])]
    : ['lessonPlanId', 'topicIds', 'title', 'instructions', 'questions', 'availableFrom', 'availableUntil',
      'attemptLimit', 'timeLimitMinutes', 'shuffleQuestions', 'clientOperationId', ...(create ? [] : ['revision'])];
  const input = objectBody(body, allowed);
  const op = operationId(input.clientOperationId);
  const existing = create ? null : await ownerWork(identity, type, id);
  const authority = existing?.authority ?? await planAuthority(identity, input.lessonPlanId);
  if (!create && input.lessonPlanId !== undefined && String(input.lessonPlanId) !== String(authority.plan._id)) throw missing();
  const content = type === 'homework' ? homeworkContent(input) : assertQuizBoolean(quizContent(input));
  validateTopics(authority.plan, content.topicIds);
  const expected = create ? null : revision(input.revision);
  const payloadHash = fingerprint({ type, lessonPlanId: String(authority.plan._id), content, expected });
  try {
    return await runMutation(identity, token, authority, async (session, branchId) => {
      await fenceAcademicContext(session, authority);
      const current = await planAuthority(identity, String(authority.plan._id));
      if (current.scope.branchId !== branchId) throw missing();
      validateTopics(current.plan, content.topicIds);
      const replay = await findWork(type, { teacherId: current.scope.actorId, createOperationId: op }, session);
      if (create && replay) {
        if (replay.createFingerprint !== payloadHash) throw new RequestContractError(409, 'Operation ID was used for different content');
        return type === 'homework' ? homeworkDTO(replay as InstanceType<typeof Homework>) : teacherQuizDTO(replay as InstanceType<typeof Quiz>);
      }
      if (create) {
        const delivery = await LessonDelivery.findOne({ lessonPlanId: current.plan._id, state: 'recorded' }).session(session);
        const common = {
          branchId, teacherId: current.scope.actorId, assignmentId: current.tuple?.assignmentId,
          classId: current.plan.classId, sectionId: current.plan.sectionId, subjectId: current.plan.subjectId,
          academicYear: current.plan.academicYear, syllabusId: current.plan.syllabusId,
          syllabusVersion: current.academic.syllabus.version, lessonPlanId: current.plan._id,
          lessonPlanRevision: current.plan.approvedRevision ?? current.plan.revision,
          lessonDeliveryId: delivery?._id, ...content, createOperationId: op, createFingerprint: payloadHash,
        };
        if (type === 'homework') {
          const row = new Homework(common);
          await row.save({ session });
          return homeworkDTO(row);
        }
        const row = new Quiz(common);
        await row.save({ session });
        return teacherQuizDTO(row);
      }
      const old = await findWork(type, { _id: objectIdField(id, `${type} ID`), branchId, teacherId: current.scope.actorId }, session);
      if (!old) throw missing();
      const previous = old.operations.find((v: { id: string }) => v.id === op);
      if (previous) {
        if (previous.fingerprint !== payloadHash) throw new RequestContractError(409, 'Operation ID was used for different content');
        return type === 'homework' ? homeworkDTO(old as InstanceType<typeof Homework>) : teacherQuizDTO(old as InstanceType<typeof Quiz>);
      }
      if (old.status !== 'draft' || old.revision !== expected) throw new RequestContractError(409, 'Draft changed or was published');
      old.set(content);
      old.revision += 1;
      old.operations.push({ id: op, fingerprint: payloadHash, revision: old.revision });
      await old.save({ session });
      return type === 'homework' ? homeworkDTO(old as InstanceType<typeof Homework>) : teacherQuizDTO(old as InstanceType<typeof Quiz>);
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new RequestContractError(409, 'Operation is already being processed');
    throw error;
  }
};

export const saveHomework = (identity: Identity, token: string, body: unknown, id?: unknown) =>
  createOrUpdate(identity, token, 'homework', body, id);
export const saveQuiz = (identity: Identity, token: string, body: unknown, id?: unknown) =>
  createOrUpdate(identity, token, 'quiz', body, id);

export const previewAcademicWorkAudience = async (identity: Identity, type: WorkType, id: unknown) => {
  const { row, authority } = await ownerWork(identity, type, id);
  if (row.status !== 'draft') throw new RequestContractError(409, 'Only draft audience can be previewed');
  const recipients = await resolveAcademicWorkRecipients(authority.scope.branchId, {
    classId: String(row.classId), sectionId: String(row.sectionId),
  });
  return {
    workType: type, workId: String(row._id), className: authority.academic.className,
    sectionName: authority.academic.sectionName, recipientCount: recipients.length,
    students: recipients.slice(0, 50).map(v => ({ studentId: String(v.studentId), fullName: v.studentName, admissionNumber: v.admissionNumber })),
  };
};

export const publishAcademicWork = async (
  identity: Identity, token: string, type: WorkType, id: unknown, body: unknown,
) => {
  const input = objectBody(body, ['revision', 'clientOperationId']);
  const expected = revision(input.revision), op = operationId(input.clientOperationId);
  const initial = await ownerWork(identity, type, id);
  const payloadHash = fingerprint({ type, id: String(initial.row._id), revision: expected });
  try {
    return await runMutation(identity, token, initial.authority, async (session, branchId) => {
      await fenceAcademicContext(session, initial.authority);
      const fresh = await findWork(type, { _id: initial.row._id, branchId, teacherId: initial.scope.actorId }, session);
      if (!fresh) throw missing();
      if (fresh.publishOperationId === op) {
        if (fresh.publishFingerprint !== payloadHash) throw new RequestContractError(409, 'Operation ID was used for a different publication');
        return type === 'homework' ? homeworkDTO(fresh as InstanceType<typeof Homework>) : teacherQuizDTO(fresh as InstanceType<typeof Quiz>);
      }
      if (fresh.status !== 'draft' || fresh.revision !== expected) throw new RequestContractError(409, 'Draft changed or was already published');
      const current = await planAuthority(identity, String(fresh.lessonPlanId));
      if (current.scope.branchId !== branchId || current.plan.state !== 'approved' || !current.plan.approvedRevision)
        throw new RequestContractError(409, 'Publication requires an approved current lesson');
      if (String(current.plan.syllabusId) !== String(fresh.syllabusId) || current.academic.syllabus.version !== fresh.syllabusVersion)
        throw new RequestContractError(409, 'Syllabus context changed');
      validateTopics(current.plan, fresh.topicIds.map(String));
      const approved = current.plan.submissions.find(v => v.revision === current.plan.approvedRevision)?.content as { topicIds?: unknown[] } | undefined;
      if (!approved || !Array.isArray(approved.topicIds) || fresh.topicIds.some((v: unknown) => !approved.topicIds!.some(idValue => String(idValue) === String(v))))
        throw new RequestContractError(409, 'Published topics do not match the approved lesson revision');
      const today = schoolToday();
      if (type === 'homework' && (fresh as InstanceType<typeof Homework>).dueAt <= today)
        throw new RequestContractError(400, 'Homework due date must be after the school-local publication date');
      if (type === 'quiz') {
        const quiz = fresh as InstanceType<typeof Quiz>;
        if (quiz.availableUntil < quiz.availableFrom || quiz.availableUntil < today)
          throw new RequestContractError(400, 'Quiz availability must end on or after its start and publication date');
      }
      const recipients = await lockRecipients(session, branchId, {
        classId: String(fresh.classId), sectionId: String(fresh.sectionId),
      });
      if (!recipients.length) throw new RequestContractError(409, 'No current authorized recipients');
      const delivery = await LessonDelivery.findOne({
        lessonPlanId: current.plan._id, lessonPlanRevision: current.plan.approvedRevision, state: 'recorded',
      }).session(session);
      const publishedAt = new Date();
      fresh.lessonPlanRevision = current.plan.approvedRevision;
      if (delivery) fresh.lessonDeliveryId = delivery._id;
      fresh.status = 'published';
      fresh.publishedRevision = fresh.revision;
      fresh.publishedAt = publishedAt;
      fresh.recipientCount = recipients.length;
      fresh.publishOperationId = op;
      fresh.publishFingerprint = payloadHash;
      await fresh.save({ session });
      await AcademicWorkAudience.insertMany(recipients.map(recipient => ({
        branchId, workType: type, workId: fresh._id, publishedRevision: fresh.publishedRevision,
        studentId: recipient.studentId, recipientUserId: recipient.recipientUserId,
        admissionNumber: recipient.admissionNumber, studentName: recipient.studentName,
        entitledAt: publishedAt,
      })), { session });
      return type === 'homework' ? homeworkDTO(fresh as InstanceType<typeof Homework>) : teacherQuizDTO(fresh as InstanceType<typeof Quiz>);
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new RequestContractError(409, 'Publication is already being processed');
    throw error;
  }
};

const studentActor = async (identity: JwtPayload | undefined) => {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'student') throw new RequestContractError(403, 'Student academic work is not permitted');
  const branchId = await requireActiveAcademicBranch(actor.branchId?.toString());
  const student = await Student.findOne().where('userId').equals(actor._id)
    .where('branchId').equals(branchId).where('isActive').equals(true).read('primary');
  if (!student) throw missing();
  return { actor, branchId, student };
};

export const listStudentAcademicWork = async (identity: JwtPayload | undefined) => {
  const { actor, branchId } = await studentActor(identity);
  const entitlements = await AcademicWorkAudience.find({
    branchId, recipientUserId: actor._id, state: 'assigned',
  }).sort({ entitledAt: -1 }).limit(100).read('primary');
  const homeworkIds = entitlements.filter(v => v.workType === 'homework').map(v => v.workId);
  const quizIds = entitlements.filter(v => v.workType === 'quiz').map(v => v.workId);
  const today = schoolToday();
  const [homework, quizzes] = await Promise.all([
    Homework.find({ _id: { $in: homeworkIds }, branchId, status: 'published' }).read('primary'),
    Quiz.find({
      _id: { $in: quizIds }, branchId, status: 'published',
      availableFrom: { $lte: today }, availableUntil: { $gte: today },
    }).read('primary'),
  ]);
  const homeworkMap = new Map(homework.map(v => [String(v._id), {
    homeworkId: String(v._id), type: 'homework' as const, publishedRevision: v.publishedRevision!,
    title: v.title, instructions: v.instructions, classId: String(v.classId), sectionId: String(v.sectionId),
    subjectId: String(v.subjectId), topicIds: v.topicIds.map(String), lessonPlanId: String(v.lessonPlanId),
    lessonDeliveryId: v.lessonDeliveryId ? String(v.lessonDeliveryId) : null, dueAt: v.dueAt, latePolicy: v.latePolicy,
  }]));
  const quizMap = new Map(quizzes.map(v => [String(v._id), studentQuizDTO(v)]));
  return entitlements.flatMap(entitlement => {
    const dto = entitlement.workType === 'homework' ? homeworkMap.get(String(entitlement.workId)) : quizMap.get(String(entitlement.workId));
    return dto ? [{ ...dto, audienceId: String(entitlement._id) }] : [];
  });
};

export const getStudentAcademicWork = async (
  identity: JwtPayload | undefined, typeValue: unknown, id: unknown,
) => {
  const type = enumField(typeValue, 'work type', ['homework', 'quiz'] as const);
  const { actor, branchId } = await studentActor(identity);
  const workId = objectIdField(id, `${type} ID`);
  const entitlement = await AcademicWorkAudience.findOne({
    branchId, recipientUserId: actor._id, workType: type, workId, state: 'assigned',
  }).read('primary');
  if (!entitlement) throw missing();
  if (type === 'homework') {
    const row = await Homework.findOne({ _id: workId, branchId, status: 'published' }).read('primary');
    if (!row || row.publishedRevision !== entitlement.publishedRevision) throw missing();
    return (await listStudentAcademicWork(identity)).find(v => v.type === 'homework' && v.homeworkId === workId) ?? (() => { throw missing(); })();
  }
  const today = schoolToday();
  const row = await Quiz.findOne({
    _id: workId, branchId, status: 'published',
    availableFrom: { $lte: today }, availableUntil: { $gte: today },
  }).read('primary');
  if (!row || row.publishedRevision !== entitlement.publishedRevision) throw missing();
  return { ...studentQuizDTO(row), audienceId: String(entitlement._id) };
};

export const ensureAcademicWorkIndexes = () => Promise.all([
  Homework.createIndexes(), Quiz.createIndexes(), AcademicWorkAudience.createIndexes(),
]);
