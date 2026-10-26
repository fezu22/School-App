import { Schema, model, Document, Types } from 'mongoose';

export type PrivilegedRequestStatus = 'pending' | 'approved' | 'rejected';

export interface IPrivilegedRequest extends Document {
  requesterId: Types.ObjectId;
  branchId?: Types.ObjectId;
  requestType: string;
  reason: string;
  status: PrivilegedRequestStatus;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const privilegedRequestSchema = new Schema<IPrivilegedRequest>(
  {
    requesterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
    },

    requestType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

privilegedRequestSchema.index({ status: 1, createdAt: -1 });

const PrivilegedRequest = model<IPrivilegedRequest>(
  'PrivilegedRequest',
  privilegedRequestSchema,
);

export default PrivilegedRequest;
