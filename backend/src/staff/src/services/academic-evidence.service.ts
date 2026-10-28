import {type SessionAuthority, sessionIdentity, revalidateAuthenticatedSession, authenticatedTransaction} from './authenticated-session.service';
import {createHash} from 'node:crypto';
import mongoose, {type ClientSession} from 'mongoose';
import Branch from '../models/branch';
import User from '../models/user';
import Student from '../models/student';

import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import {Homework} from '../models/homework';
import {Quiz} from '../models/quiz';
import {AcademicWorkAudience} from '../models/academicWorkAudience';
import {HomeworkSubmission} from '../models/homeworkSubmission';
import {QuizAttempt} from '../models/quizAttempt';
import {AcademicRubric} from '../models/academicRubric';
import {TeacherReview} from '../models/teacherReview';
import {LessonPlan} from '../models/lessonPlan';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {getTeacherScope} from './teacher-scope.service';
import {getTeacherPeriod, mutateOccurrence} from './teacher-timetable.service';
import {withTeacherCommunication, type Identity} from './teacher-communication-access.service';
import {schoolToday} from './school-date.service';
import {type JwtPayload} from './jwt.service';
import {enumField, objectBody, objectIdField, textField, RequestContractError} from '../utils/request-validation';

type WorkType = 'homework' | 'quiz';
type TargetType = 'homework_submission' | 'quiz_attempt';
const unavailable = () => new RequestContractError(404, 'Evidence is unavailable or outside your scope');
const conflict = (message: string) => new RequestContractError(409, message);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operationId = (value: unknown) => {
  const result = textField(value, 'client operation ID', 80, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new RequestContractError(400, 'Invalid client operation ID');
  return result;
};
const revision = (value: unknown, allowZero = false) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new RequestContractError(400, 'Invalid revision');
  return value;
};
const numberField = (value: unknown, field: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RequestContractError(400, `Invalid ${field}`);
  return value;
};
const modelFor = (type: WorkType): any => type === 'homework' ? Homework : Quiz;

const fence = async (session: ClientSession, collection: string, id: unknown) => {
  const result = await mongoose.connection.collection(collection).updateOne(
    {_id: new mongoose.Types.ObjectId(String(id))}, {$inc: {__v: 1}}, {session},
  );
  if (!result.matchedCount) throw unavailable();
};

const studentContext = async (identity: JwtPayload | undefined, type: WorkType, requestedId: unknown, session?: ClientSession) => {
  if (!identity || identity.role !== 'student') throw new RequestContractError(403, 'Student evidence is not permitted');
  const actor: any = await User.findOne({_id: identity.userId, role: 'student', isActive: true}).read('primary').session(session ?? null);
  if (!actor?.branchId || !(await Branch.exists({_id: actor.branchId, isActive: true}).session(session ?? null))) throw unavailable();
  const student: any = await Student.findOne({userId: actor._id, branchId: actor.branchId, isActive: true}).read('primary').session(session ?? null);
  if (!student) throw unavailable();
  const workId = objectIdField(requestedId, `${type} ID`);
  const entitlement: any = await AcademicWorkAudience.findOne({
    branchId: actor.branchId, workType: type, workId, studentId: student._id,
    recipientUserId: actor._id, state: 'assigned',
  }).read('primary').session(session ?? null);
  if (!entitlement) throw unavailable();
  const Work = modelFor(type);
  const work: any = await Work.findOne({_id: workId, branchId: actor.branchId, status: 'published', publishedRevision: entitlement.publishedRevision})
    .read('primary').session(session ?? null);
  if (!work) throw unavailable();
  return {actor, student, entitlement, work};
};

const studentMutation = async <T>(
  identity: JwtPayload | undefined, token: SessionAuthority, type: WorkType, id: unknown,
  write: (session: ClientSession, context: Awaited<ReturnType<typeof studentContext>>) => Promise<T>,
) => {
  const initial = await studentContext(identity, type, id);
  const session = await mongoose.startSession();
  try {
    return (await authenticatedTransaction(session, async () => {
      const decoded = sessionIdentity(token);
      if (decoded.userId !== identity?.userId || decoded.role !== 'student') throw new RequestContractError(401, 'Authentication changed');
      await revalidateAuthenticatedSession(token, {userId: String(initial.actor._id), role: 'student'}, session);
      await fence(session, User.collection.name, initial.actor._id);
      await fence(session, Branch.collection.name, initial.actor.branchId);
      await fence(session, Student.collection.name, initial.student._id);
      await fence(session, AcademicWorkAudience.collection.name, initial.entitlement._id);
      await fence(session, modelFor(type).collection.name, initial.work._id);
      return write(session, await studentContext(identity, type, id, session));
    }, {readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}}))!;
  } finally { await session.endSession(); }
};

const releasedReview = async (targetType: TargetType, evidenceId: unknown) => {
  const row: any = await (TeacherReview as any).findOne({targetType, evidenceId, state: 'feedback_released'}).read('primary');
  return row ? {
    reviewRevision: row.revision, feedback: row.feedback ?? '', totalScore: row.totalScore ?? null,
    maxScore: row.maxScore ?? null, criterionScores: row.scores.map((v: any) => ({criterionId: v.criterionId, score: v.score})),
    releasedAt: row.releasedAt?.toISOString() ?? null,
  } : null;
};

