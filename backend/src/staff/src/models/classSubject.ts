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
    academicPeriodId: ref('AcademicPeriod'),
    classId: ref('SchoolClass'),
    subjectId: ref('Subject'),
    isActive: { type: Boolean, required: true, default: true },
    revision: { type: Number, required: true, default: 1 },
    createdBy: ref('User'),
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
// Reserve identity across deactivation. Reactivate the same historical record.
schema.index(
  { branchId: 1, academicPeriodId: 1, classId: 1, subjectId: 1 },
  { unique: true, name: 'unique_class_subject_identity' },
);
schema.index({ branchId: 1, classId: 1, isActive: 1 });
export const ClassSubject = model('ClassSubject', schema);
