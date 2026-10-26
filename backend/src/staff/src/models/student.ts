import { Schema, model } from 'mongoose';

export interface IStudent {
  userId: Schema.Types.ObjectId;
  branchId: Schema.Types.ObjectId;
  classId: Schema.Types.ObjectId;
  sectionId: Schema.Types.ObjectId;
  admissionNumber: string;
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';
  guardianName?: string;
  guardianPhone?: string;
  address?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const studentSchema = new Schema<IStudent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

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

    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
      index: true,
    },

    admissionNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    dateOfBirth: {
      type: Date,
    },

    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },

    guardianName: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    guardianPhone: {
      type: String,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
      maxlength: 255,
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

studentSchema.index({ branchId: 1, admissionNumber: 1 }, { unique: true });

studentSchema.index(
  { branchId: 1, classId: 1, sectionId: 1, isActive: 1 },
  { name: 'active_enrollment_roster' },
);

const Student = model<IStudent>('Student', studentSchema);

export default Student;
