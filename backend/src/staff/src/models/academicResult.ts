import { Schema, model } from 'mongoose';

const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
  immutable: true,
});
const resultRevision = new Schema(
  {
    revision: { type: Number, required: true },
    awardedMarks: { type: Number, required: true },
    maxMarks: { type: Number, required: true },
    sourceScore: { type: Number, required: true },
    sourceMax: { type: Number, required: true },
    overrideReason: String,
    teacherPrivateNote: String,
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true },
    submittedAt: Date,
  },
  { _id: false },
);
const moderation = new Schema(
  {
    resultRevision: { type: Number, required: true },
    action: {
      type: String,
      enum: ['approved', 'returned', 'rejected'],
      required: true,
    },
    note: String,
    actorId: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true },
    operationId: { type: String, required: true },
    fingerprint: { type: String, required: true },
  },
  { _id: false },
);
const event = new Schema(
  {
    resultRevision: { type: Number, required: true },
    action: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorRole: { type: String, enum: ['teacher', 'principal'], required: true },
    reason: String,
    createdAt: { type: Date, required: true },
    operationId: { type: String, required: true },
    fingerprint: { type: String, required: true },
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: ref('Branch'),
    teacherId: ref('User'),
    assignmentId: ref('TeacherAssignment'),
    studentId: ref('Student'),
    recipientUserId: ref('User'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    academicYear: { type: String, required: true, immutable: true },
    assessmentSourceType: {
      type: String,
      enum: ['homework_submission', 'quiz_attempt'],
      required: true,
      immutable: true,
    },
    sourceWorkId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    sourcePublishedRevision: { type: Number, required: true, immutable: true },
    sourceEvidenceId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    sourceEvidenceRevision: { type: Number, required: true, immutable: true },
    sourceReviewId: ref('TeacherReview'),
    sourceReviewRevision: { type: Number, required: true, immutable: true },
    syllabusId: ref('Syllabus'),
    syllabusVersion: { type: Number, required: true, immutable: true },
    topicIds: { type: [Schema.Types.ObjectId], default: [], immutable: true },
    assessmentTitle: { type: String, required: true, immutable: true },
    revisions: { type: [resultRevision], required: true },
    currentRevision: { type: Number, required: true },
    recordRevision: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      enum: [
        'draft',
        'submitted_for_moderation',
        'returned_for_revision',
        'resubmitted_for_moderation',
        'moderated_approved',
        'rejected',
        'published',
      ],
      required: true,
    },
    submittedRevision: Number,
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    moderationHistory: { type: [moderation], default: [] },
    publishedRevision: Number,
    publishedAt: Date,
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    history: { type: [event], default: [] },
  },
  { timestamps: true },
);
schema.index(
  { sourceReviewId: 1 },
  { unique: true, name: 'one_result_per_source_review' },
);
schema.index({ teacherId: 1, 'history.operationId': 1 });
schema.index({ branchId: 1, status: 1, updatedAt: -1 });
schema.index({ recipientUserId: 1, status: 1, publishedAt: -1 });
export const AcademicResult = model('AcademicResult', schema);
