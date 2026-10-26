import {Types} from 'mongoose';

import Fee from '../models/fee';

export interface FeeSummary {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  pendingInvoices: number;
  partialInvoices: number;
  paidInvoices: number;
  overdueInvoices: number;
}

const validateObjectId = (
  value: string,
  fieldName: string,
): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

export const getBranchFeeSummary = async (
  branchId: string,
  academicYear?: string,
): Promise<FeeSummary> => {
  validateObjectId(branchId, 'branch ID');

  const branchObjectId = new Types.ObjectId(branchId);

  const match: {
    branchId: Types.ObjectId;
    academicYear?: string;
  } = {
    branchId: branchObjectId,
  };

  if (academicYear?.trim()) {
    match.academicYear = academicYear.trim();
  }

  const [summary] = await Fee.aggregate([
    {
      $match: match,
    },
    {
      $group: {
        _id: null,
        totalInvoices: {$sum: 1},
        totalAmount: {$sum: '$amount'},
        paidAmount: {$sum: '$paidAmount'},

        pendingInvoices: {
          $sum: {
            $cond: [{$eq: ['$status', 'pending']}, 1, 0],
          },
        },

        partialInvoices: {
          $sum: {
            $cond: [{$eq: ['$status', 'partial']}, 1, 0],
          },
        },

        paidInvoices: {
          $sum: {
            $cond: [{$eq: ['$status', 'paid']}, 1, 0],
          },
        },

        overdueInvoices: {
          $sum: {
            $cond: [{$eq: ['$status', 'overdue']}, 1, 0],
          },
        },
      },
    },
  ]);

  if (!summary) {
    return {
      totalInvoices: 0,
      totalAmount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      pendingInvoices: 0,
      partialInvoices: 0,
      paidInvoices: 0,
      overdueInvoices: 0,
    };
  }

  const totalAmount = Number(summary.totalAmount ?? 0);
  const paidAmount = Number(summary.paidAmount ?? 0);

  return {
    totalInvoices: Number(summary.totalInvoices ?? 0),
    totalAmount,
    paidAmount,
    outstandingAmount: Math.max(totalAmount - paidAmount, 0),
    pendingInvoices: Number(summary.pendingInvoices ?? 0),
    partialInvoices: Number(summary.partialInvoices ?? 0),
    paidInvoices: Number(summary.paidInvoices ?? 0),
    overdueInvoices: Number(summary.overdueInvoices ?? 0),
  };
};