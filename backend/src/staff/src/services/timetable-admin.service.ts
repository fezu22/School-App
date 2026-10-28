import Room from '../models/room';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
} from '../models/timetable';
import User from '../models/user';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment from '../models/teacherAssignment';
import {Types} from 'mongoose';
import type {ClientSession} from 'mongoose';
import {requireClassSubject} from './class-subject-context.service';
import {withAcademicCatalogLock} from './academic-catalog-lock.service';
import {requireAcademicBranch, schoolBranchFilter, schoolUserFilter} from './school-authority.service';
import { withTimetablePublication } from './teacher-timetable.service';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
  getTeacherScope,
} from './teacher-scope.service';
import type { JwtPayload } from './jwt.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import {
  scheduleDate,
  scheduleWeekday,
  addScheduleDays,
  schoolTimezone,
  schoolToday,
} from './school-date.service';
const missing = () =>
  new RequestContractError(404, 'Timetable reference not found');
const actorFor = async (
  identity: JwtPayload | undefined,
  session?: ClientSession
) => {
  const actor = await currentAcademicActor(identity, session);
  if (
    !['principal', 'super_admin'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.TIMETABLE_MANAGE)
  )
    throw new RequestContractError(
      403,
      'Timetable management is not permitted'
    );
  if (actor.role === 'principal')
    await requireActiveAcademicBranch(actor.branchId?.toString());
  if (actor.role === 'super_admin' && actor.branchId)
    throw new RequestContractError(
      403,
      'Global Super Admin authority is required'
    );
  return actor;
};
const branchFor = async (
  actor: Awaited<ReturnType<typeof actorFor>>,
  requested: unknown,
  session?: ClientSession,
) => {
  const branchId = objectIdField(
    requested ?? actor.branchId?.toString(),
    'branch ID'
  );
  if (actor.role === 'principal' && String(actor.branchId) !== branchId)
    throw new RequestContractError(
      403,
      'Timetable branch scope is not permitted'
    );
  await requireAcademicBranch(actor, branchId, session);
  return branchId;
};
const mutationActor = async (
  identity: JwtPayload | undefined,
  branchId: string,
  session: ClientSession
) => {
  if (!identity) throw new RequestContractError(401, 'Authentication required');
  await User.collection.updateOne(
    { _id: new Types.ObjectId(identity.userId) },
    { $inc: { __v: 1 } },
    { session }
  );
  const actor = await actorFor(identity, session);
  await branchFor(actor, branchId, session);
  return actor;
};

const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new RequestContractError(400, 'Invalid schedule number');
  return value;
};
const times = (start: unknown, end: unknown) => {
  const startTime = textField(start, 'start time', 5, 5),
    endTime = textField(end, 'end time', 5, 5);
  if (
    ![startTime, endTime].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) ||
    startTime >= endTime
  )
    throw new RequestContractError(400, 'Invalid period time window');
  return { startTime, endTime };
};
const duplicate = (error: unknown): never => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 11000
  )
    throw new RequestContractError(
      409,
      'Schedule revision or approved substitute already exists',
    );
  throw error;
};
type Slot = {
  teacherId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId?: unknown;
  room: string;
};

