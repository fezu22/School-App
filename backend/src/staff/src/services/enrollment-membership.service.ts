import mongoose, { type PipelineStage } from 'mongoose';
import {
  StudentEnrollment,
  activeEnrollmentExpression,
} from '../models/studentEnrollment';
import SchoolClass from '../models/schoolClass';
import { schoolToday, schoolTimezone } from './school-date.service';
// Managed students NEVER fall back to Student.classId/sectionId, even after
// withdrawal. Legacy snapshots are read compatibility only, with no backfill.
// Date-based attendance uses recorded membership intervals; current audiences
// and roster use only active membership. Submitted attendance keeps its snapshot.
export function enrollmentMembership(
  branchId: string,
  classId: string,
  sectionId: string,
  date?: string,
): PipelineStage[] {
  const branch = new mongoose.Types.ObjectId(branchId),
    cls = new mongoose.Types.ObjectId(classId),
    section = new mongoose.Types.ObjectId(sectionId);
  const historical = !!date && date < schoolToday();
  const at = new Date();
  const civil = (field: string) => ({
    $dateToString: {
      date: field,
      format: '%Y-%m-%d',
      timezone: schoolTimezone(),
    },
  });
  return [
    { $match: { branchId: branch, isActive: true } },
    {
      $lookup: {
        from: StudentEnrollment.collection.name,
        localField: '_id',
        foreignField: 'studentId',
        as: '_enrollments',
      },
    },
    {
      $lookup: {
        from: SchoolClass.collection.name,
        pipeline: [
          { $match: { _id: cls, branchId: branch } },
          { $project: { academicPeriodId: 1 } },
        ],
        as: '_enrollmentClass',
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            {
              $and: [
                { $eq: [{ $size: '$_enrollments' }, 0] },
                { $eq: ['$classId', cls] },
                { $eq: ['$sectionId', section] },
              ],
            },
            {
              $anyElementTrue: {
                $map: {
                  input: '$_enrollments',
                  as: 'e',
                  in: {
                    $and: [
                      { $eq: ['$$e.branchId', branch] },
                      { $eq: ['$$e.classId', cls] },
                      { $eq: ['$$e.sectionId', section] },
                      {
                        $eq: [
                          '$$e.academicPeriodId',
                          {
                            $arrayElemAt: [
                              '$_enrollmentClass.academicPeriodId',
                              0,
                            ],
                          },
                        ],
                      },
                      { $eq: [{ $type: '$$e.effectiveFrom' }, 'date'] },
                      historical
                        ? { $lte: [civil('$$e.effectiveFrom'), date] }
                        : { $lte: ['$$e.effectiveFrom', at] },
                      ...(historical
                        ? [
                            {
                              $or: [
                                {
                                  $and: [
                                    { $eq: ['$$e.status', 'active'] },
                                    {
                                      $eq: [
                                        { $ifNull: ['$$e.effectiveTo', null] },
                                        null,
                                      ],
                                    },
                                  ],
                                },
                                {
                                  $and: [
                                    {
                                      $in: [
                                        '$$e.status',
                                        [
                                          'transferred',
                                          'promoted',
                                          'withdrawn',
                                        ],
                                      ],
                                    },
                                    {
                                      $eq: [
                                        { $type: '$$e.effectiveTo' },
                                        'date',
                                      ],
                                    },
                                    {
                                      $gte: [
                                        '$$e.effectiveTo',
                                        '$$e.effectiveFrom',
                                      ],
                                    },
                                    { $gt: [civil('$$e.effectiveTo'), date] },
                                  ],
                                },
                              ],
                            },
                          ]
                        : [activeEnrollmentExpression('$$e', at)]),
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    },
    { $unset: ['_enrollments', '_enrollmentClass'] },
  ];
}
