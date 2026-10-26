import {authorizeHistoricalAttendanceRead} from './attendance-history.service';
import {requireClassSubject} from './class-subject-context.service';
import {enrollmentMembership} from './enrollment-membership.service';
import {
  effectiveAttendance,
  stageSubmittedAbsenceIntents,
} from './attendance-effective.service';
import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import Student from '../models/student';
import User from '../models/user';
import Session from '../models/session';
import {
  AttendanceSession,
  AttendanceOperation,
  PeriodAttendanceRecord,
  PERIOD_ATTENDANCE_STATUSES,
  type PeriodAttendanceStatus,
} from '../models/periodAttendance';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import { getTeacherScope } from './teacher-scope.service';
import {
  getTeacherPeriod,
  getTeacherTimetable,
  mutateOccurrence,
  type TeacherPeriodDTO,
} from './teacher-timetable.service';
import { schoolToday, schoolDateTime } from './school-date.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';

type Identity = JwtPayload | undefined;
interface RosterRow {
  studentId: string;
  userId: string;
  fullName: string;
  admissionNumber: string;
}
const missing = () =>
  new RequestContractError(404, 'Attendance session is unavailable');
const conflict = (message: string) => new RequestContractError(409, message);
const requirePermission = (permission: string) => {
  if (!ROLE_PERMISSIONS.teacher.some(p => p === permission))
    throw new RequestContractError(403, 'Attendance action is not permitted');
};
const eligible = (period: TeacherPeriodDTO) => {
  if (period.date > schoolToday())
    throw new RequestContractError(
      400,
      'Attendance is not open for a future school date',
    );
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const occurrenceKey = (period: TeacherPeriodDTO, branchId: string) => ({
  branchId,
  periodId: period.periodId,
  date: period.date,
  timetableVersionId: period.approvedVersion.versionId,
});
const roster = async (period: TeacherPeriodDTO, branchId: string) => {
  const rows = await Student.aggregate<RosterRow>([
    ...enrollmentMembership(branchId, period.classId, period.sectionId, period.date),
    { $project: { _id: 1, userId: 1, admissionNumber: 1 } },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'userId',
        foreignField: '_id',
        pipeline: [
          {
            $match: {
              isActive: true,
              role: 'student',
              branchId: new mongoose.Types.ObjectId(branchId),
            },
          },
          { $project: { _id: 1, fullName: 1 } },
        ],
        as: 'identity',
      },
    },
    { $unwind: '$identity' },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        studentId: { $toString: '$_id' },
        userId: { $toString: '$userId' },
        fullName: '$identity.fullName',
        admissionNumber: 1,
      },
    },
  ]).read('primary');
  return { rows, version: digest(rows) };
};
// Fence existing enrollment and identity records. Trusted enrollment creation
// shares the branch publication fence to prevent phantom new roster members.
const lockRoster = async (
  session: ClientSession,
  period: TeacherPeriodDTO,
  branchId: string,
) => {
  const candidates = await Student.find()
    .where('branchId')
    .equals(branchId)
    .where('classId')
    .equals(period.classId)
    .where('sectionId')
    .equals(period.sectionId)
    .read('primary')
    .select('_id userId')
    .lean();
  for (const [collection, ids] of [
    [Student.collection.name, candidates.map(s => s._id)],
    [User.collection.name, candidates.map(s => s.userId)],
  ] as const) {
    if (ids.length)
      await mongoose.connection.collection(collection).bulkWrite(
        ids.map(_id => ({
          updateOne: {
            filter: { _id },
            update: { $inc: { __v: 1 } },
          },
        })),
        { session },
      );
  }
};
const lockLogin = async (
  session: ClientSession,
  identity: Identity,
  token: string,
) => {
  const decoded = verifyAccessToken(token);
  if (decoded.userId !== identity?.userId || decoded.role !== 'teacher')
    throw new RequestContractError(401, 'Authentication has changed');
  const result = await Session.collection.updateMany(
    {
      token,
      userId: new mongoose.Types.ObjectId(identity.userId),
      role: 'teacher',
      isRevoked: false,
    },
    { $inc: { __v: 1 } },
    { session },
  );
  if (!result.matchedCount)
    throw new RequestContractError(401, 'Session is unavailable');
};
const detail = async (
  period: TeacherPeriodDTO,
  branchId: string,
  attendance: Awaited<ReturnType<typeof AttendanceSession.findOne>>,
  session?: ClientSession,
) => {
  if (!attendance) throw missing();
  const current = await roster(period, branchId);
  const query = PeriodAttendanceRecord.find({
    branchId,
    attendanceSessionId: attendance._id,
  })
    .select('studentId status')
    .lean();
  const records = await (session
    ? query.session(session)
    : query.read('primary'));
  const marks = new Map(records.map(r => [String(r.studentId), r.status]));
  let rows = current.rows;
  const effective =
    attendance.state === 'submitted'
      ? await effectiveAttendance(branchId, String(attendance._id), session)
      : null;
  if (attendance.state === 'submitted') {
    const students = await Student.find()
      .where('_id')
      .in(attendance.rosterStudentIds)
      .where('branchId')
      .equals(branchId)
      .select('_id userId admissionNumber')
      .lean();
    const users = await User.find({ role: 'student' })
      .where('_id')
      .in(students.map(s => s.userId))
      .where('branchId')
      .equals(branchId)
      .select('_id fullName')
      .lean();
    rows = attendance.rosterStudentIds.flatMap(id => {
      const s = students.find(
        candidate => String(candidate._id) === String(id),
      );
      if (!s) return [];
      const u = users.find(
        candidate => String(candidate._id) === String(s.userId),
      );
      return u
        ? [
            {
              studentId: String(s._id),
              userId: String(s.userId),
              fullName: u.fullName,
              admissionNumber: s.admissionNumber,
            },
          ]
        : [];
    });
  }
  return {
    sessionId: String(attendance._id),
    period,
    state: attendance.state,
    revision: attendance.revision,
    rosterVersion: current.version,
    rosterChanged: attendance.rosterVersion !== current.version,
    submittedAt: attendance.submittedAt?.toISOString() ?? null,
    canSave:
      attendance.state !== 'submitted' &&
      ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ATTENDANCE_MANAGE),
    students: rows.map(s => ({
      studentId: s.studentId,
      fullName: s.fullName,
      admissionNumber: s.admissionNumber,
      status:
        effective?.get(s.studentId)?.status ?? marks.get(s.studentId) ?? null,
      ...(effective?.get(s.studentId)
        ? {
            originalStatus: effective.get(s.studentId)!.originalStatus,
            effectiveRevision: effective.get(s.studentId)!.effectiveRevision,
          }
        : {}),
    })),
  };
};
export const getTeacherAttendancePending = async (
  identity: Identity,
  date?: unknown,
) => {
  requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
  const queue = await getTeacherTimetable(identity, date);
  const scope = await getTeacherScope(identity);
  // Pending begins at the effective occurrence's school-local start (inclusive).
  // Direct same-day pre-marking remains allowed; pending is never absence.
  const now = schoolDateTime();
  const periods = queue.periods.filter(
    p => p.date < now.date || (p.date === now.date && p.startTime <= now.time),
  );
  const sessions = await AttendanceSession.find({
    branchId: scope.branchId,
    date: queue.start,
    periodId: { $in: periods.map(p => p.periodId) },
  })
    .read('primary')
    .select('_id periodId timetableVersionId state revision')
    .lean();
  const pending = periods.flatMap(period => {
    const stored = sessions.find(
      s =>
        String(s.periodId) === period.periodId &&
        String(s.timetableVersionId) === period.approvedVersion.versionId,
    );
    return stored?.state === 'submitted'
      ? []
      : [
          {
            period,
            sessionId: stored ? String(stored._id) : null,
            state: stored?.state ?? 'open',
            revision: stored?.revision ?? 0,
          },
        ];
  });
  return {
    date: queue.start,
    timezone: queue.timezone,
    total: pending.length,
    sessions: pending,
  };
};
export const openTeacherAttendance = async (
  identity: Identity,
  token: string,
  id: unknown,
  date: unknown,
) => {
  requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
  // Existing sessions are normal authorized reads. Only lazy creation needs
  // the occurrence transaction/fences; refreshes do not serialize the branch.
  const scope = await getTeacherScope(identity);
  const authorized = await getTeacherPeriod(identity, id, date);
  eligible(authorized);
  const existing = await AttendanceSession.findOne(
    occurrenceKey(authorized, scope.branchId),
  ).read('primary');
  if (existing) return detail(authorized, scope.branchId, existing);
  return mutateOccurrence(
    identity,
    id,
    date,
    PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
    async (session, period, branchId) => {
      eligible(period);
      await requireClassSubject(branchId, period.classId, period.subjectId, session);
      await lockLogin(session, identity, token);
      await lockRoster(session, period, branchId);
      const current = await roster(period, branchId);
      const attendance = await AttendanceSession.findOneAndUpdate(
        occurrenceKey(period, branchId),
        {
          $setOnInsert: {
            classId: period.classId,
            sectionId: period.sectionId,
            subjectId: period.subjectId,
            responsibleTeacherId: identity!.userId,
            substituteId: period.substituteId ?? undefined,
            rosterVersion: current.version,
            rosterStudentIds: current.rows.map(s => s.studentId),
            state: 'open',
            revision: 0,
          },
        },
        { session, upsert: true, returnDocument: 'after', runValidators: true },
      );
      const result = await detail(period, branchId, attendance, session);
      if ((await roster(period, branchId)).version !== current.version)
        throw conflict('Roster changed. Reload and review.');
      return result;
    },
  );
};
export const getTeacherAttendanceSession = async (
  identity: Identity,
  requestedId: unknown,
) => {
  requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
  const id = objectIdField(requestedId, 'attendance session ID');
  const scope = await getTeacherScope(identity);
  const attendance = await AttendanceSession.findOne({
    _id: id,
    branchId: scope.branchId,
  }).read('primary');
  if (!attendance) throw missing();
  if (attendance.state === 'submitted') {
    const historical = await authorizeHistoricalAttendanceRead(scope, attendance);
    eligible(historical);
    return detail(historical, scope.branchId, attendance);
  }
  const period = await getTeacherPeriod(
    identity,
    String(attendance.periodId),
    attendance.date,
  );
  eligible(period);
  if (
    period.approvedVersion.versionId !== String(attendance.timetableVersionId)
  )
    throw missing();
  return detail(period, scope.branchId, attendance);
};
export const writeTeacherAttendance = async (
  identity: Identity,
  token: string,
  requestedId: unknown,
  action: 'draft' | 'submit',
  input: unknown,
) => {
  requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
  requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_MANAGE);
  const id = objectIdField(requestedId, 'attendance session ID');
  const body = objectBody(input, [
    'revision',
    'rosterVersion',
    'clientOperationId',
    'marks',
  ]);
  if (
    !Number.isSafeInteger(body.revision) ||
    (body.revision as number) < 0 ||
    typeof body.rosterVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.rosterVersion) ||
    typeof body.clientOperationId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(body.clientOperationId) ||
    !Array.isArray(body.marks) ||
    body.marks.length > 2000
  )
    throw new RequestContractError(400, 'Invalid attendance operation');
  const clientOperationId = body.clientOperationId;
  const marks = body.marks
    .map(value => {
      const row = objectBody(value, ['studentId', 'status']);
      const studentId = objectIdField(row.studentId, 'student ID');
      if (
        row.status !== null &&
        !PERIOD_ATTENDANCE_STATUSES.includes(
          row.status as PeriodAttendanceStatus,
        )
      )
        throw new RequestContractError(400, 'Invalid attendance status');
      return { studentId, status: row.status as PeriodAttendanceStatus | null };
    })
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
  if (new Set(marks.map(m => m.studentId)).size !== marks.length)
    throw new RequestContractError(400, 'Duplicate student marks');
  const authorized = await getTeacherAttendanceSession(identity, id);
  const fingerprint = digest({
    sessionId: id,
    action,
    revision: body.revision,
    rosterVersion: body.rosterVersion,
    marks,
  });
  return mutateOccurrence(
    identity,
    authorized.period.periodId,
    authorized.period.date,
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
    async (session, period, branchId) => {
      requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
      eligible(period);
      await lockLogin(session, identity, token);
      await lockRoster(session, period, branchId);
      const current = await roster(period, branchId);
      const attendance = await AttendanceSession.findOne({
        _id: id,
        ...occurrenceKey(period, branchId),
      }).session(session);
      if (!attendance) throw missing();
      const operationKey = {
        branchId,
        createdBy: identity!.userId,
        clientOperationId,
      };
      const previous = await AttendanceOperation.findOne(operationKey)
        .session(session)
        .lean();
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw conflict(
            'Operation ID was already used for another attendance change.',
          );
        return {
          sessionId: id,
          revision: previous.resultingRevision,
          state: previous.action === 'submit' ? 'submitted' : 'draft',
          replayed: true,
        };
      }
      // Receipt replay remains safe after closure; new marks require current curriculum.
      await requireClassSubject(branchId, period.classId, period.subjectId, session);
      if (current.version !== body.rosterVersion)
        throw conflict('Roster changed. Reload and review before saving.');
      if (
        attendance.revision !== body.revision ||
        attendance.state === 'submitted'
      )
        throw conflict(
          'Attendance changed or was submitted. Reload and review.',
        );
      const rosterIds = new Set(current.rows.map(s => s.studentId));
      if (marks.some(m => !rosterIds.has(m.studentId))) throw missing();
      // Every save is an explicit complete editor snapshot. Null means unmarked,
      // never absent. Draft permits null; finalization rejects it.
      if (
        marks.length !== rosterIds.size ||
        (action === 'submit' && marks.some(m => m.status === null))
      )
        throw new RequestContractError(
          400,
          action === 'submit'
            ? 'Explicitly mark every student before submitting.'
            : 'Include the complete roster, using null for unmarked students.',
        );
      if (action === 'submit' && !marks.length)
        throw new RequestContractError(
          400,
          'An empty roster cannot be submitted.',
        );
      const old = await PeriodAttendanceRecord.find({ attendanceSessionId: id })
        .session(session)
        .select('studentId status')
        .lean();
      const before = new Map(old.map(m => [String(m.studentId), m.status]));
      const revision = attendance.revision + 1,
        now = new Date();
      await PeriodAttendanceRecord.deleteMany({
        attendanceSessionId: id,
        studentId: {
          $nin: marks.filter(m => m.status !== null).map(m => m.studentId),
        },
      }).session(session);
      const explicit = marks.filter(m => m.status !== null);
      if (explicit.length)
        await PeriodAttendanceRecord.collection.bulkWrite(
          explicit.map(m => ({
            updateOne: {
              filter: {
                attendanceSessionId: new mongoose.Types.ObjectId(id),
                studentId: new mongoose.Types.ObjectId(m.studentId),
              },
              update: {
                $set: {
                  status: m.status,
                  markedBy: new mongoose.Types.ObjectId(identity!.userId),
                  markedAt: now,
                  revision,
                  updatedAt: now,
                },
                $setOnInsert: {
                  branchId: new mongoose.Types.ObjectId(branchId),
                  createdAt: now,
                },
              },
              upsert: true,
            },
          })),
          { session },
        );
      const updated = await AttendanceSession.updateOne(
        { _id: id, revision: body.revision, state: { $ne: 'submitted' } },
        {
          $set: {
            revision,
            state: action === 'submit' ? 'submitted' : 'draft',
            rosterVersion: current.version,
            rosterStudentIds: current.rows.map(s => s.studentId),
            responsibleTeacherId: identity!.userId,
            substituteId: period.substituteId,
            ...(action === 'submit'
              ? { submittedAt: now, submittedBy: identity!.userId }
              : {}),
          },
        },
        { session, runValidators: true },
      );
      if (!updated.modifiedCount)
        throw conflict('Attendance changed. Reload and review.');
      await AttendanceOperation.create(
        [
          {
            ...operationKey,
            attendanceSessionId: id,
            fingerprint,
            action,
            resultingRevision: revision,
            changes: [
              ...marks,
              ...old
                .filter(m => !rosterIds.has(String(m.studentId)))
                .map(m => ({ studentId: String(m.studentId), status: null })),
            ]
              .filter(m => (before.get(m.studentId) ?? null) !== m.status)
              .map(m => ({
                studentId: m.studentId,
                before: before.get(m.studentId) ?? null,
                after: m.status,
              })),
          },
        ],
        { session },
      );
      if (action === 'submit')
        await stageSubmittedAbsenceIntents(branchId, id, session);
      if ((await roster(period, branchId)).version !== current.version)
        throw conflict('Roster changed. Reload and review.');
      requirePermission(PERMISSIONS.TEACHER_ATTENDANCE_VIEW);
      return {
        sessionId: id,
        revision,
        state: action === 'submit' ? 'submitted' : 'draft',
        replayed: false,
      };
    },
  );
};
