import {Types} from 'mongoose';

import PrivilegedRequest, {
  IPrivilegedRequest,
  PrivilegedRequestStatus,
} from '../models/privilegedRequest';

export const getPendingPrivilegedRequests =
  async (): Promise<IPrivilegedRequest[]> => {
    return PrivilegedRequest.find({status: 'pending'})
      .populate('requesterId', 'fullName email role')
      .populate('branchId', 'name code')
      .sort({createdAt: -1});
  };

export const reviewPrivilegedRequest = async (
  requestId: string,
  status: Extract<PrivilegedRequestStatus, 'approved' | 'rejected'>,
  reviewedBy: string,
): Promise<IPrivilegedRequest> => {
  if (!Types.ObjectId.isValid(requestId)) {
    throw new Error('Invalid request ID');
  }

  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid status');
  }

  if (!Types.ObjectId.isValid(reviewedBy)) {
    throw new Error('Invalid reviewer ID');
  }

  const updated = await PrivilegedRequest.findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    {
      $set: {
        status,
        reviewedBy: new Types.ObjectId(reviewedBy),
        reviewedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  );

  if (updated) return updated;

  const exists = await PrivilegedRequest.exists({ _id: requestId });
  if (!exists) throw new Error('Privileged request not found');
  throw new Error('Only pending requests can be reviewed');
};
