import { Schema, model } from 'mongoose';
import { PERIOD_ATTENDANCE_STATUSES } from './periodAttendance';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const common = {
  branchId: ref('Branch'),
  attendanceSessionId: ref('AttendanceSession'),
  studentId: ref('Student'),
  requestedBy: ref('User'),
  approvalRequestId: ref('ApprovalRequest'),
  reason: {
    type: String,
    required: true,
    minlength: 10,
    maxlength: 500,
    immutable: true,
  },
  clientOperationId: { type: String, required: true, immutable: true },
  occurrenceVersionId: ref('TimetableVersion'),
  occurrenceSubstituteId: {
    type: Schema.Types.ObjectId,
    ref: 'SubstituteAssignment',
    default: null,
    immutable: true,
  },
  fingerprint: { type: String, required: true, immutable: true },
  state: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    required: true,
  },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: String,
  decisionOperationId: String,
  decisionFingerprint: String,
  revision: { type: Number, default: 0, required: true },
};
const correction = new Schema(
  {
    ...common,
    originalStatus: {
      type: String,
      enum: PERIOD_ATTENDANCE_STATUSES,
      required: true,
      immutable: true,
    },
    baseStatus: {
      type: String,
      enum: PERIOD_ATTENDANCE_STATUSES,
      required: true,
      immutable: true,
    },
    requestedStatus: {
      type: String,
      enum: PERIOD_ATTENDANCE_STATUSES,
      required: true,
      immutable: true,
    },
    submittedRevision: { type: Number, required: true, immutable: true },
    baseEffectiveRevision: { type: Number, required: true, immutable: true },
    approvedVersion: Number,
    leaveId: {
      type: Schema.Types.ObjectId,
      ref: 'StudentLeave',
      immutable: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
correction.index(
  { branchId: 1, requestedBy: 1, clientOperationId: 1 },
  { unique: true },
);
correction.index(
  { attendanceSessionId: 1, studentId: 1, state: 1 },
  {
    unique: true,
    partialFilterExpression: { state: 'pending' },
    name: 'one_pending_attendance_correction',
  },
);
correction.index(
  { attendanceSessionId: 1, studentId: 1, approvedVersion: 1 },
  { unique: true, partialFilterExpression: { state: 'approved' } },
);
const leave = new Schema(
  {
    ...common,
    fromDate: { type: String, required: true, immutable: true },
    untilDate: { type: String, required: true, immutable: true },
    category: {
      type: String,
      enum: ['illness', 'authorized_absence', 'other'],
      required: true,
      immutable: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
leave.index(
  { branchId: 1, requestedBy: 1, clientOperationId: 1 },
  { unique: true },
);
leave.index({ branchId: 1, studentId: 1, state: 1, fromDate: 1, untilDate: 1 });
// Delivery intents only: no Catch-up module, outbound delivery or automatic
// student absence inference. Dispatchers must use the effective-state guard.
const intent = new Schema(
  {
    branchId: ref('Branch'),
    attendanceSessionId: ref('AttendanceSession'),
    studentId: ref('Student'),
    effectiveRevision: { type: Number, required: true, immutable: true },
    kind: {
      type: String,
      enum: ['absence_notice', 'catch_up'],
      required: true,
      immutable: true,
    },
    notBefore: { type: Date, required: true, immutable: true },
    approvalState: {
      type: String,
      enum: ['pending', 'approved'],
      default: 'pending',
    },
    state: {
      type: String,
      enum: ['pending', 'suppressed', 'dispatched'],
      default: 'pending',
    },
    suppressedAt: Date,
    correctionId: { type: Schema.Types.ObjectId, ref: 'AttendanceCorrection' },
  },
  { timestamps: true },
);
intent.index(
  { attendanceSessionId: 1, studentId: 1, effectiveRevision: 1, kind: 1 },
  { unique: true },
);
export const AttendanceCorrection = model('AttendanceCorrection', correction);
export const StudentLeave = model('StudentLeave', leave);
export const AttendanceDownstreamIntent = model(
  'AttendanceDownstreamIntent',
  intent,
);
export const ensureAttendanceAmendmentIndexes = () =>
  Promise.all([
    AttendanceCorrection.createIndexes(),
    StudentLeave.createIndexes(),
    AttendanceDownstreamIntent.createIndexes(),
  ]);