// Read contracts for the existing immutable version editor. Authority is the
// same DB-backed authority used by writes; client role/branch are never trusted.
export const timetableOptions = async (
  identity: JwtPayload | undefined,
  query: Record<string, unknown>
) => {
  const actor = await actorFor(identity);
  const branchQuery = Branch.find({ isActive: true, active: {$ne: false}, ...schoolBranchFilter(actor) });
  if (actor.role === 'principal')
    branchQuery.where('_id').equals(actor.branchId);
  const branches = await branchQuery
    .select('_id name')
    .sort({ name: 1 })
    .lean();
  const requested = query.branchId ?? actor.branchId?.toString();
  const branchId =
    requested === undefined ? null : await branchFor(actor, requested);
  const offset =
    query.offset === undefined ? 0 : integer(Number(query.offset), 0, 100000);
  let eligibleIds: Types.ObjectId[] | undefined;
  let assignmentContext: Record<string, Types.ObjectId> | undefined;
  const eligibilityAt = new Date();
  if (
    [query.classId, query.sectionId, query.subjectId].some(
      (value) => value !== undefined
    )
  ) {
    if (!branchId)
      throw new RequestContractError(400, 'Select an active Branch first');
    const classId = objectIdField(query.classId, 'class ID'),
      sectionId = objectIdField(query.sectionId, 'section ID'),
      subjectId = objectIdField(query.subjectId, 'subject ID');
    await requireClassSubject(branchId, classId, subjectId);
    if (
      !(await Section.exists({ isActive: true })
        .where('_id')
        .equals(sectionId)
        .where('branchId')
        .equals(branchId)
        .where('classId')
        .equals(classId))
    )
      throw missing();
    assignmentContext = Object.fromEntries(
      Object.entries({ branchId, classId, sectionId, subjectId }).map(
        ([key, value]) => [key, new Types.ObjectId(value)]
      )
    );
    const now = eligibilityAt;
    const assignments = await TeacherAssignment.find({
      isActive: true,
      validFrom: { $lte: now },
      $or: [{ validUntil: { $exists: false } }, { validUntil: { $gt: now } }],
    })
      .where('branchId')
      .equals(branchId)
      .where('classId')
      .equals(classId)
      .where('sectionId')
      .equals(sectionId)
      .where('subjectId')
      .equals(subjectId)
      .select('teacherId')
      .lean();
    eligibleIds = assignments.map((a) => a.teacherId);
  }
  const teacherQuery = () => {
    const queryForTeachers = User.find({ role: 'teacher', isActive: true, ...schoolUserFilter(actor) })
      .where('branchId')
      .equals(branchId);
    if (eligibleIds) queryForTeachers.where('_id').in(eligibleIds);
    return queryForTeachers;
  };
  const teachers = branchId
    ? await teacherQuery()
        .select('_id fullName')
        .sort({ fullName: 1, _id: 1 })
        .skip(offset)
        .limit(50)
        .lean()
    : [];
  const total = branchId ? await teacherQuery().countDocuments() : 0;
  // Diagnose only the authorized exact tuple. Do not return unrelated Teachers
  // or treat history/future assignments as current scheduling authority.
  const teacherEligibility = assignmentContext
    ? { asOf: eligibilityAt.toISOString(), reasons: [] as string[] }
    : undefined;
  if (assignmentContext && teacherEligibility && total === 0) {
    const states = await TeacherAssignment.aggregate<{
      _id: string;
      count: number;
    }>([
      { $match: assignmentContext },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                {
                  case: { $ne: ['$isActive', true] },
                  then: 'inactive_assignment',
                },
                {
                  case: { $gt: ['$validFrom', eligibilityAt] },
                  then: 'future_assignment',
                },
                {
                  case: {
                    $and: [
                      { $ne: [{ $type: '$validUntil' }, 'missing'] },
                      { $lte: ['$validUntil', eligibilityAt] },
                    ],
                  },
                  then: 'expired_assignment',
                },
              ],
              default: 'teacher_unavailable',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    teacherEligibility.reasons = states.length
      ? states.map((state) => state._id)
      : ['no_exact_assignment'];
  }
  const tuples = [];
  if (query.teacherId !== undefined) {
    const teacherId = objectIdField(query.teacherId, 'teacher ID');
    if (
      !branchId ||
      !(await User.exists({ role: 'teacher', isActive: true })
        .where('branchId')
        .equals(branchId)
        .where('_id')
        .equals(teacherId))
    )
      throw missing();
    const scope = await getTeacherScope({ userId: teacherId, role: 'teacher' });
    for (const tuple of scope.tuples) {
      try {
        const context = await requireClassSubject(
          branchId,
          tuple.classId,
          tuple.subjectId
        );
        tuples.push({
          ...tuple,
          academicPeriodId: String(context.period._id),
          academicPeriodName: context.period.name,
        });
      } catch (error) {
        if (
          !(error instanceof RequestContractError) ||
          ![404, 409].includes(error.status)
        )
          throw error;
      }
    }
  }
  return {
    branches: branches.map((b) => ({ id: String(b._id), name: b.name })),
    branchId,
    branchFixed: actor.role === 'principal',
    timezone: schoolTimezone(),
    today: schoolToday(),
    teachers: teachers.map((t) => ({ id: String(t._id), name: t.fullName })),
    teacherEligibility,
    nextTeacherOffset:
      offset + teachers.length < total ? offset + teachers.length : null,
    tuples,
  };
};

export const listTimetableVersions = async (
  identity: JwtPayload | undefined,
  query: Record<string, unknown>
) => {
  const actor = await actorFor(identity),
    branchId = await branchFor(actor, query.branchId);
  const offset =
    query.offset === undefined ? 0 : integer(Number(query.offset), 0, 100000);
  const today = schoolToday();
  const [versions, latest, total, current] = await Promise.all([
    TimetableVersion.find({ branchId })
      .sort({ versionNumber: -1 })
      .skip(offset)
      .limit(10)
      .lean(),
    TimetableVersion.findOne({ branchId })
      .sort({ versionNumber: -1 })
      .select('versionNumber')
      .lean(),
    TimetableVersion.countDocuments({ branchId }),
    TimetableVersion.findOne({
      branchId,
      status: 'approved',
      effectiveFrom: { $lte: today },
      effectiveUntil: { $gt: today },
    })
      .sort({ versionNumber: -1 })
      .select('_id versionNumber effectiveFrom effectiveUntil')
      .lean(),
  ]);
  const periods = await TimetablePeriod.find({
    branchId,
    timetableVersionId: { $in: versions.map((v) => v._id) },
  })
    .sort({ dayOfWeek: 1, startTime: 1, _id: 1 })
    .lean();
  const [teachers, classes, sections, subjects] = await Promise.all([
    User.find()
      .where('_id')
      .in(periods.map((p) => p.teacherId))
      .where('branchId')
      .equals(branchId)
      .select('_id fullName')
      .lean(),
    SchoolClass.find()
      .where('_id')
      .in(periods.map((p) => p.classId))
      .where('branchId')
      .equals(branchId)
      .select('_id name')
      .lean(),
    Section.find()
      .where('_id')
      .in(periods.map((p) => p.sectionId))
      .where('branchId')
      .equals(branchId)
      .select('_id name')
      .lean(),
    Subject.find()
      .where('_id')
      .in(periods.map((p) => p.subjectId))
      .where('branchId')
      .equals(branchId)
      .select('_id name')
      .lean(),
  ]);
  return {
    currentVersion: current
      ? {
          versionId: String(current._id),
          versionNumber: current.versionNumber,
          effectiveFrom: current.effectiveFrom,
          effectiveUntil: current.effectiveUntil,
        }
      : null,
    nextVersionNumber: (latest?.versionNumber ?? 0) + 1,
    nextOffset:
      offset + versions.length < total ? offset + versions.length : null,
    items: versions.map((v) => ({
      versionId: String(v._id),
      versionNumber: v.versionNumber,
      status: v.status,
      effectiveFrom: v.effectiveFrom,
      effectiveUntil: v.effectiveUntil,
      periods: periods
        .filter((p) => String(p.timetableVersionId) === String(v._id))
        .map((p) => ({
          periodId: String(p._id),
          teacherId: String(p.teacherId),
          classId: String(p.classId),
          sectionId: String(p.sectionId),
          subjectId: String(p.subjectId),
          dayOfWeek: p.dayOfWeek,
          startTime: p.startTime,
          endTime: p.endTime,
          roomId: p.roomId ? String(p.roomId) : undefined,
          room: p.room,
          teacherName:
            teachers.find((t) => String(t._id) === String(p.teacherId))
              ?.fullName ?? 'Unavailable Teacher',
          className:
            classes.find((c) => String(c._id) === String(p.classId))?.name ??
            'Unavailable Class',
          sectionName:
            sections.find((s) => String(s._id) === String(p.sectionId))?.name ??
            'Unavailable Section',
          subjectName:
            subjects.find((s) => String(s._id) === String(p.subjectId))?.name ??
            'Unavailable Subject',
        })),
    })),
  };
};

const requireRoom = async (
  branchId: string,
  roomId: unknown,
  session?: ClientSession
) => {
  const id = objectIdField(
    roomId === undefined ? undefined : String(roomId),
    'Room ID'
  );
  const room = await Room.findOne({ _id: id, branchId, isActive: true })
    .session(session ?? null)
    .lean();
  if (!room)
    throw new RequestContractError(404, 'Room is unavailable in this Branch');
  return { roomId: id, room: room.name };
};
const validateResponsibilities = async (
  branchId: string,
  slots: Slot[],
  session?: ClientSession,
  requireRoomIds = false
) => {
  const roomIds = [
    ...new Set(
      slots
        .filter((slot) => slot.roomId)
        .map((slot) => objectIdField(String(slot.roomId), 'Room ID'))
    ),
  ];
  const roomRows = roomIds.length
    ? await Room.find({ branchId, isActive: true })
        .where('_id')
        .in(roomIds)
        .session(session ?? null)
        .lean()
    : [];
  const roomNames = new Map(
    roomRows.map((room) => [String(room._id), room.name])
  );
  const teachers = [...new Set(slots.map((p) => p.teacherId))];
  if (session)
    for (const teacherId of teachers)
      await User.collection.updateOne(
        { _id: new Types.ObjectId(teacherId) },
        { $inc: { __v: 1 } },
        { session }
      );
  const scopes = new Map(
    await Promise.all(
      teachers.map(
        async (teacherId) =>
          [
            teacherId,
            await getTeacherScope({ userId: teacherId, role: 'teacher' }),
          ] as const
      )
    )
  );
  for (const slot of slots) {
    times(slot.startTime, slot.endTime);
    integer(slot.dayOfWeek, 0, 6);
    if (slot.roomId) {
      const name = roomNames.get(String(slot.roomId));
      if (!name)
        throw new RequestContractError(
          404,
          'Room is unavailable in this Branch'
        );
      if (!slot.room) slot.room = name;
    } else if (requireRoomIds)
      throw new RequestContractError(
        409,
        'Legacy draft periods require a canonical Room before publication; revise this schedule and select Rooms'
      );
    await requireClassSubject(branchId, slot.classId, slot.subjectId, session);
    const scope = scopes.get(slot.teacherId)!;
    const assignment = scope.tuples.find(
      (t) =>
        t.classId === slot.classId &&
        t.sectionId === slot.sectionId &&
        t.subjectId === slot.subjectId
    );
    if (scope.branchId !== branchId || !assignment) throw missing();
    if (session) {
      const now = new Date();
      const fenced = await TeacherAssignment.collection.updateOne(
        {
          _id: new Types.ObjectId(assignment.assignmentId),
          isActive: true,
          validFrom: { $lte: now },
          $or: [
            { validUntil: { $exists: false } },
            { validUntil: { $gt: now } },
          ],
        },
        { $inc: { __v: 1 } },
        { session }
      );
      if (!fenced.matchedCount) throw missing();
    }
  }
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i],
        b = slots[j];
      if (
        a.dayOfWeek === b.dayOfWeek &&
        a.startTime < b.endTime &&
        b.startTime < a.endTime &&
        (a.teacherId === b.teacherId ||
          a.sectionId === b.sectionId ||
          (a.roomId && b.roomId
            ? String(a.roomId) === String(b.roomId)
            : a.room.trim().toLowerCase() === b.room.trim().toLowerCase()))
      )
        throw new RequestContractError(
          409,
          `Conflicting periods in this version: periods ${i + 1} and ${
            j + 1
          } overlap (${a.startTime}–${a.endTime}, ${b.startTime}–${
            b.endTime
          }) for the same ${
            a.teacherId === b.teacherId
              ? 'Teacher'
              : a.sectionId === b.sectionId
              ? 'Class/Section'
              : 'Room'
          }.`
        );
    }
};

