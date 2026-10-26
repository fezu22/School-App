import { Schema, model } from 'mongoose';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const submittedRevision = new Schema(
  {
    revision: { type: Number, required: true },
    content: { type: String, required: true, maxlength: 12000 },
    submittedAt: { type: Date, required: true },
    timing: { type: String, enum: ['on_time', 'late'], required: true },
    operationId: { type: String, required: true },
    fingerprint: { type: String, required: true },
  },
  { _id: false },
);

const schema = new Schema(
  {
    branchId: ref('Branch'),
    homeworkId: ref('Homework'),
    publishedRevision: { type: Number, required: true, immutable: true },
    audienceEntitlementId: ref('AcademicWorkAudience'),
    studentId: ref('Student'),
    recipientUserId: ref('User'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    syllabusId: ref('Syllabus'),
    syllabusVersion: { type: Number, required: true, immutable: true },
    lessonPlanId: ref('LessonPlan'),
    lessonPlanRevision: { type: Number, required: true, immutable: true },
    lessonDeliveryId: {
      type: Schema.Types.ObjectId,
      ref: 'LessonDelivery',
      immutable: true,
    },
    topicIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      immutable: true,
    },
    submissionRevision: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: [
        'submitted',
        'under_review',
        'returned_for_resubmission',
        'resubmitted',
        'reviewed',
        'feedback_released',
      ],
      required: true,
    },
    revisions: { type: [submittedRevision], default: [] },
    resubmitAllowed: { type: Boolean, required: true, default: false },
    returnedReason: { type: String, maxlength: 4000 },
    reviewedAt: Date,
    feedbackReleasedAt: Date,
  },
  { timestamps: true },
);
schema.index({ audienceEntitlementId: 1 }, { unique: true });
schema.index(
  { homeworkId: 1, publishedRevision: 1, studentId: 1 },
  { unique: true },
);
schema.index({ branchId: 1, status: 1, updatedAt: -1 });
export const HomeworkSubmission = model('HomeworkSubmission', schema);
