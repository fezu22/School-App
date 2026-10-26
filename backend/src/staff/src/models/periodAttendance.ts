import { Schema, model } from 'mongoose';
import Student from './student';

export const PERIOD_ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'late',
  'leave',
] as const;
export type PeriodAttendanceStatus =
  (typeof PERIOD_ATTENDANCE_STATUSES)[number];
const ref = (name: string, immutable = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable,
});
const sessionSchema = new Schema(
  {
    branchId: ref('Branch'),
    periodId: ref('TimetablePeriod'),
    timetableVersionId: ref('TimetableVersion'),
    date: { type: String, required: true, immutable: true },
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    responsibleTeacherId: ref('User', false),
    substituteId: { type: Schema.Types.ObjectId, ref: 'SubstituteAssignment' },
    rosterVersion: { type: String, required: true },
    rosterStudentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    state: {
      type: String,
      enum: ['open', 'draft', 'submitted'],
      default: 'open',
      required: true,
    },
    revision: { type: Number, default: 0, required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
  },
  { timestamps: true },
);
sessionSchema.index(
  { branchId: 1, periodId: 1, date: 1, timetableVersionId: 1 },
  { unique: true, name: 'attendance_occurrence' },
);
sessionSchema.index({
  branchId: 1,
  date: 1,
  responsibleTeacherId: 1,
  state: 1,
});
const recordSchema = new Schema(
  {
    branchId: ref('Branch'),
    attendanceSessionId: ref('AttendanceSession'),
    studentId: ref('Student'),
    status: { type: String, enum: PERIOD_ATTENDANCE_STATUSES, required: true },
    markedBy: ref('User', false),
    markedAt: { type: Date, required: true },
    revision: { type: Number, required: true },
  },
  { timestamps: true },
);
recordSchema.index(
  { attendanceSessionId: 1, studentId: 1 },
  { unique: true, name: 'attendance_student' },
);
const operationSchema = new Schema(
  {
    branchId: ref('Branch'),
    createdBy: ref('User'),
    attendanceSessionId: ref('AttendanceSession'),
    clientOperationId: { type: String, required: true, immutable: true },
    fingerprint: { type: String, required: true, immutable: true },
    action: {
      type: String,
      enum: ['draft', 'submit'],
      required: true,
      immutable: true,
    },
    resultingRevision: { type: Number, required: true, immutable: true },
    // Only explicit status changes are retained, never student private profiles.
    changes: [
      {
        _id: false,
        studentId: { type: Schema.Types.ObjectId, required: true },
        before: {
          type: String,
          enum: [...PERIOD_ATTENDANCE_STATUSES, null],
          default: null,
        },
        after: {
          type: String,
          enum: [...PERIOD_ATTENDANCE_STATUSES, null],
          default: null,
        },
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
operationSchema.index(
  { branchId: 1, createdBy: 1, clientOperationId: 1 },
  { unique: true, name: 'attendance_operation' },
);
export const AttendanceSession = model('AttendanceSession', sessionSchema);
export const PeriodAttendanceRecord = model(
  'PeriodAttendanceRecord',
  recordSchema,
);
export const AttendanceOperation = model(
  'AttendanceOperation',
  operationSchema,
);
export const ensureAttendanceIndexes = async () => {
  await Promise.all([
    AttendanceSession.createIndexes(),
    PeriodAttendanceRecord.createIndexes(),
    AttendanceOperation.createIndexes(),
  ]);
  await Student.collection.createIndex(
    { branchId: 1, classId: 1, sectionId: 1, isActive: 1 },
    { name: 'active_enrollment_roster' },
  );
};