const validateReplacement = async (
  branchId: string,
  period: {
    _id: unknown;
    timetableVersionId: unknown;
    teacherId: unknown;
    classId: unknown;
    sectionId: unknown;
    subjectId: unknown;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    room: string;
  },
  teacherId: string,
  date: string,
  session: ClientSession
) => {
  const winner = await TimetableVersion.findOne({
    branchId,
    status: 'approved',
    effectiveFrom: { $lte: date },
    effectiveUntil: { $gt: date },
  })
    .sort({ versionNumber: -1 })
    .session(session)
    .lean();
  if (
    String(winner?._id) !== String(period.timetableVersionId) ||
    period.dayOfWeek !== scheduleWeekday(date)
  )
    throw missing();
  await validateResponsibilities(
    branchId,
    [
      {
        ...period,
        teacherId: String(period.teacherId),
        classId: String(period.classId),
        sectionId: String(period.sectionId),
        subjectId: String(period.subjectId),
      },
    ],
    session
  );
  const target = await User.collection.updateOne(
    {
      _id: new Types.ObjectId(teacherId),
      role: 'teacher',
      isActive: true,
      branchId: new Types.ObjectId(branchId),
    },
    { $inc: { __v: 1 } },
    { session }
  );
  if (!target.matchedCount) throw missing();
  // A Branch match alone cannot authorize an imported or reassigned Teacher
  // whose persisted school conflicts with that Branch. Fence the same canonical
  // actor ownership used for normal Teacher responsibility checks.
  try {
    const teacher = await currentAcademicActor({userId: teacherId, role: 'teacher'}, session);
    if (String(teacher.branchId) !== branchId) throw missing();
  } catch {
    throw missing();
  }
};

