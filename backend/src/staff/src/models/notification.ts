import { Schema, model } from 'mongoose';

export const NOTIFICATION_CATEGORIES = [
  'notice',
  'attendance',
  'timetable',
  'assigned_work',
  'submission_review',
  'catch_up',
  'result_status',
  'communication',
  'system',
] as const;
export const NOTIFICATION_SOURCE_TYPES = [
  'school_notice',
  'attendance_session',
  'timetable_occurrence',
  'assigned_work',
  'teacher_review',
  'catch_up',
  'academic_result',
  'teacher_notice',
  'system',
] as const;
export const NOTIFICATION_DEEP_LINKS = [
  'inbox_notice',
  'teacher_timetable',
  'attendance_period',
  'submission_review',
  'catch_up_item',
  'none',
] as const;

const schema = new Schema(
  {
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    recipientRole: {
      type: String,
      enum: ['teacher'],
      required: true,
      immutable: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
    },
    sourceType: {
      type: String,
      enum: NOTIFICATION_SOURCE_TYPES,
      required: true,
      immutable: true,
    },
    sourceId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    sourceRevision: { type: Number, min: 1, required: true, immutable: true },
    eventType: { type: String, required: true, immutable: true, maxlength: 80 },
    category: {
      type: String,
      enum: NOTIFICATION_CATEGORIES,
      required: true,
      immutable: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 150,
      trim: true,
      immutable: true,
    },
    body: {
      type: String,
      required: true,
      maxlength: 280,
      trim: true,
      immutable: true,
    },
    deepLinkType: {
      type: String,
      enum: NOTIFICATION_DEEP_LINKS,
      required: true,
      immutable: true,
    },
    deepLinkTargetId: { type: Schema.Types.ObjectId, immutable: true },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      required: true,
      immutable: true,
    },
    availableAt: { type: Date, required: true, immutable: true },
    readAt: Date,
    operationId: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 200,
    },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
  },
  { timestamps: true },
);

schema.index({ recipientUserId: 1, branchId: 1, availableAt: -1 });
schema.index({ recipientUserId: 1, branchId: 1, readAt: 1, availableAt: -1 });
schema.index(
  {
    recipientUserId: 1,
    sourceType: 1,
    sourceId: 1,
    sourceRevision: 1,
    eventType: 1,
  },
  { unique: true, name: 'notification_event_recipient_unique' },
);
export const Notification = model('Notification', schema);

const readOperationSchema = new Schema(
  {
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    notificationId: {
      type: Schema.Types.ObjectId,
      ref: 'Notification',
      required: true,
      immutable: true,
    },
    operationId: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 80,
    },
    fingerprint: { type: String, required: true, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
readOperationSchema.index(
  { recipientUserId: 1, operationId: 1 },
  { unique: true, name: 'notification_read_operation_unique' },
);
export const NotificationReadOperation = model(
  'NotificationReadOperation',
  readOperationSchema,
);