const homeworkStudentDTO = async (row: InstanceType<typeof HomeworkSubmission>) => ({
  submissionId: String(row._id), homeworkId: String(row.homeworkId), publishedRevision: row.publishedRevision,
  audienceEntitlementId: String(row.audienceEntitlementId), submissionRevision: row.submissionRevision, status: row.status,
  latest: row.revisions.length ? {
    revision: row.revisions.at(-1)!.revision, content: row.revisions.at(-1)!.content,
    submittedAt: row.revisions.at(-1)!.submittedAt.toISOString(), timing: row.revisions.at(-1)!.timing,
  } : null,
  resubmitAllowed: row.resubmitAllowed, returnedReason: row.returnedReason ?? null,
  releasedReview: await releasedReview('homework_submission', row._id),
});

export const submitHomeworkEvidence = async (identity: JwtPayload | undefined, token: SessionAuthority, homeworkId: unknown, body: unknown) => {
  const input = objectBody(body, ['content', 'clientOperationId']);
  const content = textField(input.content, 'submission content', 12000, 1), op = operationId(input.clientOperationId);
  const payloadHash = hash({homeworkId: String(homeworkId), content});
  try {
    return await studentMutation(identity, token, 'homework', homeworkId, async (session, context) => {
      const work = context.work as InstanceType<typeof Homework>;
      const existing = await HomeworkSubmission.findOne({audienceEntitlementId: context.entitlement._id}).session(session);
      const replay = existing?.revisions.find(v => v.operationId === op);
      if (replay) {
        if (replay.fingerprint !== payloadHash) throw conflict('Operation ID was used for different submission content');
        return homeworkStudentDTO(existing!);
      }
      const today = schoolToday();
      if (today > work.dueAt) throw conflict('Homework submission is closed after the school-local due date');
      const submittedAt = new Date(), timing = today > work.dueAt ? 'late' : 'on_time';
      if (!existing) {
        const created: any = new HomeworkSubmission({
          branchId: work.branchId, homeworkId: work._id, publishedRevision: work.publishedRevision,
          audienceEntitlementId: context.entitlement._id, studentId: context.student._id, recipientUserId: context.actor._id,
          classId: work.classId, sectionId: work.sectionId, subjectId: work.subjectId, syllabusId: work.syllabusId,
          syllabusVersion: work.syllabusVersion, lessonPlanId: work.lessonPlanId, lessonPlanRevision: work.lessonPlanRevision,
          lessonDeliveryId: work.lessonDeliveryId, topicIds: work.topicIds, submissionRevision: 1, status: 'submitted',
          revisions: [{revision: 1, content, submittedAt, timing, operationId: op, fingerprint: payloadHash}],
        });
        await created.save({session});
        return homeworkStudentDTO(created);
      }
      if (existing.status !== 'returned_for_resubmission' || !existing.resubmitAllowed)
        throw conflict('Resubmission requires explicit Teacher permission');
      existing.submissionRevision += 1;
      existing.revisions.push({revision: existing.submissionRevision, content, submittedAt, timing, operationId: op, fingerprint: payloadHash});
      existing.status = 'resubmitted'; existing.resubmitAllowed = false; existing.returnedReason = undefined;
      await existing.save({session});
      return homeworkStudentDTO(existing);
    });
  } catch (error) {
    if ((error as {code?: number}).code === 11000) {
      const ctx = await studentContext(identity, 'homework', homeworkId);
      const row = await HomeworkSubmission.findOne({audienceEntitlementId: ctx.entitlement._id}).read('primary');
      const replay = row?.revisions.find(v => v.operationId === op);
      if (row && replay?.fingerprint === payloadHash) return homeworkStudentDTO(row);
      throw conflict('Submission is already being processed');
    }
    throw error;
  }
};

export const getStudentHomeworkEvidence = async (identity: JwtPayload | undefined, homeworkId: unknown) => {
  const context = await studentContext(identity, 'homework', homeworkId);
  const row = await HomeworkSubmission.findOne({audienceEntitlementId: context.entitlement._id}).read('primary');
  if (!row) return {state: schoolToday() > (context.work as InstanceType<typeof Homework>).dueAt ? 'missing' : 'not_submitted'};
  return homeworkStudentDTO(row);
};

