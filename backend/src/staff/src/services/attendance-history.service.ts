import { AttendanceSession } from '../models/periodAttendance';
import {
  TimetablePeriod,
  TimetableVersion,
  SubstituteAssignment,
} from '../models/timetable';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import { getTeacherScope } from './teacher-scope.service';
import type { TeacherPeriodDTO } from './teacher-timetable.service';
import { scheduleWeekday } from './school-date.service';
import { RequestContractError } from '../utils/request-validation';

// READ ONLY. Current assignment revocation still removes access; retirement or
// replacement of a timetable does not erase a submitted occurrence's identity.
// Never use this resolver as authority to open, save, submit or amend attendance.
export async function authorizeHistoricalAttendanceRead(
  scope: Awaited<ReturnType<typeof getTeacherScope>>,
  attendance: NonNullable<
    Awaited<ReturnType<typeof AttendanceSession.findOne>>
  >,
): Promise<TeacherPeriodDTO> {
  const missing = () =>
    new RequestContractError(404, 'Attendance session is unavailable');
  if (
    attendance.state !== 'submitted' ||
    String(attendance.branchId) !== scope.branchId ||
    String(attendance.responsibleTeacherId) !== scope.actorId ||
    (attendance.submittedBy && String(attendance.submittedBy) !== scope.actorId)
  )
    throw missing();
  const [period, version, schoolClass, section, subject] = await Promise.all([
    TimetablePeriod.findOne({
      _id: attendance.periodId,
      branchId: scope.branchId,
      timetableVersionId: attendance.timetableVersionId,
      classId: attendance.classId,
      sectionId: attendance.sectionId,
      subjectId: attendance.subjectId,
      dayOfWeek: scheduleWeekday(attendance.date),
    })
      .read('primary')
      .lean(),
    TimetableVersion.findOne({
      _id: attendance.timetableVersionId,
      branchId: scope.branchId,
      status: { $in: ['approved', 'retired'] },
      effectiveFrom: { $lte: attendance.date },
      effectiveUntil: { $gt: attendance.date },
    })
      .read('primary')
      .lean(),
    SchoolClass.findOne({ isActive: true })
      .where('_id')
      .equals(attendance.classId)
      .where('branchId')
      .equals(scope.branchId)
      .select('name')
      .read('primary')
      .lean(),
    Section.findOne({ isActive: true })
      .where('_id')
      .equals(attendance.sectionId)
      .where('classId')
      .equals(attendance.classId)
      .where('branchId')
      .equals(scope.branchId)
      .select('name')
      .read('primary')
      .lean(),
    Subject.findOne({
      _id: attendance.subjectId,
      branchId: scope.branchId,
      isActive: true,
    })
      .select('name')
      .read('primary')
      .lean(),
  ]);
  if (!period || !version || !schoolClass || !section || !subject)
    throw missing();
  const substitute = attendance.substituteId
    ? await SubstituteAssignment.findOne({
        _id: attendance.substituteId,
        branchId: scope.branchId,
        periodId: period._id,
        originalTeacherId: period.teacherId,
        substituteTeacherId: scope.actorId,
        date: attendance.date,
        status: 'approved',
      })
        .read('primary')
        .lean()
    : null;
  if (
    attendance.substituteId
      ? !substitute
      : String(period.teacherId) !== scope.actorId ||
        !scope.tuples.some(
          t =>
            t.classId === String(attendance.classId) &&
            t.sectionId === String(attendance.sectionId) &&
            t.subjectId === String(attendance.subjectId),
        )
  )
    throw missing();
  return {
    periodId: String(period._id),
    date: attendance.date,
    startTime: substitute?.startTime ?? period.startTime,
    endTime: substitute?.endTime ?? period.endTime,
    room: substitute?.room ?? period.room,
    classId: String(attendance.classId),
    className: schoolClass.name,
    sectionId: String(attendance.sectionId),
    sectionName: section.name,
    subjectId: String(attendance.subjectId),
    subjectName: subject.name,
    approvedVersion: {
      versionId: String(version._id),
      versionNumber: version.versionNumber,
      effectiveFrom: version.effectiveFrom,
      effectiveUntil: version.effectiveUntil,
    },
    isSubstitute: !!substitute,
    substituteId: substitute ? String(substitute._id) : null,
    substituteStatus: substitute
      ? substitute.acknowledgedAt
        ? 'acknowledged'
        : 'needs_acknowledgement'
      : null,
    acknowledgedAt: substitute?.acknowledgedAt?.toISOString() ?? null,
    issueStatus: null,
    canRequestIssue: false,
    canAcknowledgeSubstitute: false,
  };
}

// Action availability only; historical read authorization above is independent
// of the operational winner. Mutation handlers still acquire their own fences.
export async function hasOperationalAttendanceVersion(
  branchId: string,
  period: TeacherPeriodDTO,
) {
  const winner = await TimetableVersion.findOne({
    branchId,
    status: 'approved',
    effectiveFrom: { $lte: period.date },
    effectiveUntil: { $gt: period.date },
  })
    .sort({ versionNumber: -1 })
    .select('_id')
    .read('primary')
    .lean();
  return String(winner?._id) === period.approvedVersion.versionId;
}
