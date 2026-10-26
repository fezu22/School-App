import mongoose, { Types, type ClientSession } from 'mongoose';
import User from '../models/user';
import Branch from '../models/branch';
import TeacherAssignment from '../models/teacherAssignment';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  TimetableIssue,
} from '../models/timetable';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import { getTeacherScope } from './teacher-scope.service';
import type { JwtPayload } from './jwt.service';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import {
  addScheduleDays,
  scheduleDate,
  scheduleWeekday,
  schoolToday,
  schoolTimezone,
} from './school-date.service';
const allowed = (permission: string) =>
  ROLE_PERMISSIONS.teacher.some(value => value === permission);
const requireAction = (permission: string) => {
  if (!allowed(permission))
    throw new RequestContractError(403, 'Timetable action is not permitted');
};
const missing = () =>
  new RequestContractError(404, 'Timetable period is unavailable');
export interface TeacherPeriodDTO {
  periodId: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  approvedVersion: {
    versionId: string;
    versionNumber: number;
    effectiveFrom: string;
    effectiveUntil: string;
  };
  isSubstitute: boolean;
  substituteId: string | null;
  substituteStatus: 'needs_acknowledgement' | 'acknowledged' | null;
  acknowledgedAt: string | null;
  issueStatus: 'open' | null;
  canAcknowledgeSubstitute: boolean;
  canRequestIssue: boolean;
}
// Sole operational query for screen/detail/actions and future Home. Highest
// approved revision wins per civil day; immutable periods retain old history.
export const getTeacherTimetable = async (
  identity: JwtPayload | undefined,
  requestedDate?: unknown,
  week = false,
) => {
  requireAction(PERMISSIONS.TEACHER_TIMETABLE_VIEW);
  const scope = await getTeacherScope(identity);
  const today = schoolToday(),
    start = requestedDate === undefined ? today : scheduleDate(requestedDate);
  const dates = Array.from({ length: week ? 7 : 1 }, (_, index) =>
    addScheduleDays(start, index),
  );
  type Version = {
    _id: Types.ObjectId;
    versionNumber: number;
    effectiveFrom: string;
    effectiveUntil: string;
  };
  // One indexed match and bounded facets: at most one revision per requested
  // day reaches application memory, regardless of administrative history.
  const [selected] = await TimetableVersion.aggregate<
    Record<string, Version[]>
  >([
    {
      $match: {
        branchId: new Types.ObjectId(scope.branchId),
        status: 'approved',
        effectiveFrom: { $lte: dates[dates.length - 1] },
        effectiveUntil: { $gt: start },
      },
    },
    {
      $facet: Object.fromEntries(
        dates.map(date => [
          date,
          [
            {
              $match: {
                effectiveFrom: { $lte: date },
                effectiveUntil: { $gt: date },
              },
            },
            { $sort: { versionNumber: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 1,
                versionNumber: 1,
                effectiveFrom: 1,
                effectiveUntil: 1,
              },
            },
          ],
        ]),
      ),
    },
  ]).read('primary');
  const effective = new Map(dates.map(date => [date, selected?.[date]?.[0]]));
  const versionIds = [
    ...new Set(
      [...effective.values()]
        .filter(v => v !== undefined)
        .map(v => String(v._id)),
    ),
  ];
  const substitutes = await SubstituteAssignment.find({
    branchId: scope.branchId,
    status: 'approved',
    date: { $in: dates },
    $or: [
      { originalTeacherId: scope.actorId },
      { substituteTeacherId: scope.actorId },
    ],
  })
    .read('primary')
    .select(
      '_id periodId substituteTeacherId date startTime endTime room acknowledgedAt acknowledgedBy',
    )
    .lean();
  const ownSubIds = substitutes
    .filter(s => String(s.substituteTeacherId) === scope.actorId)
    .map(s => s.periodId);
  const periods = await TimetablePeriod.find({
    branchId: scope.branchId,
    timetableVersionId: { $in: versionIds },
    dayOfWeek: { $in: [...new Set(dates.map(scheduleWeekday))] },
    $or: [{ teacherId: scope.actorId }, { _id: { $in: ownSubIds } }],
  })
    .read('primary')
    .select(
      '_id timetableVersionId teacherId classId sectionId subjectId dayOfWeek startTime endTime room',
    )
    .lean();
  const [classes, sections, subjects, issues] = await Promise.all([
    SchoolClass.find({ isActive: true })
      .where('_id')
      .in(periods.map(p => p.classId))
      .where('branchId')
      .equals(scope.branchId)
      .read('primary')
      .select('_id name')
      .lean(),
    Section.find({ isActive: true })
      .where('_id')
      .in(periods.map(p => p.sectionId))
      .where('branchId')
      .equals(scope.branchId)
      .read('primary')
      .select('_id name classId')
      .lean(),
    Subject.find({
      _id: { $in: periods.map(p => p.subjectId) },
      branchId: scope.branchId,
      isActive: true,
    })
      .read('primary')
      .select('_id name')
      .lean(),
    TimetableIssue.find({
      branchId: scope.branchId,
      createdBy: scope.actorId,
      date: { $in: dates },
      periodId: { $in: periods.map(p => p._id) },
    })
      .read('primary')
      .select('periodId date status')
      .lean(),
  ]);
  const classMap = new Map(classes.map(c => [String(c._id), c])),
    sectionMap = new Map(sections.map(s => [String(s._id), s])),
    subjectMap = new Map(subjects.map(s => [String(s._id), s]));
  const replacements = new Map(
    substitutes.map(s => [`${s.periodId}/${s.date}`, s]),
  );
  const rows: TeacherPeriodDTO[] = [];
  for (const date of dates) {
    const version = effective.get(date);
    if (!version) continue;
    for (const period of periods) {
      if (
        String(period.timetableVersionId) !== String(version._id) ||
        period.dayOfWeek !== scheduleWeekday(date)
      )
        continue;
      const c = classMap.get(String(period.classId)),
        s = sectionMap.get(String(period.sectionId)),
        sub = subjectMap.get(String(period.subjectId));
      if (!c || !s || !sub || String(s.classId) !== String(c._id)) continue;
      const replacement = replacements.get(`${period._id}/${date}`);
      const isSubstitute =
        replacement !== undefined &&
        String(replacement.substituteTeacherId) === scope.actorId;
      // An approved replacement removes the original operational occurrence.
      if (replacement && !isSubstitute) continue;
      if (
        !isSubstitute &&
        (String(period.teacherId) !== scope.actorId ||
          !scope.tuples.some(
            t =>
              t.classId === String(c._id) &&
              t.sectionId === String(s._id) &&
              t.subjectId === String(sub._id),
          ))
      )
        continue;
      const acknowledgedAt = replacement?.acknowledgedAt?.toISOString() ?? null;
      const issueStatus = issues.some(
        i => String(i.periodId) === String(period._id) && i.date === date,
      )
        ? 'open'
        : null;
      rows.push({
        periodId: String(period._id),
        date,
        startTime: replacement?.startTime ?? period.startTime,
        endTime: replacement?.endTime ?? period.endTime,
        room: replacement?.room ?? period.room,
        classId: String(c._id),
        className: c.name,
        sectionId: String(s._id),
        sectionName: s.name,
        subjectId: String(sub._id),
        subjectName: sub.name,
        approvedVersion: {
          versionId: String(version._id),
          versionNumber: version.versionNumber,
          effectiveFrom: version.effectiveFrom,
          effectiveUntil: version.effectiveUntil,
        },
        isSubstitute,
        substituteId: isSubstitute ? String(replacement!._id) : null,
        substituteStatus: isSubstitute
          ? acknowledgedAt
            ? 'acknowledged'
            : 'needs_acknowledgement'
          : null,
        acknowledgedAt,
        issueStatus,
        canAcknowledgeSubstitute:
          isSubstitute &&
          !acknowledgedAt &&
          date === today &&
          allowed(PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE),
        canRequestIssue: allowed(PERMISSIONS.TEACHER_TIMETABLE_ISSUE),
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.periodId.localeCompare(b.periodId),
  );
  return {
    timezone: schoolTimezone(),
    today,
    start,
    end: dates[dates.length - 1],
    periods: rows,
  };
};
export const getTeacherPeriod = async (
  identity: JwtPayload | undefined,
  id: unknown,
  date: unknown,
) => {
  const periodId = objectIdField(id, 'period ID');
  const queue = await getTeacherTimetable(identity, scheduleDate(date));
  const row = queue.periods.find(p => p.periodId === periodId);
  if (!row) throw missing();
  return row;
};

/** Real metadata writes fence concurrent state changes until transaction commit.
 * Aborts roll back fences and domain writes together. */
const fence = async (
  session: ClientSession,
  collection: string,
  id: string,
) => {
  const result = await mongoose.connection
    .collection(collection)
    .updateOne(
      { _id: new Types.ObjectId(id) },
      { $inc: { __v: 1 } },
      { session },
    );
  if (!result.matchedCount) throw missing();
};

// Publishers share these fences to prevent a newly approved winner/replacement
// from appearing between Teacher authorization and commit (a phantom read).
export const withTimetablePublication = async <T>(
  branchId: string,
  periodId: string | undefined,
  publish: (session: ClientSession) => Promise<T>,
): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(async () => {
      await fence(session, Branch.collection.name, branchId);
      if (periodId)
        await fence(session, TimetablePeriod.collection.name, periodId);
      return publish(session);
    }))!;
  } finally {
    await session.endSession();
  }
};

