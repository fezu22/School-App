import { Schema, model, Document } from 'mongoose';

export const PRINCIPAL_TASK_STATUSES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type PrincipalTaskStatus =
  (typeof PRINCIPAL_TASK_STATUSES)[keyof typeof PRINCIPAL_TASK_STATUSES];

export const PRINCIPAL_TASK_PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type PrincipalTaskPriority =
  (typeof PRINCIPAL_TASK_PRIORITIES)[keyof typeof PRINCIPAL_TASK_PRIORITIES];

export interface IPrincipalTask extends Document {
  branchId: Schema.Types.ObjectId;
  title: string;
  description?: string;
  priority: PrincipalTaskPriority;
  status: PrincipalTaskStatus;
  assignedTo: Schema.Types.ObjectId;
  createdBy: Schema.Types.ObjectId;
  dueDate?: Date;
  completedAt?: Date | null;
  history: Array<{
    action: 'start' | 'complete' | 'cancel';
    performedBy: Schema.Types.ObjectId;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const principalTaskSchema = new Schema<IPrincipalTask>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 150,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    priority: {
      type: String,
      enum: Object.values(PRINCIPAL_TASK_PRIORITIES),
      required: true,
      default: PRINCIPAL_TASK_PRIORITIES.NORMAL,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(PRINCIPAL_TASK_STATUSES),
      required: true,
      default: PRINCIPAL_TASK_STATUSES.PENDING,
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    dueDate: {
      type: Date,
      index: true,
    },
    completedAt: {
      type: Date,
    },
    history: {
      type: [
        {
          action: {
            type: String,
            enum: ['start', 'complete', 'cancel'],
            required: true,
          },
          performedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
          },
          createdAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

principalTaskSchema.index({
  branchId: 1,
  status: 1,
  dueDate: 1,
});

principalTaskSchema.index({
  branchId: 1,
  assignedTo: 1,
  status: 1,
});

principalTaskSchema.index({
  branchId: 1,
  createdAt: -1,
});

const PrincipalTask = model<IPrincipalTask>(
  'PrincipalTask',
  principalTaskSchema,
);

export default PrincipalTask;
