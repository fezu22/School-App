import { Schema, model } from 'mongoose';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
// A submitted snapshot is appended atomically with the state transition. Later
// review/resubmission must append a new snapshot, never replace one.
const snapshot = new Schema(
  {
    revision: { type: Number, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    submittedAt: { type: Date, required: true },
    submittedBy: ref('User'),
  },
  { _id: false },
);
const operation = new Schema(
  {
    id: { type: String, required: true },
    fingerprint: { type: String, required: true },
    revision: { type: Number, required: true },
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: ref('Branch'),
    teacherId: ref('User'),
    assignmentId: ref('TeacherAssignment'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    academicYear: { type: String, required: true, immutable: true },
    syllabusId: ref('Syllabus'),
    unitId: { type: Schema.Types.ObjectId, required: true },
    topicIds: { type: [Schema.Types.ObjectId], required: true },
    teachingDate: { type: String, required: true },
    occurrence: {
      type: new Schema(
        {
          periodId: ref('TimetablePeriod'),
          timetableVersionId: ref('TimetableVersion'),
          date: { type: String, required: true },
        },
        { _id: false },
      ),
      default: undefined,
      immutable: true,
    },
    objectives: { type: String, required: true, maxlength: 4000 },
    teachingActivities: { type: String, required: true, maxlength: 8000 },
    resources: { type: String, default: '', maxlength: 4000 },
    notes: { type: String, default: '', maxlength: 4000 },
    state: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'needs_revision', 'rejected'],
      required: true,
      default: 'draft',
    },
    revision: { type: Number, required: true, default: 1 },
    createOperationId: { type: String, required: true, immutable: true },
    createFingerprint: { type: String, required: true, immutable: true },
    operations: { type: [operation], default: [] },
    submissions: { type: [snapshot], default: [] },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    approvedRevision: Number,
    reviews: {
      type: [
        new Schema(
          {
            submittedRevision: { type: Number, required: true },
            action: {
              type: String,
              enum: ['approved', 'needs_revision', 'rejected'],
              required: true,
            },
            note: { type: String, required: false, default: '' },
            reviewedBy: ref('User'),
            reviewedAt: { type: Date, required: true },
            clientOperationId: { type: String, required: true },
            fingerprint: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    createdBy: ref('User'),
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: Date,
  },
  { timestamps: true },
);
schema.index({ teacherId: 1, createOperationId: 1 }, { unique: true });
schema.index({
  branchId: 1,
  teacherId: 1,
  classId: 1,
  sectionId: 1,
  subjectId: 1,
  updatedAt: -1,
});
export const LessonPlan = model('LessonPlan', schema);
