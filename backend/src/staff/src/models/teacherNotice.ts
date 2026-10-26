import { Schema, model } from 'mongoose';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
const noticeSchema = new Schema(
  {
    branchId: ref('Branch'),
    createdBy: ref('User'),
    createdByRole: {
      type: String,
      enum: ['teacher'],
      default: 'teacher',
      required: true,
    },
    audienceType: { type: String, enum: ['class_students'], required: true },
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    subjectId: ref('Subject'),
    title: { type: String, required: true, maxlength: 150 },
    body: { type: String, required: true, maxlength: 2000 },
    language: { type: String, enum: ['en', 'ur'], required: true },
    state: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      required: true,
    },
    revision: { type: Number, default: 0, required: true },
    publishedAt: Date,
    recipientCount: { type: Number, default: 0, required: true },
    clientOperationId: String,
  },
  { timestamps: true },
);
noticeSchema.index({ branchId: 1, createdBy: 1, createdAt: -1 });
noticeSchema.index({
  branchId: 1,
  state: 1,
  classId: 1,
  sectionId: 1,
  subjectId: 1,
  createdAt: -1,
});
const deliverySchema = new Schema(
  {
    branchId: ref('Branch'),
    noticeId: ref('TeacherNotice'),
    studentId: ref('Student'),
    recipientUserId: ref('User'),
    state: { type: String, enum: ['accepted_internal'], required: true },
    acceptedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
deliverySchema.index({ noticeId: 1, studentId: 1 }, { unique: true });
deliverySchema.index({ branchId: 1, recipientUserId: 1, createdAt: -1 });
const operationSchema = new Schema(
  {
    createdBy: ref('User'),
    branchId: ref('Branch'),
    noticeId: ref('TeacherNotice'),
    clientOperationId: { type: String, required: true },
    payloadHash: { type: String, required: true },
  },
  { timestamps: true },
);
operationSchema.index({ createdBy: 1, clientOperationId: 1 }, { unique: true });
export const TeacherNotice = model('TeacherNotice', noticeSchema);
export const NoticeDelivery = model('NoticeDelivery', deliverySchema);
export const NoticeOperation = model('NoticeOperation', operationSchema);
export const ensureTeacherNoticeIndexes = () =>
  Promise.all([
    TeacherNotice.createIndexes(),
    NoticeDelivery.createIndexes(),
    NoticeOperation.createIndexes(),
  ]);
