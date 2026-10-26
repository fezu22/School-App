import { Schema, model, Document } from 'mongoose';

export type FeeStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface IFee extends Document {
  branchId: Schema.Types.ObjectId;
  studentId: Schema.Types.ObjectId;
  academicYear: string;
  invoiceNumber: string;
  amount: number;
  paidAmount: number;
  dueDate: Date;
  status: FeeStatus;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const feeSchema = new Schema<IFee>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },

    academicYear: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },

    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    paidAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    dueDate: {
      type: Date,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue'],
      required: true,
      default: 'pending',
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 255,
    },
  },
  {
    timestamps: true,
  },
);

feeSchema.index(
  {
    branchId: 1,
    invoiceNumber: 1,
  },
  {
    unique: true,
  },
);

feeSchema.index({
  branchId: 1,
  academicYear: 1,
  status: 1,
});

feeSchema.index({
  branchId: 1,
  dueDate: 1,
  status: 1,
});

const Fee = model<IFee>('Fee', feeSchema);

export default Fee;
