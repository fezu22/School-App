import { Schema, model } from 'mongoose';

const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
  immutable: true,
});
const operation = new Schema(
  {
    id: { type: String, required: true },
    fingerprint: { type: String, required: true },
    revision: { type: Number, required: true },
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: ref('Branch'),
    teacherId: ref('User'),
    assignmentId: ref('TeacherAssignment', false),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    academicYear: { type: String, required: true, immutable: true },
    syllabusId: ref('Syllabus'),
    syllabusVersion: { type: Number, required: true, immutable: true },
    lessonPlanId: ref('LessonPlan'),
    lessonPlanRevision: { type: Number, required: true },
    lessonDeliveryId: ref('LessonDelivery', false),
    topicIds: { type: [Schema.Types.ObjectId], required: true },
    title: { type: String, required: true, maxlength: 200 },
    instructions: { type: String, required: true, maxlength: 8000 },
    dueAt: { type: String, required: true },
    latePolicy: {
      type: String,
      enum: ['closed_after_due_date'],
      required: true,
      default: 'closed_after_due_date',
      immutable: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'closed', 'cancelled'],
      required: true,
      default: 'draft',
    },
    revision: { type: Number, required: true, default: 1 },
    publishedRevision: Number,
    publishedAt: Date,
    recipientCount: { type: Number, required: true, default: 0 },
    createOperationId: { type: String, required: true, immutable: true },
    createFingerprint: { type: String, required: true, immutable: true },
    publishOperationId: String,
    publishFingerprint: String,
    operations: { type: [operation], default: [] },
  },
  { timestamps: true },
);
schema.index({ teacherId: 1, createOperationId: 1 }, { unique: true });
schema.index({ branchId: 1, teacherId: 1, lessonPlanId: 1, updatedAt: -1 });
export const Homework = model('Homework', schema);
