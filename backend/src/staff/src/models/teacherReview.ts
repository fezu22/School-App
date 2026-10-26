import { Schema, model } from 'mongoose';

const score = new Schema(
  { criterionId: String, score: Number },
  { _id: false },
);
const event = new Schema(
  {
    revision: Number,
    action: String,
    reviewerId: Schema.Types.ObjectId,
    evidenceRevision: Number,
    rubricRevision: Number,
    scores: { type: [score], default: [] },
    totalScore: Number,
    maxScore: Number,
    feedback: String,
    privateNote: String,
    returnReason: String,
    resubmitAllowed: Boolean,
    operationId: String,
    fingerprint: String,
    createdAt: Date,
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
    },
    workType: {
      type: String,
      enum: ['homework', 'quiz'],
      required: true,
      immutable: true,
    },
    workId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    publishedRevision: { type: Number, required: true, immutable: true },
    targetType: {
      type: String,
      enum: ['homework_submission', 'quiz_attempt'],
      required: true,
      immutable: true,
    },
    evidenceId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      immutable: true,
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rubricId: { type: Schema.Types.ObjectId, ref: 'AcademicRubric' },
    rubricRevision: Number,
    evidenceRevision: { type: Number, required: true },
    revision: { type: Number, required: true, default: 0 },
    state: {
      type: String,
      enum: [
        'review_draft',
        'returned_for_resubmission',
        'reviewed',
        'feedback_released',
      ],
      required: true,
    },
    scores: { type: [score], default: [] },
    totalScore: Number,
    maxScore: Number,
    feedback: { type: String, maxlength: 8000 },
    privateNote: { type: String, maxlength: 8000 },
    history: { type: [event], default: [] },
    reviewedAt: Date,
    releasedAt: Date,
  },
  { timestamps: true },
);
schema.index({ targetType: 1, evidenceId: 1 }, { unique: true });
schema.index({ branchId: 1, reviewerId: 1, state: 1, updatedAt: -1 });
export const TeacherReview = model('TeacherReview', schema);
