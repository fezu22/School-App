import { Schema, model } from 'mongoose';
import { ensureLivePresenceIndexes } from './liveLessonPresence';
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
    timetableVersionId: ref('TimetableVersion'),
    periodId: ref('TimetablePeriod'),
    date: { type: String, required: true, immutable: true },
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    scheduledTeacherId: ref('User'),
    hostTeacherId: ref('User'),
    substituteId: {
      type: Schema.Types.ObjectId,
      ref: 'SubstituteAssignment',
      immutable: true,
    },
    provider: { type: String, required: true, immutable: true },
    providerRoomId: { type: String, required: true, immutable: true },
    scheduledStart: { type: Date, required: true, immutable: true },
    scheduledEnd: { type: Date, required: true, immutable: true },
    status: {
      type: String,
      enum: ['scheduled', 'starting', 'live', 'ended', 'cancelled', 'failed'],
      required: true,
      default: 'scheduled',
    },
    startedAt: Date,
    endedAt: Date,
    revision: { type: Number, required: true, default: 1 },
    history: [
      {
        _id: false,
        status: { type: String, required: true },
        at: { type: Date, required: true },
        actorId: { type: Schema.Types.ObjectId, required: true },
      },
    ],
  },
  { timestamps: true },
);
schema.index(
  { periodId: 1, date: 1 },
  { unique: true, name: 'unique_live_lesson_occurrence' },
);
schema.index(
  { provider: 1, providerRoomId: 1 },
  { unique: true, name: 'unique_live_lesson_room' },
);
schema.index({
  branchId: 1,
  academicPeriodId: 1,
  status: 1,
  scheduledStart: -1,
});
export const LiveLessonSession = model('LiveLessonSession', schema);
export const ensureLiveLessonIndexes = () =>
  Promise.all([LiveLessonSession.createIndexes(), ensureLivePresenceIndexes()]);
