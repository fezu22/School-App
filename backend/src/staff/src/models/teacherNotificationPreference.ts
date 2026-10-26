import { Schema, model } from 'mongoose';
import { NOTIFICATION_CATEGORIES } from './notification';

const quietHours = new Schema(
  {
    enabled: { type: Boolean, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    timezone: { type: String, required: true },
  },
  { _id: false },
);
const audit = new Schema(
  {
    revision: { type: Number, required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    changedAt: { type: Date, required: true },
    operationId: { type: String, required: true },
    fingerprint: { type: String, required: true },
  },
  { _id: false },
);
const schema = new Schema(
  {
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      immutable: true,
    },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    enabledCategories: {
      type: [String],
      enum: NOTIFICATION_CATEGORIES,
      required: true,
    },
    quietHours: { type: quietHours, required: true },
    revision: { type: Number, required: true, default: 1 },
    history: { type: [audit], default: [], select: false },
  },
  { timestamps: true },
);

schema.index({ teacherId: 1, branchId: 1 });
export const TeacherNotificationPreference = model(
  'TeacherNotificationPreference',
  schema,
);
