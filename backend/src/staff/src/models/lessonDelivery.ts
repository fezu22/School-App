import { Schema, model } from 'mongoose';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const evidence = new Schema(
  {
    topicId: { type: Schema.Types.ObjectId, required: true },
    state: {
      type: String,
      enum: ['completed', 'partial', 'not_covered'],
      required: true,
    },
    evidence: { type: String, required: true, maxlength: 1000 },
  },
  { _id: false },
);
const entry = new Schema(
  {
    revision: { type: Number, required: true },
    deliveryStatus: {
      type: String,
      enum: ['delivered', 'partially_delivered', 'not_delivered'],
      required: true,
    },
    actualTeachingDate: { type: String, required: true },
    topics: { type: [evidence], required: true },
    teacherNotes: { type: String, default: '', maxlength: 4000 },
    correctionReason: { type: String, default: '', maxlength: 500 },
    recordedBy: ref('User'),
    recordedByName: { type: String, required: true },
    recordedAt: { type: Date, required: true },
    clientOperationId: { type: String, required: true },
    fingerprint: { type: String, required: true },
  },
  { _id: false },
);
const schema = new Schema(
  {
    branchId: ref('Branch'),
    lessonPlanId: ref('LessonPlan'),
    lessonPlanRevision: { type: Number, required: true, immutable: true },
    teacherId: ref('User'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    academicYear: { type: String, required: true, immutable: true },
    syllabusId: ref('Syllabus'),
    syllabusVersion: { type: Number, required: true, immutable: true },
    unitId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    plannedTopicIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      immutable: true,
    },
    teachingDate: { type: String, required: true, immutable: true },
    occurrence: {
      type: new Schema(
        {
          periodId: ref('TimetablePeriod'),
          timetableVersionId: ref('TimetableVersion'),
          date: { type: String, required: true },
          substituteId: { type: Schema.Types.ObjectId },
        },
        { _id: false },
      ),
      immutable: true,
    },
    state: {
      type: String,
      enum: ['recorded', 'voided'],
      required: true,
      default: 'recorded',
    },
    revision: { type: Number, required: true, default: 1 },
    history: { type: [entry], required: true },
  },
  { timestamps: true },
);
schema.index({ lessonPlanId: 1 }, { unique: true });
schema.index({
  branchId: 1,
  syllabusId: 1,
  classId: 1,
  sectionId: 1,
  subjectId: 1,
  state: 1,
});
export const LessonDelivery = model('LessonDelivery', schema);
