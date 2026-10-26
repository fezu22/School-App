import { Schema, model } from 'mongoose';
const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const schema = new Schema(
  {
    branchId: ref('Branch'),
    assigneeUserId: ref('User'),
    assigneeRole: {
      type: String,
      enum: ['teacher'],
      default: 'teacher',
      required: true,
    },
    sourceType: {
      type: String,
      enum: ['coordinator_follow_up', 'class_follow_up'],
      required: true,
    },
    sourceId: ref('SchoolClass', false),
    sectionId: ref('Section', false),
    subjectId: ref('Subject', false),
    title: { type: String, required: true, maxlength: 150 },
    summary: { type: String, required: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['open', 'completed', 'cancelled'],
      default: 'open',
      required: true,
    },
    priority: {
      type: String,
      enum: ['normal', 'high'],
      default: 'normal',
      required: true,
    },
    dueAt: Date,
    assignedBy: ref('User'),
    completedAt: Date,
    cancelledAt: Date,
    revision: { type: Number, default: 0, required: true },
    history: [
      {
        _id: false,
        action: {
          type: String,
          enum: ['assigned', 'completed', 'cancelled'],
          required: true,
        },
        performedBy: ref('User'),
        reason: {
          type: String,
          enum: ['source_unavailable', 'owner_withdrawn'],
        },
        at: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true },
);
schema.index({ branchId: 1, assigneeUserId: 1, status: 1, createdAt: -1 });
schema.index({ branchId: 1, sourceType: 1, sourceId: 1, status: 1 });
export const AssignedWork = model('AssignedWork', schema);
