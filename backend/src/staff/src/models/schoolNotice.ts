import { Schema, model, Document } from 'mongoose';

export const SCHOOL_NOTICE_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export type SchoolNoticeStatus =
  (typeof SCHOOL_NOTICE_STATUSES)[keyof typeof SCHOOL_NOTICE_STATUSES];

export const SCHOOL_NOTICE_PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type SchoolNoticePriority =
  (typeof SCHOOL_NOTICE_PRIORITIES)[keyof typeof SCHOOL_NOTICE_PRIORITIES];

export interface ISchoolNotice extends Document {
  branchId: Schema.Types.ObjectId;
  title: string;
  message: string;
  priority: SchoolNoticePriority;
  status: SchoolNoticeStatus;
  createdBy: Schema.Types.ObjectId;
  publishedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Explicit opt-in; legacy notices have no implied Teacher audience.
  audienceRoles?: ('teacher')[];
}

const schoolNoticeSchema = new Schema<ISchoolNotice>(
  {
    audienceRoles: {type: [String], enum: ['teacher'], default: undefined},
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 150,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 2000,
    },
    priority: {
      type: String,
      enum: Object.values(SCHOOL_NOTICE_PRIORITIES),
      required: true,
      default: SCHOOL_NOTICE_PRIORITIES.NORMAL,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(SCHOOL_NOTICE_STATUSES),
      required: true,
      default: SCHOOL_NOTICE_STATUSES.DRAFT,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    publishedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

schoolNoticeSchema.index({
  branchId: 1,
  status: 1,
  createdAt: -1,
});

schoolNoticeSchema.index({
  branchId: 1,
  priority: 1,
  status: 1,
});

schoolNoticeSchema.index({
  branchId: 1,
  expiresAt: 1,
});

schoolNoticeSchema.index({branchId: 1, audienceRoles: 1, status: 1, createdAt: -1});

const SchoolNotice = model<ISchoolNotice>('SchoolNotice', schoolNoticeSchema);

export default SchoolNotice;
