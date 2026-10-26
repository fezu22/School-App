import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
    },
    name: { type: String, required: true, maxlength: 100 },
    code: { type: String, required: true, maxlength: 20, immutable: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'active', 'closed', 'archived'],
      default: 'draft',
      required: true,
    },
    revision: { type: Number, required: true, default: 1 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index(
  { branchId: 1, code: 1 },
  { unique: true, name: 'academic_period_branch_code' },
);
schema.index(
  { branchId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'one_active_academic_period',
  },
);
export const AcademicPeriod = model('AcademicPeriod', schema);