const safeQuestions = (quiz: InstanceType<typeof Quiz>) => quiz.questions.map(q => ({
  questionId: q.questionId, type: q.type, text: q.text, options: q.options.map(o => ({optionId: o.optionId, text: o.text})),
}));
const attemptStudentDTO = async (row: InstanceType<typeof QuizAttempt>) => ({
  attemptId: String(row._id), quizId: String(row.quizId), publishedRevision: row.publishedRevision,
  audienceEntitlementId: String(row.audienceEntitlementId), attemptNumber: row.attemptNumber, status: row.status,
  revision: row.revision, startedAt: row.startedAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null,
  submittedAt: row.submittedAt?.toISOString() ?? null, questions: row.questions.map(q => ({
    questionId: q.questionId, type: q.type, text: q.text, options: q.options.map(o => ({optionId: o.optionId, text: o.text})),
  })), answers: row.answers.map(a => ({questionId: a.questionId, optionIds: [...a.optionIds], booleanAnswer: a.booleanAnswer, textAnswer: a.textAnswer ?? ''})),
  releasedReview: await releasedReview('quiz_attempt', row._id),
});

export const startQuizAttempt = async (identity: JwtPayload | undefined, token: SessionAuthority, quizId: unknown, body: unknown) => {
  const input = objectBody(body, ['clientOperationId']), op = operationId(input.clientOperationId);
  const payloadHash = hash({quizId: String(quizId), action: 'start'});
  try {
    return await studentMutation(identity, token, 'quiz', quizId, async (session, context) => {
      const quiz = context.work as InstanceType<typeof Quiz>, now = new Date(), today = schoolToday();
      if (today < quiz.availableFrom || today > quiz.availableUntil) throw conflict('Quiz is outside its school-local release window');
      const replay = await QuizAttempt.findOne({recipientUserId: context.actor._id, startOperationId: op}).session(session);
      if (replay) {
        if (replay.startFingerprint !== payloadHash || String(replay.quizId) !== String(quiz._id)) throw conflict('Operation ID was used for a different attempt');
        return attemptStudentDTO(replay);
      }
      const active = await QuizAttempt.findOne({quizId: quiz._id, publishedRevision: quiz.publishedRevision, studentId: context.student._id, status: 'active'}).session(session);
      if (active && (!active.expiresAt || active.expiresAt >= now)) return attemptStudentDTO(active);
      const used = await QuizAttempt.countDocuments({quizId: quiz._id, publishedRevision: quiz.publishedRevision, studentId: context.student._id}).session(session);
      if (used >= quiz.attemptLimit) throw conflict('Quiz attempt limit reached');
      const questions = safeQuestions(quiz), startedAt = now;
      const expiresAt = quiz.timeLimitMinutes ? new Date(startedAt.getTime() + quiz.timeLimitMinutes * 60000) : undefined;
      const attempt: any = new QuizAttempt({
        branchId: quiz.branchId, quizId: quiz._id, publishedRevision: quiz.publishedRevision,
        audienceEntitlementId: context.entitlement._id, studentId: context.student._id, recipientUserId: context.actor._id,
        classId: quiz.classId, sectionId: quiz.sectionId, subjectId: quiz.subjectId, syllabusId: quiz.syllabusId,
        syllabusVersion: quiz.syllabusVersion, lessonPlanId: quiz.lessonPlanId, lessonPlanRevision: quiz.lessonPlanRevision,
        lessonDeliveryId: quiz.lessonDeliveryId, topicIds: quiz.topicIds, attemptNumber: used + 1,
        questionSnapshotHash: hash({publishedRevision: quiz.publishedRevision, questions}), questions, startedAt, expiresAt,
        startOperationId: op, startFingerprint: payloadHash,
      });
      await attempt.save({session});
      return attemptStudentDTO(attempt);
    });
  } catch (error) {
    if ((error as {code?: number}).code === 11000) {
      const row = await QuizAttempt.findOne({recipientUserId: identity?.userId, startOperationId: op}).read('primary');
      if (row?.startFingerprint === payloadHash) return attemptStudentDTO(row);
      throw conflict('Attempt start is already being processed');
    }
    throw error;
  }
};

const answersFrom = (value: unknown, quiz: InstanceType<typeof Quiz>) => {
  if (!Array.isArray(value) || value.length !== quiz.questions.length) throw new RequestContractError(400, 'Answer every quiz question');
  const seen = new Set<string>();
  return value.map(raw => {
    const input = objectBody(raw, ['questionId', 'optionIds', 'booleanAnswer', 'textAnswer']);
    const questionId = textField(input.questionId, 'question ID', 40, 1);
    if (seen.has(questionId)) throw new RequestContractError(400, 'Duplicate question answer');
    seen.add(questionId);
    const question = quiz.questions.find(q => q.questionId === questionId);
    if (!question) throw new RequestContractError(400, 'Unknown quiz question');
    if (question.type === 'multiple_choice') {
      if (!Array.isArray(input.optionIds) || !input.optionIds.length) throw new RequestContractError(400, 'Select an answer');
      const optionIds = input.optionIds.map(v => textField(v, 'option ID', 40, 1)).sort();
      if (new Set(optionIds).size !== optionIds.length || optionIds.some(id => !question.options.some(o => o.optionId === id)))
        throw new RequestContractError(400, 'Invalid quiz option');
      if (input.booleanAnswer !== undefined || input.textAnswer !== undefined) throw new RequestContractError(400, 'Unsupported answer fields');
      return {questionId, optionIds};
    }
    if (question.type === 'true_false') {
      if (typeof input.booleanAnswer !== 'boolean' || input.optionIds !== undefined || input.textAnswer !== undefined)
        throw new RequestContractError(400, 'True/false answer must be boolean');
      return {questionId, optionIds: [], booleanAnswer: input.booleanAnswer};
    }
    if (typeof input.textAnswer !== 'string' || !input.textAnswer.trim() || input.optionIds !== undefined || input.booleanAnswer !== undefined)
      throw new RequestContractError(400, 'Short answer text is required');
    return {questionId, optionIds: [], textAnswer: textField(input.textAnswer, 'short answer', 8000, 1)};
  });
};

