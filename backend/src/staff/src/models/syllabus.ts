import { Schema, model } from 'mongoose';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const topic = new Schema({
  title: { type: String, required: true, maxlength: 200 },
  order: { type: Number, required: true, min: 1 },
  outcomes: { type: [String], default: [] },
});
const unit = new Schema({
  title: { type: String, required: true, maxlength: 200 },
  order: { type: Number, required: true, min: 1 },
  topics: { type: [topic], required: true },
});
const schema = new Schema(
  {
    branchId: ref('Branch'),
    classId: ref('SchoolClass'),
    subjectId: ref('Subject'),
    // Reuse SchoolClass.academicYear. Session is an authentication domain.
    academicYear: { type: String, required: true, immutable: true },
    title: { type: String, required: true, maxlength: 200 },
    version: { type: Number, required: true, min: 1, immutable: true },
    revision: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      enum: ['draft', 'published', 'retired'],
      required: true,
      default: 'draft',
    },
    units: { type: [unit], required: true },
    createdBy: ref('User'),
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedAt: Date,
    retiredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    retiredAt: Date,
  },
  { timestamps: true },
);
const context = {
  branchId: 1,
  classId: 1,
  subjectId: 1,
  academicYear: 1,
} as const;
schema.index({ ...context, version: 1 }, { unique: true });
schema.index(context, {
  unique: true,
  partialFilterExpression: { status: 'published' },
  name: 'one_published_syllabus',
});
export const Syllabus = model('Syllabus', schema);
