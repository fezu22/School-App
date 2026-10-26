import type { ClientSession } from 'mongoose';
import {
  AttendanceCorrection,
  AttendanceDownstreamIntent,
} from '../models/attendanceAmendment';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../models/periodAttendance';
// The only effective-status projection. Original records are never updated.
export const effectiveAttendance = async (
  branchId: string,
  sessionId: string,
  transaction?: ClientSession,
) => {
  const originals = await PeriodAttendanceRecord.find({
    branchId,
    attendanceSessionId: sessionId,
  })
    .session(transaction ?? null)
    .select('studentId status revision')
    .lean();
  const corrections = await AttendanceCorrection.find({
    branchId,
    attendanceSessionId: sessionId,
    state: 'approved',
  })
    .session(transaction ?? null)
    .sort({ approvedVersion: -1 })
    .select(
      'studentId originalStatus requestedStatus submittedRevision approvedVersion',
    )
    .lean();
  return new Map(
    originals.map(r => {
      const correction = corrections.find(
        c =>
          String(c.studentId) === String(r.studentId) &&
          c.originalStatus === r.status &&
          c.submittedRevision === r.revision,
      );
      return [
        String(r.studentId),
        {
          originalStatus: r.status,
          status: correction?.requestedStatus ?? r.status,
          effectiveRevision: correction?.approvedVersion ?? 0,
        },
      ];
    }),
  );
};
// Trusted integration boundary. No public endpoint can enqueue, approve or send
// these intents. Future workers must revalidate immediately before delivery.
export const absenceIntentIsCurrent = async (id: string) => {
  const intent = await AttendanceDownstreamIntent.findById(id).lean();
  if (
    !intent ||
    intent.state !== 'pending' ||
    intent.approvalState !== 'approved' ||
    intent.notBefore > new Date()
  )
    return false;
  const submitted = await AttendanceSession.exists({
    _id: intent.attendanceSessionId,
    branchId: intent.branchId,
    state: 'submitted',
  });
  if (!submitted) return false;
  const state = (
    await effectiveAttendance(
      String(intent.branchId),
      String(intent.attendanceSessionId),
    )
  ).get(String(intent.studentId));
  return (
    state?.status === 'absent' &&
    state.effectiveRevision === intent.effectiveRevision
  );
};
export const suppressStaleAttendanceIntents = async (
  branchId: string,
  sessionId: string,
  studentId: string,
  correctionId: string,
  transaction: ClientSession,
) =>
  AttendanceDownstreamIntent.updateMany(
    { branchId, attendanceSessionId: sessionId, studentId, state: 'pending' },
    { $set: { state: 'suppressed', suppressedAt: new Date(), correctionId } },
    { session: transaction },
  );

// Disabled unless trusted deployment configuration specifies a grace period.
// Intents still require independent approval before any future dispatcher acts.
export const stageSubmittedAbsenceIntents = async (
  branchId: string,
  sessionId: string,
  transaction: ClientSession,
) => {
  const configured = process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES;
  if (configured === undefined) return;
  if (!/^\d{1,5}$/.test(configured) || Number(configured) > 10080)
    throw new Error('Invalid absence grace configuration');
  const source = await AttendanceSession.findOne({
    _id: sessionId,
    branchId,
    state: 'submitted',
  })
    .session(transaction)
    .lean();
  if (!source) return;
  const state = await effectiveAttendance(branchId, sessionId, transaction);
  for (const [studentId, value] of state) {
    if (value.status !== 'absent') continue;
    for (const kind of ['absence_notice', 'catch_up'] as const)
      await AttendanceDownstreamIntent.updateOne(
        {
          branchId,
          attendanceSessionId: sessionId,
          studentId,
          effectiveRevision: value.effectiveRevision,
          kind,
        },
        {
          $setOnInsert: {
            notBefore: new Date(Date.now() + Number(configured) * 60000),
            approvalState: 'pending',
            state: 'pending',
          },
        },
        { session: transaction, upsert: true, runValidators: true },
      );
  }
};
