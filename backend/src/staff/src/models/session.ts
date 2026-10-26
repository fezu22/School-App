import { Schema, model, Document, Types } from 'mongoose';

export interface ISession extends Document {
  token: string;
  userId: Types.ObjectId;
  role: string;
  isRevoked: boolean;
  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    token: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    revokedAt: {
      type: Date,
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  },
);

sessionSchema.index({ userId: 1, isRevoked: 1 });

const Session = model<ISession>('Session', sessionSchema);

export default Session;
