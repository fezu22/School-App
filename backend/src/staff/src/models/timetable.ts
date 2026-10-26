import { Schema, model } from 'mongoose';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const day = {
  type: String,
  required: true,
  immutable: true,
  match: /^\d{4}-\d{2}-\d{2}$/,
};
const clock = {
  type: String,
  required: true,
  immutable: true,
  match: /^([01]\d|2[0-3]):[0-5]\d$/,
};
const room = {
  type: String,
  required: true,
  immutable: true,
  trim: true,
  maxlength: 120,
};
const versionSchema = new Schema(
  {
    branchId: ref('Branch'),
    versionNumber: { type: Number, required: true, immutable: true, min: 1 },
    status: {
      type: String,
      enum: ['draft', 'approved', 'retired'],
      default: 'draft',
      required: true,
    },
    effectiveFrom: day,
    effectiveUntil: day,
    periodCount: { type: Number, required: true, immutable: true, min: 1 },
    createdBy: ref('User'),
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    retiredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    retiredAt: Date,
  },
  { timestamps: true },
);
versionSchema.index({ branchId: 1, versionNumber: 1 }, { unique: true });
versionSchema.index({
  branchId: 1,
  status: 1,
  effectiveFrom: 1,
  effectiveUntil: 1,
  versionNumber: -1,
});
const periodSchema = new Schema(
  {
    timetableVersionId: ref('TimetableVersion'),
    branchId: ref('Branch'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    teacherId: ref('User'),
    dayOfWeek: {
      type: Number,
      required: true,
      immutable: true,
      min: 0,
      max: 6,
    },
    startTime: clock,
    endTime: clock,
    roomId: {type: Schema.Types.ObjectId, ref: 'Room', immutable: true},
    room,
  },
  { timestamps: true },
);
periodSchema.index({roomId: 1}, {sparse: true});
periodSchema.index({
  branchId: 1,
  timetableVersionId: 1,
  teacherId: 1,
  dayOfWeek: 1,
});
const substituteSchema = new Schema(
  {
    branchId: ref('Branch'),
    periodId: ref('TimetablePeriod'),
    originalTeacherId: ref('User'),
    substituteTeacherId: ref('User'),
    date: day,
    startTime: clock,
    endTime: clock,
    roomId: {type: Schema.Types.ObjectId, ref: 'Room', immutable: true},
    room,
    status: {
      type: String,
      enum: ['draft', 'approved', 'retired'],
      default: 'draft',
      required: true,
    },
    createdBy: ref('User'),
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    retiredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    retiredAt: Date,
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: Date,
  },
  { timestamps: true },
);
substituteSchema.index({roomId: 1}, {sparse: true});
substituteSchema.index(
  { periodId: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'approved' },
    name: 'one_approved_substitute',
  },
);
substituteSchema.index({
  branchId: 1,
  substituteTeacherId: 1,
  status: 1,
  date: 1,
});
substituteSchema.index({
  branchId: 1,
  originalTeacherId: 1,
  status: 1,
  date: 1,
});
const issueSchema = new Schema(
  {
    branchId: ref('Branch'),
    periodId: ref('TimetablePeriod'),
    date: day,
    substituteId: {
      type: Schema.Types.ObjectId,
      ref: 'SubstituteAssignment',
      immutable: true,
    },
    reason: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: 500,
    },
    clientOperationId: {
      type: String,
      required: true,
      immutable: true,
      match: /^[A-Za-z0-9_-]{16,80}$/,
    },
    createdBy: ref('User'),
    status: { type: String, enum: ['open'], default: 'open', required: true },
  },
  { timestamps: true },
);
issueSchema.index(
  { branchId: 1, createdBy: 1, clientOperationId: 1 },
  {
    unique: true,
    name: 'teacher_issue_operation',
    partialFilterExpression: { clientOperationId: { $type: 'string' } },
  },
);
issueSchema.index({ branchId: 1, createdBy: 1, date: 1 });
export const TimetableVersion = model('TimetableVersion', versionSchema);
export const TimetablePeriod = model('TimetablePeriod', periodSchema);
export const SubstituteAssignment = model(
  'SubstituteAssignment',
  substituteSchema,
);
export const TimetableIssue = model('TimetableIssue', issueSchema);

// Establish both uniqueness and query indexes before production accepts traffic,
// Legacy issues are retained; new uniqueness is established before removing the known old index.
export const ensureTimetableIndexes = async () => {
  await TimetableIssue.createIndexes();
  const indexes = await TimetableIssue.collection.indexes();
  for (const index of indexes) {
    const restrictive =
      index.unique &&
      Object.keys(index.key).sort().join(',') === 'createdBy,date,periodId';
    if (index.name === 'one_teacher_occurrence_issue' || restrictive) {
      if (
        index.name !== 'one_teacher_occurrence_issue' ||
        JSON.stringify(index.key) !==
          JSON.stringify({ periodId: 1, date: 1, createdBy: 1 }) ||
        !index.unique
      )
        throw new Error('Unexpected restrictive timetable issue index');
      await TimetableIssue.collection.dropIndex(index.name);
    }
  }
  await Promise.all([
    TimetableVersion.createIndexes(),
    TimetablePeriod.createIndexes(),
    SubstituteAssignment.createIndexes(),
    TimetableIssue.createIndexes(),
  ]);
};