export const submitQuizAttempt = async (
  identity: JwtPayload | undefined, token: SessionAuthority, quizId: unknown, attemptId: unknown, body: unknown,
) => {
  const input = objectBody(body, ['answers', 'revision', 'clientOperationId']);
  const expected = revision(input.revision), op = operationId(input.clientOperationId);
  return studentMutation(identity, token, 'quiz', quizId, async (session, context) => {
    const quiz = context.work as InstanceType<typeof Quiz>;
    const answers = answersFrom(input.answers, quiz), payloadHash = hash({attemptId: String(attemptId), expected, answers});
    const attempt = await QuizAttempt.findOne({_id: objectIdField(attemptId, 'attempt ID'), quizId: quiz._id,
      publishedRevision: quiz.publishedRevision, audienceEntitlementId: context.entitlement._id}).session(session);
    if (!attempt) throw unavailable();
    if (attempt.submitOperationId === op) {
      if (attempt.submitFingerprint !== payloadHash) throw conflict('Operation ID was used for different answers');
      return attemptStudentDTO(attempt);
    }
    const now = new Date(), today = schoolToday();
    if (attempt.status !== 'active' || attempt.revision !== expected) throw conflict('Attempt changed or was already submitted');
    if (today < quiz.availableFrom || today > quiz.availableUntil) throw conflict('Quiz submission is outside its release window');
    if (attempt.expiresAt && now > attempt.expiresAt) throw conflict('Quiz time limit expired');
    let objectiveScore = 0, objectiveMax = 0, requiresManualReview = false;
    for (const question of quiz.questions) {
      const answer = answers.find(v => v.questionId === question.questionId)!;
      if (question.type === 'multiple_choice') {
        objectiveMax += 1;
        if (JSON.stringify([...answer.optionIds].sort()) === JSON.stringify([...question.correctOptionIds].sort())) objectiveScore += 1;
      } else if (question.type === 'true_false') {
        objectiveMax += 1; if (answer.booleanAnswer === question.correctBoolean) objectiveScore += 1;
      } else requiresManualReview = true;
    }
    attempt.answers = answers as any; attempt.objectiveScore = objectiveScore; attempt.objectiveMax = objectiveMax;
    attempt.requiresManualReview = requiresManualReview; attempt.submittedAt = now; attempt.status = 'submitted';
    attempt.revision += 1; attempt.submitOperationId = op; attempt.submitFingerprint = payloadHash;
    await attempt.save({session});
    return attemptStudentDTO(attempt);
  });
};

export const getStudentQuizAttempt = async (identity: JwtPayload | undefined, quizId: unknown, attemptId?: unknown) => {
  const context = await studentContext(identity, 'quiz', quizId);
  const filter: Record<string, unknown> = {quizId: context.work._id, publishedRevision: context.work.publishedRevision, audienceEntitlementId: context.entitlement._id};
  if (attemptId !== undefined) filter._id = objectIdField(attemptId, 'attempt ID');
  const row = await QuizAttempt.findOne(filter).sort({attemptNumber: -1}).read('primary');
  if (!row) throw unavailable();
  return attemptStudentDTO(row);
};

const teacherAuthority = async (identity: Identity, targetType: TargetType, evidenceId: unknown) => {
  if (!identity || identity.role !== 'teacher' || !ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE))
    throw new RequestContractError(403, 'Review is not permitted');
  const scope = await getTeacherScope(identity);
  const evidence: any = targetType === 'homework_submission'
    ? await HomeworkSubmission.findById(objectIdField(evidenceId, 'submission ID')).read('primary')
    : await QuizAttempt.findById(objectIdField(evidenceId, 'attempt ID')).read('primary');
  if (!evidence || String(evidence.branchId) !== scope.branchId) throw unavailable();
  const work: any = targetType === 'homework_submission'
    ? await Homework.findOne({_id: evidence.homeworkId, branchId: scope.branchId, teacherId: scope.actorId, publishedRevision: evidence.publishedRevision}).read('primary')
    : await Quiz.findOne({_id: evidence.quizId, branchId: scope.branchId, teacherId: scope.actorId, publishedRevision: evidence.publishedRevision}).read('primary');
  if (!work) throw unavailable();
  const plan: any = await LessonPlan.findById(work.lessonPlanId).read('primary');
  if (!plan) throw unavailable();
  let period: Awaited<ReturnType<typeof getTeacherPeriod>> | undefined;
  let tuple = scope.tuples.find(v => v.classId === String(work.classId) && v.sectionId === String(work.sectionId) && v.subjectId === String(work.subjectId));
  if (plan.occurrence) {
    period = await getTeacherPeriod(identity, String(plan.occurrence.periodId), plan.occurrence.date);
    if (period.classId !== String(work.classId) || period.sectionId !== String(work.sectionId) || period.subjectId !== String(work.subjectId)) throw unavailable();
  } else if (!tuple || (work.assignmentId && tuple.assignmentId !== String(work.assignmentId))) throw unavailable();
  return {scope, evidence, work, plan, period, tuple};
};

