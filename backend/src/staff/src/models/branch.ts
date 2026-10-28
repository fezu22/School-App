import { Schema, model, Document, Types } from 'mongoose';

export interface IBranch extends Document {
  schoolId?: Types.ObjectId;
  name: string;
  code: string;
  address: string;
  city: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    schoolId: {type: Schema.Types.ObjectId, ref: 'School', immutable: true},
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 20,
    },
    address: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
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

// School-bounded active selectors use this equality/sort ownership path.
branchSchema.index({schoolId: 1, isActive: 1, name: 1, _id: 1}, {name: 'school_active_branch_options'});
const Branch = model<IBranch>('Branch', branchSchema);

export default Branch;
