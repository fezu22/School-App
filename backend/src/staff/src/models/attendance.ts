import { Schema, model, Document } from 'mongoose';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';

export interface IAttendance extends Document {
  branchId: Schema.Types.ObjectId;
  classId: Schema.Types.ObjectId;
  sectionId: Schema.Types.ObjectId;
  studentId: Schema.Types.ObjectId;
  date: Date;
  status: AttendanceStatus;
  markedBy: Schema.Types.ObjectId;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'SchoolClass',
      required: true,
      index: true,
    },

    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
      index: true,
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['present', 'absent', 'late', 'leave'],
      required: true,
    },

    markedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    remarks: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
);

attendanceSchema.index(
  {
    branchId: 1,
    studentId: 1,
    date: 1,
  },
  {
    unique: true,
  },
);

attendanceSchema.index({
  branchId: 1,
  date: 1,
  classId: 1,
  sectionId: 1,
});

const Attendance = model<IAttendance>('Attendance', attendanceSchema);

export default Attendance;