export const createTimetableVersion = async (
  identity: JwtPayload | undefined,
  body: unknown,
) => {
  const actor = await actorFor(identity);
  const input = objectBody(body, [
    'branchId',
    'versionNumber',
    'effectiveFrom',
    'effectiveUntil',
    'periods',
  ]);
  const branchId = await branchFor(actor, input.branchId);
  const versionNumber = integer(input.versionNumber, 1, 1000000);
  const effectiveFrom = scheduleDate(input.effectiveFrom),
    effectiveUntil = scheduleDate(input.effectiveUntil);
  if (
    effectiveUntil <= effectiveFrom ||
    effectiveUntil > addScheduleDays(effectiveFrom, 366)
  )
    throw new RequestContractError(
      400,
      'Version window must be positive and at most 366 days',
    );
  if (
    !Array.isArray(input.periods) ||
    !input.periods.length ||
    input.periods.length > 500
  )
    throw new RequestContractError(400, 'Expected 1 to 500 periods');
  const slots: Slot[] = input.periods.map(value => {
    const p = objectBody(value, [
      'teacherId',
      'classId',
      'sectionId',
      'subjectId',
      'dayOfWeek',
      'startTime',
      'endTime',
      'room',
      'roomId',
    ]);
    return {
      teacherId: objectIdField(p.teacherId, 'teacher ID'),
      classId: objectIdField(p.classId, 'class ID'),
      sectionId: objectIdField(p.sectionId, 'section ID'),
      subjectId: objectIdField(p.subjectId, 'subject ID'),
      dayOfWeek: integer(p.dayOfWeek, 0, 6),
      ...times(p.startTime, p.endTime),
      roomId: p.roomId === undefined ? undefined : objectIdField(p.roomId, 'Room ID'),
      room: '',
    };
  });
  await validateResponsibilities(branchId, slots);
  if (slots.some(slot => !slot.roomId)) throw new RequestContractError(400, 'Select a canonical Room for every new period');
  await TimetableVersion.collection.createIndex(
    { branchId: 1, versionNumber: 1 },
    { unique: true },
  );
  try {
    return await withAcademicCatalogLock(branchId, async session => {
    await mutationActor(identity, branchId, session);
    await validateResponsibilities(branchId, slots, session);
    const [version] = await TimetableVersion.create([{
      branchId,
      versionNumber,
      effectiveFrom,
      effectiveUntil,
      periodCount: slots.length,
      createdBy: actor._id,
    }], {session});
    await TimetablePeriod.insertMany(
      slots.map(p => ({ ...p, branchId, timetableVersionId: version._id })),
      {session},
    );
    return { versionId: String(version._id), status: version.status };
    });
  } catch (error) {
    return duplicate(error);
  }
};
export const approveTimetableVersion = async (
  identity: JwtPayload | undefined,
  id: unknown
) => {
  const actor = await actorFor(identity),
    versionId = objectIdField(id, 'version ID');
  const version = await TimetableVersion.findById(versionId).lean();
  if (!version) throw missing();
  await branchFor(actor, String(version.branchId));
  if (version.status !== 'draft')
    throw new RequestContractError(409, 'Only a draft may be approved');
  const periods = await TimetablePeriod.find({
    timetableVersionId: version._id,
    branchId: version.branchId,
  })
    .select(
      'teacherId classId sectionId subjectId dayOfWeek startTime endTime room roomId'
    )
    .lean();
  if (periods.length !== version.periodCount)
    throw new RequestContractError(409, 'Incomplete draft cannot be approved');
  await validateResponsibilities(
    String(version.branchId),
    periods.map((p) => ({
      ...p,
      teacherId: String(p.teacherId),
      classId: String(p.classId),
      sectionId: String(p.sectionId),
      subjectId: String(p.subjectId),
    })),
    undefined,
    true
  );
  const updated = await withTimetablePublication(
    String(version.branchId),
    undefined,
    async (session) => {
      await mutationActor(identity, String(version.branchId), session);
      await validateResponsibilities(
        String(version.branchId),
        periods.map((p) => ({
          ...p,
          teacherId: String(p.teacherId),
          classId: String(p.classId),
          sectionId: String(p.sectionId),
          subjectId: String(p.subjectId),
        })),
        session,
        true
      );
      return TimetableVersion.findOneAndUpdate(
        { _id: version._id, status: 'draft' },
        {
          $set: {
            status: 'approved',
            approvedBy: actor._id,
            approvedAt: new Date(),
          },
        },
        { returnDocument: 'after', session }
      );
    }
  );
  if (!updated) throw new RequestContractError(409, 'Version state changed');
  return { versionId: String(updated._id), status: updated.status };
};
// Publication and catalog writers serialize on Branch, including room overrides.
const validateSubstituteRoom = async (
  branchId: string,
  period: { _id: unknown; timetableVersionId: unknown; dayOfWeek: number },
  replacement: {
    roomId?: unknown;
    room: string;
    startTime: string;
    endTime: string;
    date: string;
  },
  session: ClientSession
) => {
  const periods = await TimetablePeriod.find({
    branchId,
    timetableVersionId: new Types.ObjectId(String(period.timetableVersionId)),
    dayOfWeek: period.dayOfWeek,
  })
    .session(session)
    .lean();
  const overrides = await SubstituteAssignment.find({
    branchId,
    date: replacement.date,
    status: 'approved',
  })
    .session(session)
    .lean();
  for (const base of periods) {
    if (String(base._id) === String(period._id)) continue;
    const other =
      overrides.find((row) => String(row.periodId) === String(base._id)) ??
      base;
    const sameRoom =
      other.roomId && replacement.roomId
        ? String(other.roomId) === String(replacement.roomId)
        : other.room.trim().toLowerCase() ===
          replacement.room.trim().toLowerCase();
    if (
      sameRoom &&
      replacement.startTime < other.endTime &&
      other.startTime < replacement.endTime
    )
      throw new RequestContractError(
        409,
        'Room conflict: another scheduled period occupies this Room during the substitution'
      );
  }
};