const teacherMutation = async <T>(identity: Identity, token: SessionAuthority, authority: Awaited<ReturnType<typeof teacherAuthority>>, write: (session: ClientSession) => Promise<T>) => {
  if (authority.period && authority.plan.occurrence) return mutateOccurrence(
    identity, authority.plan.occurrence.periodId, authority.plan.occurrence.date, PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE,
    async (session) => {
      const decoded = sessionIdentity(token);
      if (decoded.userId !== identity?.userId || decoded.role !== 'teacher') throw new RequestContractError(401, 'Authentication changed');
      await revalidateAuthenticatedSession(token, {userId: String(new mongoose.Types.ObjectId(decoded.userId)), role: 'teacher'}, session);
      return write(session);
    },
  );
  return withTeacherCommunication(identity, token, PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE, authority.tuple, session => write(session));
};

const rubricCriteria = (value: unknown) => {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new RequestContractError(400, 'Provide 1–20 rubric criteria');
  const ids = new Set<string>();
  return value.map(raw => {
    const input = objectBody(raw, ['criterionId', 'title', 'description', 'maxScore']);
    const criterionId = textField(input.criterionId, 'criterion ID', 40, 1);
    if (!/^[A-Za-z0-9_-]+$/.test(criterionId) || ids.has(criterionId)) throw new RequestContractError(400, 'Duplicate or invalid criterion ID');
    ids.add(criterionId);
    const maxScore = numberField(input.maxScore, 'criterion maximum');
    if (maxScore <= 0 || maxScore > 1000) throw new RequestContractError(400, 'Invalid criterion maximum');
    return {criterionId, title: textField(input.title, 'criterion title', 200, 1),
      description: input.description === undefined ? '' : textField(input.description, 'criterion description', 2000), maxScore};
  });
};

const scoreValues = (value: unknown, criteria: ReturnType<typeof rubricCriteria>, required: boolean) => {
  if (!Array.isArray(value)) throw new RequestContractError(400, 'Criterion scores are required');
  const ids = new Set<string>();
  const scores = value.map(raw => {
    const input = objectBody(raw, ['criterionId', 'score']);
    const criterionId = textField(input.criterionId, 'criterion ID', 40, 1);
    if (ids.has(criterionId)) throw new RequestContractError(400, 'Duplicate criterion score');
    ids.add(criterionId);
    const criterion = criteria.find(v => v.criterionId === criterionId);
    if (!criterion) throw new RequestContractError(400, 'Unknown rubric criterion');
    const score = numberField(input.score, 'criterion score');
    if (score > criterion.maxScore) throw new RequestContractError(400, 'Criterion score exceeds its maximum');
    return {criterionId, score};
  });
  if (required && (scores.length !== criteria.length || criteria.some(v => !ids.has(v.criterionId))))
    throw new RequestContractError(400, 'Every rubric criterion must be scored');
  return scores;
};

const reviewDTO = (row: InstanceType<typeof TeacherReview> | null, rubric: InstanceType<typeof AcademicRubric> | null) => ({
  review: row ? {
    reviewId: String(row._id), revision: row.revision, state: row.state, evidenceRevision: row.evidenceRevision,
    rubricRevision: row.rubricRevision ?? null, scores: row.scores.map(v => ({criterionId: v.criterionId, score: v.score})),
    totalScore: row.totalScore ?? null, maxScore: row.maxScore ?? null, feedback: row.feedback ?? '', privateNote: row.privateNote ?? '',
    history: row.history.map(v => ({revision: v.revision, action: v.action, evidenceRevision: v.evidenceRevision,
      rubricRevision: v.rubricRevision ?? null, totalScore: v.totalScore ?? null, maxScore: v.maxScore ?? null,
      scores: v.scores.map((score: any) => ({criterionId: score.criterionId, score: score.score})),
      feedback: v.feedback ?? '', returnReason: v.returnReason ?? null, resubmitAllowed: !!v.resubmitAllowed,
      createdAt: v.createdAt?.toISOString()})),
  } : null,
  rubric: rubric ? {
    rubricId: String(rubric._id), revision: rubric.currentRevision, status: rubric.status,
    criteria: (rubric.versions.find(v => v.revision === rubric.currentRevision)?.criteria ?? []).map(v => ({
      criterionId: v.criterionId, title: v.title, description: v.description, maxScore: v.maxScore,
    })), totalMax: rubric.versions.find(v => v.revision === rubric.currentRevision)?.totalMax ?? 0,
  } : null,
});

