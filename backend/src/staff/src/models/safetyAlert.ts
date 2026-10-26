import { Schema, model, Document } from 'mongoose';

export const SAFETY_ALERT_TYPES = {
  MISSING_ATTENDANCE: 'missing_attendance',
  SUBSTITUTE_GAP: 'substitute_gap',
  BUS_EXCEPTION: 'bus_exception',
  GATE_EXCEPTION: 'gate_exception',
  INCIDENT: 'incident',
  HELPDESK: 'helpdesk',
  BACKUP_FAILURE: 'backup_failure',
} as const;

export type SafetyAlertType =
  (typeof SAFETY_ALERT_TYPES)[keyof typeof SAFETY_ALERT_TYPES];

export const SAFETY_ALERT_SEVERITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type SafetyAlertSeverity =
  (typeof SAFETY_ALERT_SEVERITIES)[keyof typeof SAFETY_ALERT_SEVERITIES];

export const SAFETY_ALERT_STATUSES = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
} as const;

export type SafetyAlertStatus =
  (typeof SAFETY_ALERT_STATUSES)[keyof typeof SAFETY_ALERT_STATUSES];

export interface ISafetyAlert extends Document {
  branchId: Schema.Types.ObjectId;
  type: SafetyAlertType;
  title: string;
  description?: string;
  severity: SafetyAlertSeverity;
  status: SafetyAlertStatus;
  assignedTo?: Schema.Types.ObjectId;
  resolvedAt?: Date;
  history: Array<{
    action: 'assign' | 'resolve' | 'escalate';
    performedBy: Schema.Types.ObjectId;
    assignedTo?: Schema.Types.ObjectId;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const safetyAlertSchema = new Schema<ISafetyAlert>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
      index: true,
    },

    type: {
      type: String,
      enum: Object.values(SAFETY_ALERT_TYPES),
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

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    severity: {
      type: String,
      enum: Object.values(SAFETY_ALERT_SEVERITIES),
      required: true,
      default: SAFETY_ALERT_SEVERITIES.MEDIUM,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(SAFETY_ALERT_STATUSES),
      required: true,
      default: SAFETY_ALERT_STATUSES.OPEN,
      index: true,
    },

    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    resolvedAt: {
      type: Date,
    },
    history: {
      type: [
        {
          action: {
            type: String,
            enum: ['assign', 'resolve', 'escalate'],
            required: true,
          },
          performedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
          },
          assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
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

safetyAlertSchema.index({
  branchId: 1,
  status: 1,
  severity: 1,
});

safetyAlertSchema.index({
  branchId: 1,
  type: 1,
  status: 1,
});

safetyAlertSchema.index({
  branchId: 1,
  createdAt: -1,
});

const SafetyAlert = model<ISafetyAlert>('SafetyAlert', safetyAlertSchema);

export default SafetyAlert;
