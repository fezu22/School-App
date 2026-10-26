import { Schema, model, Types } from 'mongoose';

export interface ISubject {
  revision?: number;
  branchId: Types.ObjectId;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const SUBJECT_NAME_INDEX = {
  name: 'unique_branch_subject_name',
  unique: true,
  collation: { locale: 'en', strength: 2 },
} as const;

const schema = new Schema<ISubject>(
  {
    revision: {type: Number, default: 1},
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
    },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 100,
      set: (value: string) =>
        typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
    },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

schema.index({ branchId: 1, name: 1 }, SUBJECT_NAME_INDEX);

export default model<ISubject>('Subject', schema);
