import { Schema, model } from 'mongoose';

export interface ISection {
  branchId: Schema.Types.ObjectId;
  revision?: number;
  classId: Schema.Types.ObjectId;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const sectionSchema = new Schema<ISection>(
  {
    revision: {type: Number, default: 1},
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'SchoolClass',
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

sectionSchema.index({ branchId: 1, classId: 1, code: 1 }, { unique: true });

const Section = model<ISection>('Section', sectionSchema);

export default Section;
