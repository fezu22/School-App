import {Types} from 'mongoose';

import SchoolNotice, {
  ISchoolNotice,
  SCHOOL_NOTICE_STATUSES,
} from '../models/schoolNotice';

const validateObjectId = (
  value: string,
  fieldName: string,
): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

export const getBranchSchoolNotices = async (
  branchId: string,
): Promise<ISchoolNotice[]> => {
  validateObjectId(branchId, 'branch ID');

  const branchObjectId = new Types.ObjectId(branchId);
  const now = new Date();

  const notices = await SchoolNotice.collection
    .find({
      branchId: branchObjectId,
      status: SCHOOL_NOTICE_STATUSES.PUBLISHED,
      $or: [
        {expiresAt: {$exists: false}},
        {expiresAt: null},
        {expiresAt: {$gt: now}},
      ],
    })
    .sort({createdAt: -1})
    .toArray();

  return notices as unknown as ISchoolNotice[];
};

export const getSchoolNoticeById = async (
  noticeId: string,
  branchId: string,
): Promise<ISchoolNotice> => {
  validateObjectId(noticeId, 'notice ID');
  validateObjectId(branchId, 'branch ID');

  const notice = await SchoolNotice.collection.findOne({
    _id: new Types.ObjectId(noticeId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!notice) {
    throw new Error('School notice not found');
  }

  return notice as unknown as ISchoolNotice;
};