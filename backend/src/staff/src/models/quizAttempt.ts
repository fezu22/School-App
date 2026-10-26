import { Schema, model } from 'mongoose';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const option = new Schema({ optionId: String, text: String }, { _id: false });
const question = new Schema(
  {
    questionId: String,
    type: String,
    text: String,
    options: { type: [option], default: [] },
  },
  { _id: false },
);
const answer = new Schema(
  {
    questionId: String,
    optionIds: { type: [String], default: [] },
    booleanAnswer: Boolean,
    textAnswer: String,
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: ref('Branch'),
    quizId: ref('Quiz'),
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
    attemptNumber: { type: Number, required: true, immutable: true },
    questionSnapshotHash: { type: String, required: true, immutable: true },
    questions: { type: [question], required: true, immutable: true },
    startedAt: { type: Date, required: true, immutable: true },
    expiresAt: { type: Date, immutable: true },
    submittedAt: Date,
    answers: { type: [answer], default: [] },
    status: {
      type: String,
      enum: [
        'active',
        'submitted',
        'under_review',
        'reviewed',
        'feedback_released',
      ],
      required: true,
      default: 'active',
    },
    revision: { type: Number, required: true, default: 1 },
    objectiveScore: { type: Number, required: true, default: 0 },
    objectiveMax: { type: Number, required: true, default: 0 },
    requiresManualReview: { type: Boolean, required: true, default: false },
    startOperationId: { type: String, required: true, immutable: true },
    startFingerprint: { type: String, required: true, immutable: true },
    submitOperationId: String,
    submitFingerprint: String,
    reviewedAt: Date,
    feedbackReleasedAt: Date,
  },
  { timestamps: true },
);
schema.index(
  { quizId: 1, publishedRevision: 1, studentId: 1, attemptNumber: 1 },
  { unique: true },
);
schema.index({ recipientUserId: 1, startOperationId: 1 }, { unique: true });
schema.index({ branchId: 1, status: 1, updatedAt: -1 });
export const QuizAttempt = model('QuizAttempt', schema);