const evidenceRevisionOf = (targetType: TargetType, evidence: any) => targetType === 'homework_submission' ? evidence.submissionRevision : evidence.revision;
const evidenceStatusReviewable = (targetType: TargetType, evidence: any) => targetType === 'homework_submission'
  ? ['submitted', 'resubmitted', 'under_review', 'reviewed'].includes(evidence.status)
  : ['submitted', 'under_review', 'reviewed'].includes(evidence.status);

export const getTeacherReviewDetail = async (identity: Identity, targetTypeValue: unknown, evidenceId: unknown) => {
  const targetType = enumField(targetTypeValue, 'evidence type', ['homework_submission', 'quiz_attempt'] as const);
  const authority = await teacherAuthority(identity, targetType, evidenceId);
  const [review, entitlement, schoolClass, section, subject] = await Promise.all([
    TeacherReview.findOne({targetType, evidenceId: authority.evidence._id}).read('primary'),
    AcademicWorkAudience.findById(authority.evidence.audienceEntitlementId).read('primary'),
    SchoolClass.findById(authority.work.classId).select('name').lean(), Section.findById(authority.work.sectionId).select('name').lean(),
    Subject.findById(authority.work.subjectId).select('name').lean(),
  ]);
  const rubric = review?.rubricId ? await AcademicRubric.findById(review.rubricId).read('primary') :
    await AcademicRubric.findOne({workType: targetType === 'homework_submission' ? 'homework' : 'quiz', workId: authority.work._id, publishedRevision: authority.work.publishedRevision}).read('primary');
  const evidence = targetType === 'homework_submission' ? {
    submissionId: String(authority.evidence._id), revision: authority.evidence.submissionRevision, status: authority.evidence.status,
    revisions: authority.evidence.revisions.map((v: any) => ({revision: v.revision, content: v.content, submittedAt: v.submittedAt.toISOString(), timing: v.timing})),
  } : {
    attemptId: String(authority.evidence._id), revision: authority.evidence.revision, attemptNumber: authority.evidence.attemptNumber,
    status: authority.evidence.status, startedAt: authority.evidence.startedAt.toISOString(), submittedAt: authority.evidence.submittedAt?.toISOString() ?? null,
    answers: authority.evidence.answers.map((v: any) => ({questionId: v.questionId, optionIds: [...v.optionIds], booleanAnswer: v.booleanAnswer, textAnswer: v.textAnswer ?? ''})),
    objectiveScore: authority.evidence.objectiveScore, objectiveMax: authority.evidence.objectiveMax,
    requiresManualReview: authority.evidence.requiresManualReview,
  };
  return {
    targetType, work: {workId: String(authority.work._id), title: authority.work.title, publishedRevision: authority.work.publishedRevision,
      className: schoolClass?.name ?? '', sectionName: section?.name ?? '', subjectName: subject?.name ?? ''},
    student: {studentId: String(authority.evidence.studentId), fullName: entitlement?.studentName ?? '', admissionNumber: entitlement?.admissionNumber ?? ''},
    evidence, ...reviewDTO(review, rubric),
  };
};

export const listTeacherReviewQueue = async (identity: Identity) => {
  const scope = await getTeacherScope(identity);
  if (!ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ASSESSMENTS_VIEW)) throw new RequestContractError(403, 'Review queue is unavailable');
  const [submissions, attempts] = await Promise.all([
    HomeworkSubmission.find({branchId: scope.branchId, status: {$in: ['submitted', 'resubmitted', 'under_review', 'reviewed']}}).sort({updatedAt: -1}).limit(50).read('primary'),
    QuizAttempt.find({branchId: scope.branchId, status: {$in: ['submitted', 'under_review', 'reviewed']}}).sort({updatedAt: -1}).limit(50).read('primary'),
  ]);
  const items: any[] = [];
  for (const [targetType, rows] of [['homework_submission', submissions], ['quiz_attempt', attempts]] as const) for (const row of rows as any[]) {
    try {
      const auth = await teacherAuthority(identity, targetType, String(row._id));
      const entitlement = await AcademicWorkAudience.findById(row.audienceEntitlementId).select('studentName admissionNumber').lean();
      const review = await TeacherReview.findOne({targetType, evidenceId: row._id}).select('state revision').lean();
      items.push({targetType, evidenceId: String(row._id), workId: String(auth.work._id), title: auth.work.title,
        student: {fullName: entitlement?.studentName ?? '', admissionNumber: entitlement?.admissionNumber ?? ''},
        evidenceRevision: evidenceRevisionOf(targetType, row), submissionState: row.status,
        reviewState: review?.state ?? 'pending_review', reviewRevision: review?.revision ?? 0,
        submittedAt: targetType === 'homework_submission' ? row.revisions.at(-1)?.submittedAt.toISOString() : row.submittedAt?.toISOString(),
        timing: targetType === 'homework_submission' ? row.revisions.at(-1)?.timing : 'on_time'});
    } catch (error) { if (!(error instanceof RequestContractError) || error.status !== 404) throw error; }
  }
  const overdue = await Homework.find({branchId: scope.branchId, teacherId: scope.actorId, status: 'published', dueAt: {$lt: schoolToday()}})
    .sort({dueAt: -1}).limit(20).read('primary');
  for (const work of overdue) {
    const tuple = scope.tuples.find(v => v.classId === String(work.classId) && v.sectionId === String(work.sectionId) && v.subjectId === String(work.subjectId));
    if (!tuple || (work.assignmentId && tuple.assignmentId !== String(work.assignmentId))) continue;
    const entitlements = await AcademicWorkAudience.find({workType: 'homework', workId: work._id,
      publishedRevision: work.publishedRevision, state: 'assigned'}).select('_id studentName admissionNumber').read('primary');
    const submitted = new Set((await HomeworkSubmission.find({audienceEntitlementId: {$in: entitlements.map(v => v._id)}})
      .select('audienceEntitlementId').lean()).map(v => String(v.audienceEntitlementId)));
    for (const entitlement of entitlements) if (!submitted.has(String(entitlement._id))) items.push({
      targetType: 'missing', evidenceId: null, workId: String(work._id), title: work.title,
      student: {fullName: entitlement.studentName, admissionNumber: entitlement.admissionNumber},
      evidenceRevision: null, submissionState: 'missing', reviewState: 'not_reviewable', reviewRevision: 0,
      submittedAt: null, timing: 'missing',
    });
  }
  return {items, total: items.length};
};