export const createSubstitute = async (
  identity: JwtPayload | undefined,
  body: unknown
) => {
  const actor = await actorFor(identity),
    input = objectBody(body, [
      'periodId',
      'substituteTeacherId',
      'date',
      'startTime',
      'endTime',
      'room',
      'roomId',
    ]);
  const periodId = objectIdField(input.periodId, 'period ID'),
    substituteTeacherId = objectIdField(
      input.substituteTeacherId,
      'substitute Teacher ID'
    );
  const period = await TimetablePeriod.findById(periodId).lean();
  if (!period) throw missing();
  const branchId = await branchFor(actor, String(period.branchId));
  const date = scheduleDate(input.date),
    clock = times(input.startTime, input.endTime);
  const version = await TimetableVersion.findOne({
    _id: period.timetableVersionId,
    branchId,
    status: 'approved',
    effectiveFrom: { $lte: date },
    effectiveUntil: { $gt: date },
  }).lean();
  if (!version || period.dayOfWeek !== scheduleWeekday(date)) throw missing();
  const teacher = await User.findOne({ role: 'teacher', isActive: true })
    .where('_id')
    .equals(substituteTeacherId)
    .where('branchId')
    .equals(branchId)
    .select('_id')
    .lean();
  if (!teacher) throw missing();
  await validateResponsibilities(branchId, [
    {
      ...period,
      teacherId: String(period.teacherId),
      classId: String(period.classId),
      sectionId: String(period.sectionId),
      subjectId: String(period.subjectId),
    },
  ]);
  return withAcademicCatalogLock(branchId, async (session) => {
    await mutationActor(identity, branchId, session);
    await validateReplacement(
      branchId,
      period,
      substituteTeacherId,
      date,
      session
    );
    const resolvedRoom = await requireRoom(branchId, input.roomId, session);
    await validateSubstituteRoom(
      branchId,
      period,
      { ...clock, ...resolvedRoom, date },
      session
    );
    const [substitute] = await SubstituteAssignment.create(
      [
        {
          branchId,
          periodId,
          originalTeacherId: period.teacherId,
          substituteTeacherId,
          date,
          ...clock,
          ...resolvedRoom,
          createdBy: actor._id,
        },
      ],
      { session }
    );
    return { substituteId: String(substitute._id), status: substitute.status };
  });
};
export const approveSubstitute = async (
  identity: JwtPayload | undefined,
  id: unknown
) => {
  const actor = await actorFor(identity),
    substituteId = objectIdField(id, 'substitute ID');
  const substitute = await SubstituteAssignment.findById(substituteId).lean();
  if (!substitute) throw missing();
  const branchId = await branchFor(actor, String(substitute.branchId));
  if (substitute.status !== 'draft')
    throw new RequestContractError(409, 'Only a draft may be approved');
  const period = await TimetablePeriod.findOne({
    _id: substitute.periodId,
    branchId,
  }).lean();
  const version =
    period &&
    (await TimetableVersion.findOne({
      _id: period.timetableVersionId,
      branchId,
      status: 'approved',
      effectiveFrom: { $lte: substitute.date },
      effectiveUntil: { $gt: substitute.date },
    }).lean());
  const winner = await TimetableVersion.findOne({
    branchId,
    status: 'approved',
    effectiveFrom: { $lte: substitute.date },
    effectiveUntil: { $gt: substitute.date },
  })
    .sort({ versionNumber: -1 })
    .select('_id')
    .lean();
  if (
    !period ||
    !version ||
    String(winner?._id) !== String(version._id) ||
    period.dayOfWeek !== scheduleWeekday(substitute.date) ||
    !(await User.exists({ role: 'teacher', isActive: true })
      .where('_id')
      .equals(substitute.substituteTeacherId)
      .where('branchId')
      .equals(branchId))
  )
    throw missing();
  await validateResponsibilities(branchId, [
    {
      ...period,
      teacherId: String(period.teacherId),
      classId: String(period.classId),
      sectionId: String(period.sectionId),
      subjectId: String(period.subjectId),
    },
  ]);
  await SubstituteAssignment.collection.createIndex(
    { periodId: 1, date: 1 },
    {
      unique: true,
      partialFilterExpression: { status: 'approved' },
      name: 'one_approved_substitute',
    }
  );
  try {
    const updated = await withTimetablePublication(
      branchId,
      String(period._id),
      async (session) => {
        await mutationActor(identity, branchId, session);
        await validateReplacement(
          branchId,
          period,
          String(substitute.substituteTeacherId),
          substitute.date,
          session
        );
        await requireRoom(branchId, substitute.roomId, session);
        await validateSubstituteRoom(branchId, period, substitute, session);
        return SubstituteAssignment.findOneAndUpdate(
          { _id: substitute._id, status: 'draft' },
          {
            $set: {
              status: 'approved',
              approvedBy: actor._id,
              approvedAt: new Date(),
            },
          },
          { returnDocument: 'after', session }
        );
      }
    );
    if (!updated)
      throw new RequestContractError(409, 'Substitute state changed');
    return { substituteId: String(updated._id), status: updated.status };
  } catch (error) {
    return duplicate(error);
  }
};

export const retireSchedule = async (
  identity: JwtPayload | undefined,
  id: unknown,
  substitute: boolean
) => {
  const actor = await actorFor(identity),
    objectId = objectIdField(id, 'schedule ID');
  const record = substitute
    ? await SubstituteAssignment.findById(objectId)
        .select('_id branchId status periodId')
        .lean()
    : await TimetableVersion.findById(objectId)
        .select('_id branchId status')
        .lean();
  if (!record) throw missing();
  await branchFor(actor, String(record.branchId));
  const update = {
    $set: { status: 'retired', retiredBy: actor._id, retiredAt: new Date() },
  };
  const result = await withTimetablePublication(
    String(record.branchId),
    undefined,
    async (session) => {
      await mutationActor(identity, String(record.branchId), session);
      return substitute
        ? await SubstituteAssignment.updateOne(
            { _id: record._id, status: 'approved' },
            update,
            { session }
          )
        : await TimetableVersion.updateOne(
            { _id: record._id, status: 'approved' },
            update,
            { session }
          );
    }
  );
  if (!result.modifiedCount)
    throw new RequestContractError(
      409,
      'Only an approved schedule may be retired'
    );
  return { status: 'retired' };
};
