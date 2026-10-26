import { Schema, model } from 'mongoose';

const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
  immutable: true,
});
const workLink = new Schema(
  {
    workType: { type: String, enum: ['homework', 'quiz'] },
    workId: Schema.Types.ObjectId,
    publishedRevision: Number,
    audienceEntitlementId: Schema.Types.ObjectId,
  },
  { _id: false },
);
const resource = new Schema(
  {
    resourceId: String,
    type: { type: String, enum: ['text', 'chapter', 'resource_link'] },
    label: String,
    value: String,
    addedBy: Schema.Types.ObjectId,
    addedAt: Date,
  },
  { _id: false },
);
const evidence = new Schema(
  {
    revision: Number,
    content: String,
    submittedAt: Date,
    operationId: String,
    fingerprint: String,
  },
  { _id: false },
);
const event = new Schema(
  {
    revision: Number,
    action: String,
    actorId: Schema.Types.ObjectId,
    reason: String,
    fromStatus: String,
    toStatus: String,
    createdAt: Date,
    operationId: String,
    fingerprint: String,
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: ref('Branch'),
    studentId: ref('Student'),
    recipientUserId: ref('User'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    attendanceSessionId: ref('AttendanceSession'),
    attendanceRecordId: ref('PeriodAttendanceRecord'),
    originalAttendanceStatus: {
      type: String,
      enum: ['present', 'absent', 'late', 'leave'],
      required: true,
      immutable: true,
    },
    effectiveAbsenceVersion: { type: Number, required: true, immutable: true },
    occurrenceId: ref('TimetablePeriod'),
    occurrenceDate: { type: String, required: true, immutable: true },
    timetableVersionId: ref('TimetableVersion'),
    lessonDeliveryId: ref('LessonDelivery', false),
    lessonDeliveryRevision: Number,
    deliveryTeacherId: ref('User', false),
    syllabusId: ref('Syllabus', false),
    syllabusVersion: Number,
    topicIds: { type: [Schema.Types.ObjectId], default: [] },
    linkedWork: { type: [workLink], default: [] },
    resources: { type: [resource], default: [] },
    evidenceRevisions: { type: [evidence], default: [] },
    review: {
      type: new Schema(
        {
          revision: Number,
          evidenceRevision: Number,
          accepted: Boolean,
          note: String,
          reviewedBy: Schema.Types.ObjectId,
          reviewedAt: Date,
        },
        { _id: false },
      ),
      default: undefined,
    },
    assignedAt: { type: Date, required: true, immutable: true },
    dueAt: { type: String, required: true },
    status: {
      type: String,
      enum: [
        'waiting_for_delivery_evidence',
        'pending',
        'in_progress',
        'submitted',
        'under_review',
        'extended',
        'completed',
        'cancelled',
        'stale',
      ],
      required: true,
    },
    revision: { type: Number, required: true, default: 1 },
    sourceFingerprint: { type: String, required: true, immutable: true },
    history: { type: [event], default: [] },
  },
  { timestamps: true },
);
schema.index(
  { attendanceSessionId: 1, studentId: 1, effectiveAbsenceVersion: 1 },
  { unique: true, name: 'one_catch_up_per_effective_absence' },
);
schema.index({
  branchId: 1,
  classId: 1,
  sectionId: 1,
  subjectId: 1,
  status: 1,
  dueAt: 1,
});
schema.index({ recipientUserId: 1, status: 1, dueAt: 1 });
export const CatchUpItem = model('CatchUpItem', schema);
