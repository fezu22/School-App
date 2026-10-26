import { Schema, model } from 'mongoose';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});

const schema = new Schema(
  {
    branchId: ref('Branch'),
    workType: {
      type: String,
      enum: ['homework', 'quiz'],
      required: true,
      immutable: true,
    },
    workId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    publishedRevision: { type: Number, required: true, immutable: true },
    studentId: ref('Student'),
    recipientUserId: ref('User'),
    admissionNumber: { type: String, required: true, immutable: true },
    studentName: { type: String, required: true, immutable: true },
    entitledAt: { type: Date, required: true, immutable: true },
    state: {
      type: String,
      enum: ['assigned', 'cancelled'],
      required: true,
      default: 'assigned',
    },
  },
  { timestamps: true },
);

schema.index(
  { workType: 1, workId: 1, publishedRevision: 1, studentId: 1 },
  { unique: true, name: 'unique_academic_work_entitlement' },
);
schema.index({ branchId: 1, recipientUserId: 1, state: 1, entitledAt: -1 });

export const AcademicWorkAudience = model('AcademicWorkAudience', schema);
