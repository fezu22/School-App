import { Schema, model } from 'mongoose';

const owner = {
  branchId: {
    type: Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
    index: true,
  },
  teacherId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
};
// Read-side records supplied by trusted payroll/HR provisioning only. No Teacher
// upload, release, salary calculation or storage URL is accepted by this module.
const file = {
  content: { type: Buffer, select: false },
  mime: { type: String, enum: ['application/pdf', 'image/png', 'image/jpeg'] },
};
const payslip = new Schema(
  {
    ...owner,
    period: { type: String, required: true, maxlength: 80 },
    status: { type: String, enum: ['draft', 'approved'], required: true },
    approvedAt: Date,
    netAmount: { type: Number, min: 0 },
    currency: { type: String, match: /^[A-Z]{3}$/ },
    ...file,
    hasFile: { type: Boolean, default: false },
  },
  { timestamps: true },
);
payslip.index({ branchId: 1, teacherId: 1, period: 1 }, { unique: true });
const document = new Schema(
  {
    ...owner,
    title: { type: String, required: true, maxlength: 120 },
    documentType: { type: String, required: true, maxlength: 80 },
    expiresOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    visibleToOwner: { type: Boolean, default: false },
    ...file,
    hasFile: { type: Boolean, default: false },
  },
  { timestamps: true },
);
const leave = new Schema(
  {
    ...owner,
    leaveType: {
      type: String,
      enum: ['personal', 'sick', 'unpaid'],
      required: true,
    },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    days: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, maxlength: 350 },
    approvalRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ApprovalRequest',
      required: true,
    },
  },
  { timestamps: true },
);
leave.index({ approvalRequestId: 1 }, { unique: true });
const history = new Schema(
  {
    action: {
      type: String,
      enum: ['offered', 'confirmed', 'rescheduled', 'cancelled', 'completed'],
      required: true,
    },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);
const appointment = new Schema(
  {
    ...owner,
    title: { type: String, required: true, maxlength: 120 },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    status: {
      type: String,
      enum: ['available', 'confirmed', 'cancelled', 'completed'],
      required: true,
    },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    classId: { type: Schema.Types.ObjectId, ref: 'Class' },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section' },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject' },
    revision: { type: Number, default: 1, required: true },
    history: { type: [history], default: [] },
  },
  { timestamps: true },
);
appointment.index({
  branchId: 1,
  teacherId: 1,
  date: 1,
  status: 1,
  startTime: 1,
  endTime: 1,
});
const receipt = new Schema(
  {
    ...owner,
    clientOperationId: { type: String, required: true },
    fingerprint: { type: String, required: true },
    resultId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
receipt.index({ teacherId: 1, clientOperationId: 1 }, { unique: true });

export const StaffPayslip = model('StaffPayslip', payslip);
export const StaffDocument = model('StaffDocument', document);
export const StaffLeave = model('StaffLeave', leave);
export const StaffAppointment = model('StaffAppointment', appointment);
export const StaffSelfServiceReceipt = model(
  'StaffSelfServiceReceipt',
  receipt,
);
export const ensureStaffSelfServiceIndexes = async () => {
  await Promise.all(
    [
      StaffPayslip,
      StaffDocument,
      StaffLeave,
      StaffAppointment,
      StaffSelfServiceReceipt,
    ].map(m => m.createIndexes()),
  );
};