export const mutateOccurrence = async <T = TeacherPeriodDTO>(
  identity: JwtPayload | undefined,
  id: unknown,
  date: unknown,
  permission: string,
  write: (
    session: ClientSession,
    period: TeacherPeriodDTO,
    branchId: string,
  ) => Promise<T>,
) => {
  requireAction(permission);
  const initial = await getTeacherPeriod(identity, id, date);
  const scope = await getTeacherScope(identity);
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(
      async () => {
        await fence(session, User.collection.name, identity!.userId);
        await fence(session, Branch.collection.name, scope.branchId);
        await fence(session, TimetablePeriod.collection.name, initial.periodId);
        await fence(
          session,
          TimetableVersion.collection.name,
          initial.approvedVersion.versionId,
        );
        await fence(session, SchoolClass.collection.name, initial.classId);
        await fence(session, Section.collection.name, initial.sectionId);
        await fence(session, Subject.collection.name, initial.subjectId);
        if (initial.substituteId)
          await fence(
            session,
            SubstituteAssignment.collection.name,
            initial.substituteId,
          );
        for (const tuple of scope.tuples.filter(
          t =>
            t.classId === initial.classId &&
            t.sectionId === initial.sectionId &&
            t.subjectId === initial.subjectId,
        )) {
          await fence(
            session,
            TeacherAssignment.collection.name,
            tuple.assignmentId,
          );
        }
        // Committed reads after acquiring locks observe any pre-lock change.
        // Fences alter only internal revision counters, never operational fields.
        const currentScope = await getTeacherScope(identity);
        if (currentScope.branchId !== scope.branchId) throw missing();
        const lockedAssignments = scope.tuples
          .filter(
            t =>
              t.classId === initial.classId &&
              t.sectionId === initial.sectionId &&
              t.subjectId === initial.subjectId,
          )
          .map(t => t.assignmentId);
        if (
          !initial.isSubstitute &&
          !currentScope.tuples.some(t =>
            lockedAssignments.includes(t.assignmentId),
          )
        )
          throw missing();
        const current = await getTeacherPeriod(
          identity,
          initial.periodId,
          initial.date,
        );
        if (
          current.approvedVersion.versionId !==
            initial.approvedVersion.versionId ||
          current.substituteId !== initial.substituteId
        )
          throw missing();
        requireAction(permission);
        const result = await write(session, current, currentScope.branchId);
        requireAction(permission);
        const finalScope = await getTeacherScope(identity);
        if (
          finalScope.branchId !== scope.branchId ||
          (!initial.isSubstitute &&
            !finalScope.tuples.some(t =>
              lockedAssignments.includes(t.assignmentId),
            ))
        )
          throw missing();
        await getTeacherPeriod(identity, initial.periodId, initial.date);
        requireAction(PERMISSIONS.TEACHER_TIMETABLE_VIEW);
        requireAction(permission);
        if (
          permission === PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE &&
          current.date !== schoolToday()
        )
          throw missing();
        return result;
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    ))!;
  } finally {
    await session.endSession();
  }
};

