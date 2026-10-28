import {type SessionAuthority, sessionIdentity, revalidateAuthenticatedSession} from './authenticated-session.service';
import {
  authorizeHistoricalAttendanceRead,
  hasOperationalAttendanceVersion,
} from './attendance-history.service';
import { enrollmentMembership } from './enrollment-membership.service';
import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../models/attendanceAmendment';
import ApprovalRequest, { type ApprovalType } from '../models/approvalRequest';
import {
  AttendanceSession,
  PERIOD_ATTENDANCE_STATUSES,
} from '../models/periodAttendance';
import Student from '../models/student';
import User from '../models/user';

import {
  getTeacherScope,
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  getTeacherPeriod,
  mutateOccurrence,
} from './teacher-timetable.service';
import {
  effectiveAttendance,
  suppressStaleAttendanceIntents,
  stageSubmittedAbsenceIntents,
} from './attendance-effective.service';
import { suppressCatchUpsForCorrection } from './catch-up.service';
import { assertApprovalAuthority } from './approval-authority.policy';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { type JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';
import { scheduleDate } from './school-date.service';
const missing = () =>
  new RequestContractError(
    404,
    'Attendance review is unavailable or outside your current scope',
  );
const conflict = () =>
  new RequestContractError(
    409,
    'Attendance or request changed. Refresh and review before retrying.',
  );
const permission = (role: 'teacher' | 'principal', p: Permission) => {
  if (!ROLE_PERMISSIONS[role].includes(p))
    throw new RequestContractError(
      403,
      'Attendance review permission has changed',
    );
};
const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const operation = (v: unknown) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(v))
    throw new RequestContractError(400, 'Invalid client operation ID');
  return v;
};
const version = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw new RequestContractError(400, 'Invalid review revision');
  return v;
};
const lock = async (
  tx: ClientSession,
  collection: string,
  id: unknown,
  filter: Record<string, unknown> = {},
) => {
  const r = await mongoose.connection
    .collection(collection)
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(id)), ...filter },
      { $inc: { __v: 1 } },
      { session: tx },
    );
  if (!r.matchedCount) throw missing();
};
const lockLogin = async (
  tx: ClientSession,
  identity: JwtPayload,
  token: SessionAuthority,
) => {
  const decoded = sessionIdentity(token);
  if (decoded.userId !== identity.userId || decoded.role !== identity.role)
    throw new RequestContractError(401, 'Session is unavailable');
  await revalidateAuthenticatedSession(token, {userId: String(new mongoose.Types.ObjectId(identity.userId)), role: identity.role}, tx);
};
const studentEvidence = async (
  branchId: string,
  session: any,
  studentId: string,
) => {
  if (
    session.state === 'submitted' &&
    !session.rosterStudentIds.some((id: unknown) => String(id) === studentId)
  )
    throw missing();
  const student = await Student.findOne({})
    .where('_id')
    .equals(studentId)
    .where('branchId')
    .equals(branchId)
    .select('_id userId admissionNumber classId sectionId')
    .lean();
  if (!student) throw missing();
  if (
    session.state !== 'submitted' &&
    !(
      await Student.aggregate([
        ...enrollmentMembership(
          branchId,
          String(session.classId),
          String(session.sectionId),
          session.date,
        ),
        { $match: { _id: new mongoose.Types.ObjectId(studentId) } },
        { $limit: 1 },
      ])
    ).length
  )
    throw missing();
  const user = await User.findOne({ role: 'student' })
    .where('_id')
    .equals(student.userId)
    .where('branchId')
    .equals(branchId)
    .select('fullName')
    .lean();
  if (!user) throw missing();
  return {
    studentId,
    fullName: user.fullName,
    admissionNumber: student.admissionNumber,
  };
};
const teacherContext = async (
  identity: JwtPayload | undefined,
  sessionId: string,
  studentId: string,
) => {
  const scope = await getTeacherScope(identity);
  permission('teacher', PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
  const attendance = await AttendanceSession.findOne({
    _id: sessionId,
    branchId: scope.branchId,
  }).lean();
  if (!attendance) throw missing();
  const period = await getTeacherPeriod(
    identity,
    String(attendance.periodId),
    attendance.date,
  );
  if (
    period.approvedVersion.versionId !== String(attendance.timetableVersionId)
  )
    throw missing();
  const student = await studentEvidence(scope.branchId, attendance, studentId);
  return { branchId: scope.branchId, attendance, period, student };
};
// Historical review is a read policy, never amendment mutation authority.
const teacherHistoryContext = async (
  identity: JwtPayload | undefined,
  sessionId: string,
  studentId: string,
) => {
  const scope = await getTeacherScope(identity);
  permission('teacher', PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
  const attendance = await AttendanceSession.findOne({
    _id: sessionId,
    branchId: scope.branchId,
  }).read('primary');
  if (!attendance) throw missing();
  if (attendance.state !== 'submitted')
    return teacherContext(identity, sessionId, studentId);
  const period = await authorizeHistoricalAttendanceRead(scope, attendance);
  const student = await studentEvidence(scope.branchId, attendance, studentId);
  return { branchId: scope.branchId, attendance, period, student };
};
const principal = async (
  identity: JwtPayload | undefined,
  type: ApprovalType,
  manage = false,
) => {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'principal')
    throw new RequestContractError(403, 'Principal review is required');
  permission(
    'principal',
    manage
      ? PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE
      : PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
  );
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  assertApprovalAuthority(String(actor._id), branchId, { approvalType: type });
  return { actor, branchId };
};
const safeHistory = async (rows: any[], branchId: string) => {
  const users = await User.find()
    .where('branchId')
    .equals(branchId)
    .where('_id')
    .in(rows.flatMap(r => [r.requestedBy, r.reviewedBy]).filter(Boolean))
    .select('_id fullName')
    .lean();
  const names = new Map(users.map(u => [String(u._id), u.fullName]));
  return rows.map(r => ({
    requestId: String(r._id),
    approvalId: String(r.approvalRequestId),
    originalStatus: r.originalStatus,
    baseStatus: r.baseStatus,
    requestedStatus: r.requestedStatus ?? null,
    reason: r.reason,
    state: r.state,
    requestedBy: names.get(String(r.requestedBy)) ?? 'Unavailable requester',
    requestedAt: r.createdAt,
    reviewedBy: r.reviewedBy
      ? names.get(String(r.reviewedBy)) ?? 'Unavailable reviewer'
      : null,
    reviewedAt: r.reviewedAt ?? null,
    reviewNote: r.reviewNote ?? null,
    fromDate: r.fromDate,
    untilDate: r.untilDate,
    category: r.category,
    revision: r.revision,
  }));
};
export const getTeacherAttendanceReview = async (
  identity: JwtPayload | undefined,
  sessionValue: unknown,
  studentValue: unknown,
  offset = 0,
) => {
  const sessionId = objectIdField(sessionValue, 'session ID'),
    studentId = objectIdField(studentValue, 'student ID');
  const ctx = await teacherHistoryContext(identity, sessionId, studentId);
  const effective =
    ctx.attendance.state === 'submitted'
      ? (await effectiveAttendance(ctx.branchId, sessionId)).get(studentId) ??
        null
      : null;
  const operational = await hasOperationalAttendanceVersion(
    ctx.branchId,
    ctx.period,
  );
  const query = {
    branchId: ctx.branchId,
    attendanceSessionId: sessionId,
    studentId,
  };
  const [corrections, total, leaves, approvedLeave, pending, teacher] =
    await Promise.all([
      AttendanceCorrection.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(offset)
        .limit(20)
        .lean(),
      AttendanceCorrection.countDocuments(query),
      StudentLeave.find({
        branchId: ctx.branchId,
        studentId,
        fromDate: { $lte: ctx.attendance.date },
        untilDate: { $gte: ctx.attendance.date },
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .lean(),
      StudentLeave.findOne({
        branchId: ctx.branchId,
        studentId,
        state: 'approved',
        fromDate: { $lte: ctx.attendance.date },
        untilDate: { $gte: ctx.attendance.date },
      })
        .sort({ createdAt: -1 })
        .lean(),
      AttendanceCorrection.exists({ ...query, state: 'pending' }),
      User.findById(identity!.userId).select('fullName').lean(),
    ]);
  return {
    sessionId,
    teacherName: teacher?.fullName ?? 'Teacher',
    student: ctx.student,
    period: ctx.period,
    submitted: ctx.attendance.state === 'submitted',
    submittedRevision: ctx.attendance.revision,
    effective,
    canRequestCorrection:
      operational &&
      ctx.attendance.state === 'submitted' &&
      !!effective &&
      !pending &&
      ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ATTENDANCE_MANAGE),
    canRequestLeave:
      operational &&
      ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ATTENDANCE_MANAGE),
    approvedLeaveId: approvedLeave ? String(approvedLeave._id) : null,
    corrections: await safeHistory(corrections, ctx.branchId),
    leaves: await safeHistory(leaves, ctx.branchId),
    total,
    nextOffset:
      offset + corrections.length < total ? offset + corrections.length : null,
  };
};
export const requestAttendanceAmendment = async (
  identity: JwtPayload | undefined,
  token: SessionAuthority,
  kind: 'correction' | 'leave',
  sessionValue: unknown,
  studentValue: unknown,
  body: unknown,
) => {
  const sessionId = objectIdField(sessionValue, 'session ID'),
    studentId = objectIdField(studentValue, 'student ID');
  const input = objectBody(
    body,
    kind === 'correction'
      ? [
          'requestedStatus',
          'reason',
          'submittedRevision',
          'effectiveRevision',
          'leaveId',
          'clientOperationId',
        ]
      : ['fromDate', 'untilDate', 'category', 'reason', 'clientOperationId'],
  );
  const reason = textField(input.reason, 'reason', 500, 10),
    clientOperationId = operation(input.clientOperationId);
  const requestedStatus =
    kind === 'correction'
      ? enumField(
          input.requestedStatus,
          'requested status',
          PERIOD_ATTENDANCE_STATUSES,
        )
      : undefined;
  const submittedRevision =
      kind === 'correction' ? version(input.submittedRevision) : undefined,
    baseEffectiveRevision =
      kind === 'correction' ? version(input.effectiveRevision) : undefined;
  const leaveId =
    input.leaveId === undefined
      ? undefined
      : objectIdField(input.leaveId, 'leave ID');
  const fromDate = kind === 'leave' ? scheduleDate(input.fromDate) : undefined,
    untilDate = kind === 'leave' ? scheduleDate(input.untilDate) : undefined;
  const category =
    kind === 'leave'
      ? enumField(input.category, 'leave category', [
          'illness',
          'authorized_absence',
          'other',
        ] as const)
      : undefined;
  if (
    fromDate &&
    untilDate &&
    (untilDate < fromDate ||
      Date.parse(untilDate) - Date.parse(fromDate) > 366 * 86400000)
  )
    throw new RequestContractError(400, 'Invalid leave range');
  const hash = fingerprint({
    kind,
    sessionId,
    studentId,
    requestedStatus,
    submittedRevision,
    baseEffectiveRevision,
    leaveId,
    fromDate,
    untilDate,
    category,
    reason,
  });
  const ctx = await teacherContext(identity, sessionId, studentId);
  permission('teacher', PERMISSIONS.TEACHER_ATTENDANCE_MANAGE);
  try {
    return await mutateOccurrence(
      identity,
      String(ctx.attendance.periodId),
      ctx.attendance.date,
      PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
      async (tx, period, branchId) => {
        await lockLogin(tx, identity!, token);
        await lock(tx, AttendanceSession.collection.name, sessionId, {
          branchId: new mongoose.Types.ObjectId(branchId),
        });
        await lock(tx, Student.collection.name, studentId, {
          branchId: new mongoose.Types.ObjectId(branchId),
        });
        const current = await AttendanceSession.findById(sessionId)
          .session(tx)
          .lean();
        if (!current) throw missing();
        if (
          String(current.timetableVersionId) !==
          period.approvedVersion.versionId
        )
          throw conflict();
        const pupil = await Student.findById(studentId)
          .session(tx)
          .select('userId')
          .lean();
        if (!pupil) throw missing();
        await lock(tx, User.collection.name, pupil.userId, {
          branchId: new mongoose.Types.ObjectId(branchId),
          role: 'student',
        });
        await studentEvidence(branchId, current, studentId);
        const key = {
          branchId,
          requestedBy: identity!.userId,
          clientOperationId,
        };
        const existing =
          kind === 'correction'
            ? await AttendanceCorrection.findOne(key).session(tx)
            : await StudentLeave.findOne(key).session(tx);
        if (existing) {
          if (existing.fingerprint !== hash) throw conflict();
          return {
            requestId: String(existing._id),
            approvalId: String(existing.approvalRequestId),
            state: existing.state,
            replayed: true,
          };
        }
        const requestId = new mongoose.Types.ObjectId(),
          approvalId = new mongoose.Types.ObjectId();
        const common = {
          _id: requestId,
          ...key,
          attendanceSessionId: sessionId,
          studentId,
          approvalRequestId: approvalId,
          reason,
          fingerprint: hash,
          occurrenceVersionId: period.approvedVersion.versionId,
          occurrenceSubstituteId: period.substituteId,
          state: 'pending',
        };
        if (kind === 'correction') {
          if (
            current.state !== 'submitted' ||
            current.revision !== submittedRevision
          )
            throw conflict();
          const state = (
            await effectiveAttendance(branchId, sessionId, tx)
          ).get(studentId);
          if (!state) throw missing();
          if (state.effectiveRevision !== baseEffectiveRevision)
            throw conflict();
          if (state.status === requestedStatus)
            throw new RequestContractError(
              400,
              'Requested status must differ from the effective status',
            );
          if (
            await AttendanceCorrection.exists({
              branchId,
              attendanceSessionId: sessionId,
              studentId,
              state: 'pending',
            }).session(tx)
          )
            throw conflict();
          if (requestedStatus === 'leave') {
            if (
              !leaveId ||
              !(await StudentLeave.exists({
                state: 'approved',
                fromDate: { $lte: current.date },
                untilDate: { $gte: current.date },
              })
                .where('_id')
                .equals(leaveId)
                .where('branchId')
                .equals(branchId)
                .where('studentId')
                .equals(studentId)
                .session(tx))
            )
              throw new RequestContractError(
                400,
                'An approved student leave covering this date is required',
              );
            await lock(tx, StudentLeave.collection.name, leaveId, {
              state: 'approved',
            });
          }
          await AttendanceCorrection.create(
            [
              {
                ...common,
                originalStatus: state.originalStatus,
                baseStatus: state.status,
                requestedStatus,
                submittedRevision,
                baseEffectiveRevision,
                leaveId,
              },
            ],
            { session: tx },
          );
        } else {
          if (
            !fromDate ||
            !untilDate ||
            fromDate > current.date ||
            untilDate < current.date
          )
            throw new RequestContractError(
              400,
              'Leave range must include the selected school date',
            );
          if (
            await StudentLeave.exists({
              branchId,
              studentId,
              state: 'pending',
              fromDate: { $lte: untilDate },
              untilDate: { $gte: fromDate },
            }).session(tx)
          )
            throw conflict();
          await StudentLeave.create(
            [{ ...common, fromDate, untilDate, category }],
            { session: tx },
          );
        }
        await ApprovalRequest.create(
          [
            {
              _id: approvalId,
              branchId,
              requesterId: identity!.userId,
              entityType:
                kind === 'correction'
                  ? 'attendance_correction'
                  : 'student_leave',
              entityId: requestId,
              approvalType:
                kind === 'correction' ? 'attendance_correction' : 'leave',
              reason,
              status: 'pending',
              history: [],
            },
          ],
          { session: tx },
        );
        sessionIdentity(token);
        permission('teacher', PERMISSIONS.TEACHER_ATTENDANCE_MANAGE);
        return {
          requestId: String(requestId),
          approvalId: String(approvalId),
          state: 'pending',
          replayed: false,
        };
      },
    );
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict();
    throw e;
  }
};
const reviewContext = async (
  identity: JwtPayload | undefined,
  approvalValue: unknown,
  manage = false,
) => {
  const id = objectIdField(approvalValue, 'approval ID');
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'principal')
    throw new RequestContractError(403, 'Principal review is required');
  const approval = await ApprovalRequest.findOne({
    entityType: { $in: ['attendance_correction', 'student_leave'] },
  })
    .where('_id')
    .equals(id)
    .where('branchId')
    .equals(actor.branchId)
    .lean();
  if (!approval) throw missing();
  const reviewer = await principal(identity, approval.approvalType, manage);
  if (String(approval.requesterId) === String(actor._id))
    throw new RequestContractError(
      403,
      'Requester cannot review their own request',
    );
  const correction = approval.entityType === 'attendance_correction';
  const record = correction
    ? await AttendanceCorrection.findOne({})
        .where('_id')
        .equals(approval.entityId)
        .where('approvalRequestId')
        .equals(id)
        .where('branchId')
        .equals(reviewer.branchId)
        .lean()
    : await StudentLeave.findOne({})
        .where('_id')
        .equals(approval.entityId)
        .where('approvalRequestId')
        .equals(id)
        .where('branchId')
        .equals(reviewer.branchId)
        .lean();
  if (
    !record ||
    String(record.requestedBy) !== String(approval.requesterId) ||
    approval.approvalType !== (correction ? 'attendance_correction' : 'leave')
  )
    throw missing();
  const requester = {
    userId: String(record.requestedBy),
    role: 'teacher' as const,
  };
  const context = await (manage ? teacherContext : teacherHistoryContext)(
    requester,
    String(record.attendanceSessionId),
    String(record.studentId),
  );
  if (
    String(record.occurrenceVersionId) !==
      context.period.approvedVersion.versionId ||
    String(record.occurrenceSubstituteId ?? '') !==
      String(context.period.substituteId ?? '')
  )
    throw conflict();
  return { ...context, ...reviewer, record, approval, correction, requester };
};
export const getPrincipalAttendanceReview = async (
  identity: JwtPayload | undefined,
  approvalId: unknown,
) => {
  const ctx = await reviewContext(identity, approvalId);
  const effective =
    (
      await effectiveAttendance(
        ctx.branchId,
        String(ctx.record.attendanceSessionId),
      )
    ).get(String(ctx.record.studentId)) ?? null;
  const [entry] = await safeHistory([ctx.record], ctx.branchId);
  return {
    approvalId: String(ctx.approval._id),
    kind: ctx.correction ? 'correction' : 'leave',
    reviewerRole: 'Principal',
    student: ctx.student,
    period: ctx.period,
    effective,
    request: entry,
    canReview:
      (await hasOperationalAttendanceVersion(ctx.branchId, ctx.period)) &&
      ctx.record.state === 'pending' &&
      ROLE_PERMISSIONS.principal.includes(
        PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
      ),
  };
};
export const decideAttendanceAmendment = async (
  identity: JwtPayload | undefined,
  token: SessionAuthority,
  approvalValue: unknown,
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
      'rejected',
    ] as const),
    note = textField(
      input.reviewNote,
      'review note',
      500,
      action === 'rejected' ? 10 : 0,
    ),
    revision = version(input.revision),
    op = operation(input.clientOperationId);
  const ctx = await reviewContext(identity, approvalValue, true);
  const hash = fingerprint({
    approvalId: String(ctx.approval._id),
    action,
    note,
    revision,
  });
  return mutateOccurrence(
    ctx.requester,
    String(ctx.attendance.periodId),
    ctx.attendance.date,
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
    async (tx, _period, branchId) => {
      if (branchId !== ctx.branchId) throw missing();
      if (
        _period.approvedVersion.versionId !==
          String(ctx.record.occurrenceVersionId) ||
        String(_period.substituteId ?? '') !==
          String(ctx.record.occurrenceSubstituteId ?? '')
      )
        throw conflict();
      await lockLogin(tx, identity!, token);
      await lock(tx, User.collection.name, ctx.actor._id);
      await principal(identity, ctx.approval.approvalType, true);
      await lock(tx, AttendanceSession.collection.name, ctx.attendance._id, {
        state: ctx.correction ? 'submitted' : ctx.attendance.state,
      });
      await lock(tx, Student.collection.name, ctx.record.studentId, {
        branchId: new mongoose.Types.ObjectId(branchId),
      });
      const source = await AttendanceSession.findById(ctx.attendance._id)
        .session(tx)
        .lean();
      if (!source || source.revision !== ctx.attendance.revision)
        throw conflict();
      const pupil = await Student.findById(ctx.record.studentId)
        .session(tx)
        .select('userId')
        .lean();
      if (!pupil) throw missing();
      await lock(tx, User.collection.name, pupil.userId, {
        branchId: new mongoose.Types.ObjectId(branchId),
        role: 'student',
      });
      await studentEvidence(branchId, source, String(ctx.record.studentId));
      const current = ctx.correction
        ? await AttendanceCorrection.findById(ctx.record._id).session(tx)
        : await StudentLeave.findById(ctx.record._id).session(tx);
      if (!current) throw missing();
      if (current.state !== 'pending') {
        if (
          current.decisionOperationId === op &&
          current.decisionFingerprint === hash
        )
          return { state: current.state, replayed: true };
        throw conflict();
      }
      if (current.revision !== revision) throw conflict();
      if (ctx.correction) {
        const correction = await AttendanceCorrection.findById(current._id)
          .session(tx)
          .lean();
        if (!correction) throw missing();
        const state = (
          await effectiveAttendance(
            branchId,
            String(current.attendanceSessionId),
            tx,
          )
        ).get(String(current.studentId));
        if (
          !state ||
          state.originalStatus !== correction.originalStatus ||
          state.status !== correction.baseStatus ||
          state.effectiveRevision !== correction.baseEffectiveRevision ||
          ctx.attendance.revision !== correction.submittedRevision
        )
          throw conflict();
        if (correction.requestedStatus === 'leave' && action === 'approved') {
          if (
            !(await StudentLeave.exists({
              _id: correction.leaveId,
              branchId,
              studentId: correction.studentId,
              state: 'approved',
              fromDate: { $lte: ctx.attendance.date },
              untilDate: { $gte: ctx.attendance.date },
            }).session(tx))
          )
            throw conflict();
          await lock(tx, StudentLeave.collection.name, correction.leaveId!, {
            state: 'approved',
          });
        }
        if (action === 'approved') {
          await AttendanceCorrection.updateOne(
            { _id: current._id, state: 'pending', revision },
            { $set: { approvedVersion: state.effectiveRevision + 1 } },
            { session: tx },
          );
          await suppressStaleAttendanceIntents(
            branchId,
            String(current.attendanceSessionId),
            String(current.studentId),
            String(current._id),
            tx,
          );
          if (correction.requestedStatus !== 'absent')
            await suppressCatchUpsForCorrection(
              branchId,
              String(current.attendanceSessionId),
              String(current.studentId),
              String(current._id),
              tx,
            );
        }
      }
      const update = {
        $set: {
          state: action,
          reviewedBy: ctx.actor._id,
          reviewedAt: new Date(),
          reviewNote: note,
          decisionOperationId: op,
          decisionFingerprint: hash,
        },
        $inc: { revision: 1 },
      };
      const changed = ctx.correction
        ? await AttendanceCorrection.updateOne(
            { _id: current._id, state: 'pending', revision },
            update,
            { session: tx },
          )
        : await StudentLeave.updateOne(
            { _id: current._id, state: 'pending', revision },
            update,
            { session: tx },
          );
      if (!changed.modifiedCount) throw conflict();
      const approval = await ApprovalRequest.updateOne(
        { _id: ctx.approval._id, status: 'pending', __v: ctx.approval.__v },
        {
          $set: {
            status: action,
            reviewedBy: ctx.actor._id,
            reviewedAt: new Date(),
          },
          $push: {
            history: {
              action,
              performedBy: ctx.actor._id,
              authority: 'direct',
              reason: note,
              createdAt: new Date(),
            },
          },
          $inc: { __v: 1 },
        },
        { session: tx },
      );
      if (!approval.modifiedCount) throw conflict();
      if (ctx.correction && action === 'approved')
        await stageSubmittedAbsenceIntents(
          branchId,
          String(current.attendanceSessionId),
          tx,
        );
      sessionIdentity(token);
      await principal(identity, ctx.approval.approvalType, true);
      return { state: action, replayed: false };
    },
  );
};
