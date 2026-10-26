import { Schema, model, Document, Types } from 'mongoose';

export interface IAutomation extends Document {
  key: string;
  name: string;
  description: string;
  isPaused: boolean;
  pausedBy?: Types.ObjectId;
  pausedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const automationSchema = new Schema<IAutomation>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    isPaused: {
      type: Boolean,
      default: false,
    },
    pausedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    pausedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

const Automation = model<IAutomation>('Automation', automationSchema);

export default Automation;
