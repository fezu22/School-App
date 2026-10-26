import { Schema, model, Types } from 'mongoose';

export interface ITeacherAssignment {
  teacherId: Types.ObjectId;
  branchId: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId: Types.ObjectId;
  validFrom: Date;
  validUntil?: Date;
  isActive: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const ASSIGNMENT_TUPLE_KEY = {
  teacherId: 1,
  branchId: 1,
  classId: 1,
  sectionId: 1,
  subjectId: 1,
} as const;
export const ASSIGNMENT_UNIQUE_INDEX = {
  name: 'unique_active_teacher_tuple',
  unique: true,
  partialFilterExpression: { isActive: true },
} as const;

const reference = (ref: string) => ({
  type: Schema.Types.ObjectId,
  ref,
  required: true,
  immutable: true,
});
const schema = new Schema<ITeacherAssignment>(
  {
    teacherId: reference('User'),
    branchId: reference('Branch'),
    classId: reference('SchoolClass'),
    sectionId: reference('Section'),
    subjectId: reference('Subject'),
    validFrom: { type: Date, required: true, immutable: true },
    validUntil: { type: Date, immutable: true },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: reference('User'),
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revokedAt: Date,
  },
  { timestamps: true },
);

schema.pre('validate', function () {
  if (this.validUntil && this.validFrom && this.validUntil <= this.validFrom) {
    this.invalidate('validUntil', 'validUntil must be after validFrom');
  }
});

// Stronger than interval-overlap exclusion: even a future/expired active tuple
// reserves its slot until explicit revocation. Concurrent creates cannot overlap.
schema.index(ASSIGNMENT_TUPLE_KEY, ASSIGNMENT_UNIQUE_INDEX);
schema.index({ teacherId: 1, branchId: 1, isActive: 1, validFrom: 1 });
// Catalog-first timetable lookup starts with an exact academic combination,
// rather than a known Teacher. Startup already awaits createIndexes().
schema.index(
  {branchId: 1, classId: 1, sectionId: 1, subjectId: 1, isActive: 1, validFrom: 1},
  {name: 'timetable_eligible_teacher_tuple'},
);

const TeacherAssignment = model<ITeacherAssignment>(
  'TeacherAssignment',
  schema,
);
export const ensureTeacherAssignmentUniqueIndex = () =>
  TeacherAssignment.collection.createIndex(
    ASSIGNMENT_TUPLE_KEY,
    ASSIGNMENT_UNIQUE_INDEX,
  );
export default TeacherAssignment;