export const mutateTeacherReview = async (
  identity: Identity, token: SessionAuthority, targetTypeValue: unknown, evidenceId: unknown, body: unknown,
) => {
  const targetType = enumField(targetTypeValue, 'evidence type', ['homework_submission', 'quiz_attempt'] as const);
  const input = objectBody(body, ['action', 'revision', 'clientOperationId', 'criteria', 'rubricRevision', 'scores', 'feedback', 'privateNote', 'returnReason', 'resubmitAllowed']);
  const action = enumField(input.action, 'review action', ['save_draft', 'finalize', 'return_for_resubmission', 'release_feedback'] as const);
  const expected = revision(input.revision, true), op = operationId(input.clientOperationId);
  const authority = await teacherAuthority(identity, targetType, evidenceId);
  const feedback = input.feedback === undefined ? '' : textField(input.feedback, 'feedback', 8000);
  const privateNote = input.privateNote === undefined ? '' : textField(input.privateNote, 'private note', 8000);
  const payloadHash = hash({targetType, evidenceId: String(evidenceId), action, expected, criteria: input.criteria, rubricRevision: input.rubricRevision,
    scores: input.scores, feedback, privateNote, returnReason: input.returnReason, resubmitAllowed: input.resubmitAllowed});
  try {
    return await teacherMutation(identity, token, authority, async session => {
      await fence(session, targetType === 'homework_submission' ? HomeworkSubmission.collection.name : QuizAttempt.collection.name, authority.evidence._id);
      let evidence: any = targetType === 'homework_submission'
        ? await HomeworkSubmission.findById(authority.evidence._id).session(session)
        : await QuizAttempt.findById(authority.evidence._id).session(session);
      if (!evidence || !evidenceStatusReviewable(targetType, evidence)) throw conflict('Evidence is not reviewable');
      let review: any = await TeacherReview.findOne({targetType, evidenceId: evidence._id}).session(session);
      const replay = review?.history.find((v: any) => v.operationId === op);
      if (replay) {
        if (replay.fingerprint !== payloadHash) throw conflict('Operation ID was used for a different review');
        const rubric = review.rubricId ? await AcademicRubric.findById(review.rubricId).session(session) : null;
        return reviewDTO(review, rubric);
      }
      if ((review?.revision ?? 0) !== expected) throw conflict('Review changed; refresh before saving');
      if (action === 'return_for_resubmission') {
        if (targetType !== 'homework_submission') throw new RequestContractError(400, 'Quiz attempts cannot be returned for resubmission');
        const reason = textField(input.returnReason, 'return reason', 4000, 3);
        if (input.resubmitAllowed !== true) throw new RequestContractError(400, 'Explicit resubmit permission is required');
        if (!review) review = new TeacherReview({branchId: evidence.branchId, workType: 'homework', workId: evidence.homeworkId,
          publishedRevision: evidence.publishedRevision, targetType, evidenceId: evidence._id, studentId: evidence.studentId,
          recipientUserId: evidence.recipientUserId, reviewerId: authority.scope.actorId, evidenceRevision: evidence.submissionRevision,
          state: 'returned_for_resubmission'});
        review.revision += 1; review.state = 'returned_for_resubmission'; review.reviewerId = authority.scope.actorId;
        review.evidenceRevision = evidence.submissionRevision;
        review.history.push({revision: review.revision, action, reviewerId: authority.scope.actorId, evidenceRevision: evidence.submissionRevision,
          returnReason: reason, resubmitAllowed: true, operationId: op, fingerprint: payloadHash, createdAt: new Date()});
        evidence.status = 'returned_for_resubmission'; evidence.resubmitAllowed = true; evidence.returnedReason = reason;
        await evidence.save({session}); await review.save({session}); return reviewDTO(review, null);
      }
      if (action === 'release_feedback') {
        if (!review || review.state !== 'reviewed') throw conflict('Finalize the review before releasing feedback');
        review.revision += 1; review.state = 'feedback_released'; review.reviewerId = authority.scope.actorId; review.releasedAt = new Date();
        review.history.push({revision: review.revision, action, reviewerId: authority.scope.actorId, evidenceRevision: review.evidenceRevision,
          rubricRevision: review.rubricRevision, scores: review.scores, totalScore: review.totalScore, maxScore: review.maxScore,
          feedback: review.feedback, operationId: op, fingerprint: payloadHash, createdAt: review.releasedAt});
        evidence.status = 'feedback_released'; evidence.feedbackReleasedAt = review.releasedAt;
        await evidence.save({session}); await review.save({session});
        const rubric = review.rubricId ? await AcademicRubric.findById(review.rubricId).session(session) : null;
        return reviewDTO(review, rubric);
      }
      let rubric: any = await AcademicRubric.findOne({workType: targetType === 'homework_submission' ? 'homework' : 'quiz',
        workId: targetType === 'homework_submission' ? evidence.homeworkId : evidence.quizId, publishedRevision: evidence.publishedRevision}).session(session);
      if (input.criteria !== undefined) {
        const criteria = rubricCriteria(input.criteria);
        if (rubric?.status === 'frozen') throw conflict('Published grading rubric is frozen');
        if (rubric && revision(input.rubricRevision) !== rubric.currentRevision) throw conflict('Rubric changed; refresh before saving');
        if (!rubric) rubric = new AcademicRubric({branchId: evidence.branchId, workType: targetType === 'homework_submission' ? 'homework' : 'quiz',
          workId: targetType === 'homework_submission' ? evidence.homeworkId : evidence.quizId, publishedRevision: evidence.publishedRevision});
        rubric.currentRevision += 1;
        rubric.versions.push({revision: rubric.currentRevision, criteria, totalMax: criteria.reduce((sum, v) => sum + v.maxScore, 0),
          createdAt: new Date(), createdBy: authority.scope.actorId});
        await rubric.save({session});
      }
      if (!rubric?.currentRevision) throw new RequestContractError(400, 'A rubric is required');
      if (review?.state === 'reviewed') throw conflict('Finalized review is immutable; release or return it');
      const currentRubric = rubric.versions.find((v: any) => v.revision === rubric.currentRevision)!;
      const criteria = currentRubric.criteria.map((v: any) => ({criterionId: v.criterionId, title: v.title, description: v.description, maxScore: v.maxScore}));
      const scores = scoreValues(input.scores ?? [], criteria, action === 'finalize');
      const totalScore = scores.reduce((sum, v) => sum + v.score, 0), maxScore = currentRubric.totalMax;
      if (totalScore > maxScore) throw new RequestContractError(400, 'Total score exceeds rubric maximum');
      if (!review) review = new TeacherReview({branchId: evidence.branchId, workType: targetType === 'homework_submission' ? 'homework' : 'quiz',
        workId: targetType === 'homework_submission' ? evidence.homeworkId : evidence.quizId, publishedRevision: evidence.publishedRevision,
        targetType, evidenceId: evidence._id, studentId: evidence.studentId, recipientUserId: evidence.recipientUserId,
        reviewerId: authority.scope.actorId, evidenceRevision: evidenceRevisionOf(targetType, evidence), state: 'review_draft'});
      if (review.state === 'feedback_released') throw conflict('Released feedback is immutable');
      review.revision += 1; review.state = action === 'finalize' ? 'reviewed' : 'review_draft'; review.reviewerId = authority.scope.actorId;
      review.evidenceRevision = evidenceRevisionOf(targetType, evidence); review.rubricId = rubric._id; review.rubricRevision = rubric.currentRevision;
      review.scores = scores; review.totalScore = totalScore; review.maxScore = maxScore; review.feedback = feedback; review.privateNote = privateNote;
      const now = new Date(); if (action === 'finalize') { review.reviewedAt = now; rubric.status = 'frozen'; await rubric.save({session}); evidence.status = 'reviewed'; evidence.reviewedAt = now; }
      else evidence.status = 'under_review';
      review.history.push({revision: review.revision, action, reviewerId: authority.scope.actorId, evidenceRevision: review.evidenceRevision,
        rubricRevision: review.rubricRevision, scores, totalScore, maxScore, feedback, privateNote,
        operationId: op, fingerprint: payloadHash, createdAt: now});
      await evidence.save({session}); await review.save({session}); return reviewDTO(review, rubric);
    });
  } catch (error) {
    if ((error as {code?: number}).code === 11000) throw conflict('Review is already being processed');
    throw error;
  }
};

export const ensureAcademicEvidenceIndexes = () => Promise.all([
  HomeworkSubmission.createIndexes(), QuizAttempt.createIndexes(), AcademicRubric.createIndexes(), TeacherReview.createIndexes(),
]);
