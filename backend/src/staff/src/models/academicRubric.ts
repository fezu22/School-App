import { Schema, model } from 'mongoose';

const criterion = new Schema(
  { criterionId: String, title: String, description: String, maxScore: Number },
  { _id: false },
);
const version = new Schema(
  {
    revision: Number,
    criteria: { type: [criterion], required: true },
    totalMax: Number,
    createdAt: Date,
    createdBy: Schema.Types.ObjectId,
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
    currentRevision: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'frozen'],
      required: true,
      default: 'draft',
    },
    versions: { type: [version], default: [] },
  },
  { timestamps: true },
);
schema.index(
  { workType: 1, workId: 1, publishedRevision: 1 },
  { unique: true },
);
export const AcademicRubric = model('AcademicRubric', schema);