export const acknowledgeTeacherSubstitute = async (
  identity: JwtPayload | undefined,
  id: unknown,
  date: unknown,
) =>
  mutateOccurrence(
    identity,
    id,
    date,
    PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE,
    async (session, period) => {
      if (!period.isSubstitute || period.date !== schoolToday())
        throw missing();
      const acknowledgedAt = period.acknowledgedAt ?? new Date().toISOString();
      await SubstituteAssignment.updateOne(
        {
          _id: period.substituteId,
          status: 'approved',
          date: period.date,
          substituteTeacherId: identity!.userId,
          acknowledgedAt: { $exists: false },
        },
        {
          $set: {
            acknowledgedAt: new Date(acknowledgedAt),
            acknowledgedBy: identity!.userId,
          },
        },
        { session },
      );
      if (period.date !== schoolToday()) throw missing();
      return {
        ...period,
        acknowledgedAt,
        substituteStatus: 'acknowledged',
        canAcknowledgeSubstitute: false,
      };
    },
  );

export const requestTeacherTimetableIssue = async (
  identity: JwtPayload | undefined,
  id: unknown,
  date: unknown,
  reason: unknown,
  operation: unknown,
) => {
  const safeReason = textField(reason, 'reason', 500, 1);
  if (
    typeof operation !== 'string' ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(operation)
  )
    throw new RequestContractError(400, 'Invalid client operation ID');
  return mutateOccurrence(
    identity,
    id,
    date,
    PERMISSIONS.TEACHER_TIMETABLE_ISSUE,
    async (session, period, branchId) => {
      const key = {
        branchId,
        createdBy: identity!.userId,
        clientOperationId: operation,
      };
      const existing = await TimetableIssue.findOne(key)
        .session(session)
        .lean();
      if (
        existing &&
        (String(existing.periodId) !== period.periodId ||
          existing.date !== period.date ||
          existing.reason !== safeReason)
      )
        throw new RequestContractError(
          409,
          'Operation ID already used for another issue',
        );
      await TimetableIssue.updateOne(
        key,
        {
          $setOnInsert: {
            periodId: period.periodId,
            date: period.date,
            substituteId: period.substituteId ?? undefined,
            reason: safeReason,
            status: 'open',
          },
        },
        { session, upsert: true, runValidators: true },
      );
      return { ...period, issueStatus: 'open' };
    },
  );
};
