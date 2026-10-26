import { Types } from 'mongoose';

import Attendance from '../models/attendance';

export interface AttendanceSummary {
  totalMarked: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  attendancePercentage: number;
}

const validateObjectId = (value: string, fieldName: string): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const endOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

export const getBranchAttendanceSummary = async (
  branchId: string,
  date: Date = new Date(),
): Promise<AttendanceSummary> => {
  validateObjectId(branchId, 'branch ID');

  const branchObjectId = new Types.ObjectId(branchId);
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const summary = await Attendance.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        date: {
          $gte: dayStart,
          $lte: dayEnd,
        },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = {
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
  };

  for (const item of summary) {
    const status = item._id as 'present' | 'absent' | 'late' | 'leave';

    if (
      status === 'present' ||
      status === 'absent' ||
      status === 'late' ||
      status === 'leave'
    ) {
      counts[status] = item.count;
    }
  }

  const totalMarked =
    counts.present + counts.absent + counts.late + counts.leave;

  const attendancePercentage =
    totalMarked > 0
      ? Number(
          (((counts.present + counts.late) / totalMarked) * 100).toFixed(2),
        )
      : 0;

  return {
    totalMarked,
    present: counts.present,
    absent: counts.absent,
    late: counts.late,
    leave: counts.leave,
    attendancePercentage,
  };
};
