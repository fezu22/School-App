import { Schema, model } from 'mongoose';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const schema = new Schema(
  {
    studentId: ref('Student'),
    branchId: ref('Branch'),
    academicPeriodId: ref('AcademicPeriod'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    status: {
      type: String,
      enum: ['active', 'transferred', 'promoted', 'withdrawn'],
      default: 'active',
      required: true,
    },
    effectiveFrom: { type: Date, required: true, immutable: true },
    effectiveTo: Date,
    previousEnrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'StudentEnrollment',
      immutable: true,
    },
    reason: { type: String, required: true, maxlength: 1000 },
    closedReason: { type: String, maxlength: 1000 },
    revision: { type: Number, default: 1, required: true },
    createdBy: ref('User'),
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
// Status is lifecycle authority; dates describe immediate, half-open intervals.
// Future scheduling is intentionally unsupported. Reject contradictory model
// writes; native import/corruption is additionally filtered by every reader.
schema.pre('validate', function () {
  const from = this.effectiveFrom,
    to = this.effectiveTo;
  if (!from || !Number.isFinite(from.getTime()) || from.getTime() > Date.now())
    this.invalidate(
      'effectiveFrom',
      'Enrollment must start at a valid current or past instant',
    );
  if (
    this.status === 'active'
      ? to != null
      : !to || !Number.isFinite(to.getTime()) || (from && to < from)
  )
    this.invalidate('effectiveTo', 'Enrollment status and interval must agree');
});
export const activeEnrollmentFilter = (at = new Date()) => ({
  status: 'active' as const,
  effectiveFrom: { $type: 'date' as const, $lte: at },
});
export const activeEnrollmentExpression = (
  prefix: string,
  at = new Date(),
) => ({
  $and: [
    { $eq: [prefix + '.status', 'active'] },
    { $eq: [{ $type: prefix + '.effectiveFrom' }, 'date'] },
    { $lte: [prefix + '.effectiveFrom', at] },
    { $eq: [{ $ifNull: [prefix + '.effectiveTo', null] }, null] },
  ],
});
// One active membership globally also prevents conflicting current periods.
schema.index(
  { studentId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'one_active_student_enrollment',
  },
);
schema.index(
  { studentId: 1, academicPeriodId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'one_active_student_period',
  },
);
schema.index({ branchId: 1, classId: 1, sectionId: 1, status: 1 });
schema.index({ studentId: 1, effectiveFrom: -1 });
export const StudentEnrollment = model('StudentEnrollment', schema);
const operation = new Schema(
  {
    branchId: ref('Branch'),
    studentId: ref('Student'),
    actorId: ref('User'),
    operationId: { type: String, required: true, immutable: true },
    fingerprint: { type: String, required: true, immutable: true },
    result: { type: Schema.Types.Mixed, required: true, immutable: true },
  },
  { timestamps: true },
);
operation.index(
  { branchId: 1, studentId: 1, actorId: 1, operationId: 1 },
  { unique: true, name: 'unique_student_enrollment_operation' },
);
export const EnrollmentOperation = model('EnrollmentOperation', operation);
export const ensureEnrollmentIndexes = () =>
  Promise.all([
    StudentEnrollment.createIndexes(),
    EnrollmentOperation.createIndexes(),
  ]);
