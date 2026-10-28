const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { createClassTeacherApplication } = require('./applicationService');
const { normalizeInvoiceStatuses } = require('./invoiceStatus');
const parentPaymentRoutes = require('./parentPaymentRoutes');
const { createLearnerFeatureRouter } = require('./learnerFeatureRoutes');
const {
  apiId,
  assertSameBranch,
  referenceFieldQuery,
  referenceValues,
  resolveRecordReference,
  resolveUserReference,
  resolveUserForRole,
  unresolvedClassReference,
} = require('./identityReferenceAdapter');
const {
  assertRecordTenantScope,
  combineTenantFilter,
  resolveVerifiedTenantScope,
} = require('./schoolAccess');

const router = express.Router();

function requireParentContext(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, error: 'Trusted user context is required.' });
  }
  if (req.user.role !== 'parent') {
    return res
      .status(403)
      .json({ success: false, error: 'Parent access is required.' });
  }
  (async () => {
    const db = getDatabase();
    const identity = await resolveUserForRole(db, userId, 'parent');
    const tenantScope = await resolveVerifiedTenantScope(db, identity, { requireBranch: true });
    Object.defineProperty(identity, 'tenantScope', {
      value: tenantScope,
      enumerable: false,
      configurable: true,
    });
    req.parentIdentity = identity;
    req.parentUserId = apiId(identity);
    req.tenantScope = tenantScope;
    return next();
  })().catch(next);
}

function verifiedLinkFilter(parentUserId, studentId) {
  const filter = {
    parentUserId: Array.isArray(parentUserId)
      ? { $in: parentUserId }
      : parentUserId && typeof parentUserId === 'object'
      ? { $in: referenceValues(parentUserId) }
      : parentUserId,
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  };
  if (studentId) filter.studentId = studentId;
  return filter;
}

async function getVerifiedChild(parentUserId, studentId) {
  const db = getDatabase();
  const parentIdentity = parentUserId && typeof parentUserId === 'object'
    ? parentUserId
    : await resolveUserForRole(db, parentUserId, 'parent');
  const tenantScope =
    parentIdentity.tenantScope ||
    await resolveVerifiedTenantScope(db, parentIdentity, { requireBranch: true });
  const requestedStudent = referenceFieldQuery('studentId', studentId);
  if (!requestedStudent) return null;
  const candidates = await db.collection('parentChildLinks')
    .find({
      revokedAt: null,
      status: { $ne: 'revoked' },
      $or: [{ status: 'verified' }, { verified: true }],
      $and: [{ $or: requestedStudent.$or }],
    })
    .limit(50)
    .toArray();
  let link = null;
  for (const candidate of candidates) {
    const linkedParent = await resolveUserReference(db, candidate.parentUserId);
    if (String(linkedParent._id) === String(parentIdentity._id)) {
      assertRecordTenantScope(tenantScope, candidate, 'Parent link', {
        requireSchoolOnRecord: false,
        requireBranchMatch: false,
      });
      link = candidate;
      break;
    }
  }
  if (!link) return null;
  const linkedStudent = await resolveRecordReference(db, 'students', link.studentId, { label: 'Student' });
  const requestedRecord = await resolveRecordReference(db, 'students', studentId, { label: 'Student' });
  if (String(linkedStudent._id) !== String(requestedRecord._id)) return null;
  await assertSameBranch(db, parentIdentity.branchId, linkedStudent.branchId, tenantScope.schoolIdHex);
  assertRecordTenantScope(tenantScope, linkedStudent, 'Student');
  const response = {
    id: apiId(linkedStudent),
    name: linkedStudent.name,
    fullName: linkedStudent.fullName,
    grade: linkedStudent.grade,
    section: linkedStudent.section,
    classId: linkedStudent.classId,
    status: linkedStudent.status,
  };
  Object.defineProperties(response, {
    branchId: { value: linkedStudent.branchId, enumerable: false, configurable: true },
    schoolId: { value: linkedStudent.schoolId, enumerable: false, configurable: true },
    tenantScope: { value: tenantScope, enumerable: false, configurable: true },
  });
  return response;
}

async function listVerifiedChildren(parentIdentity) {
  const db = getDatabase();
  const tenantScope =
    parentIdentity?.tenantScope ||
    await resolveVerifiedTenantScope(db, parentIdentity, { requireBranch: true });
  const links = await db.collection('parentChildLinks')
    .find(verifiedLinkFilter(parentIdentity))
    .limit(500)
    .toArray();
  const unique = new Map();
  for (const link of links) {
    const linkedParent = await resolveUserReference(db, link.parentUserId);
    if (String(linkedParent._id) !== String(parentIdentity._id)) continue;
    assertRecordTenantScope(tenantScope, link, 'Parent link', {
      requireSchoolOnRecord: false,
      requireBranchMatch: false,
    });
    const student = await resolveRecordReference(db, 'students', link.studentId, { label: 'Student' });
    await assertSameBranch(db, parentIdentity.branchId, student.branchId, tenantScope.schoolIdHex);
    assertRecordTenantScope(tenantScope, student, 'Student');
    unique.set(String(student._id), student);
  }
  return [...unique.values()];
}

function dateRange(query, field) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const isDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return { error: 'from and to must be valid YYYY-MM-DD dates.' };
  }
  if (from && to && from > to)
    return { error: 'from must be on or before to.' };
  if (!from && !to) return { filter: {} };
  const lower = from
    ? new Date(`${from}T00:00:00.000Z`)
    : new Date('1970-01-01T00:00:00.000Z');
  const upper = to ? new Date(`${to}T00:00:00.000Z`) : null;
  if (upper) upper.setUTCDate(upper.getUTCDate() + 1);
  return {
    filter: { [field]: { $gte: lower, ...(upper ? { $lt: upper } : {}) } },
  };
}

function childScheduleFilter(child) {
  const scope = [{ studentId: child.id }, { studentIds: child.id }];
  if (child.classId) scope.push({ classId: child.classId });
  return { $or: scope };
}

function publishedFilter() {
  return { $or: [{ published: true }, { status: 'published' }] };
}

function ownedChildFilter(child, extra = {}) {
  return { ...extra, studentId: child.id };
}

function scopedParentQuery(req, filter, options = {}) {
  return combineTenantFilter(req.tenantScope || req.parentChild?.tenantScope || req.parentIdentity?.tenantScope, filter, options);
}

router.use(requireParentContext);
router.use('/payments', parentPaymentRoutes);

router.get('/notifications', async (req, res, next) => {
  try {
    const children = await listVerifiedChildren(req.parentIdentity);
    const classIds = [
      ...new Set(children.map(child => child.classId).filter(Boolean)),
    ];
    const dlpNotifications = classIds.length
      ? await getDatabase()
          .collection('parentNotifications')
          .find(
            scopedParentQuery(req, {
              parentUserId: req.parentUserId,
              type: 'parent_dlp_shared',
              classId: { $in: classIds },
            }),
            { projection: { parentUserId: 0 } },
          )
          .sort({ createdAt: -1 })
          .toArray()
      : [];
    const recipientNotifications = await getDatabase()
      .collection('notifications')
      .find(
        scopedParentQuery(
          req,
          { recipientUserId: req.parentUserId, recipientRole: 'parent' },
          { includeBranch: false },
        ),
        { projection: { recipientUserId: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const notifications = [...dlpNotifications, ...recipientNotifications]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 100);
    const unreadCount = notifications.reduce(
      (count, notification) => count + (notification.readAt ? 0 : 1),
      0,
    );
    return res.json({
      success: true,
      data: { notifications, unreadCount },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/notifications/:notificationId/read', async (req, res, next) => {
  try {
    const id = req.params.notificationId;
    const identity = [{ id }];
    if (ObjectId.isValid(id)) identity.push({ _id: new ObjectId(id) });
    const collection = getDatabase().collection('parentNotifications');
    const notification = await collection.findOne(
      scopedParentQuery(req, {
        parentUserId: req.parentUserId,
        type: 'parent_dlp_shared',
        $or: identity,
      }),
    );
    if (!notification) {
      const generic = getDatabase().collection('notifications');
      const result = await generic.updateOne(
        scopedParentQuery(
          req,
          {
            recipientUserId: req.parentUserId,
            recipientRole: 'parent',
            $or: identity,
            readAt: null,
          },
          { includeBranch: false },
        ),
        { $set: { readAt: new Date() } },
      );
      if (!result.matchedCount) {
        const exists = await generic.findOne(
          scopedParentQuery(
            req,
            {
              recipientUserId: req.parentUserId,
              recipientRole: 'parent',
              $or: identity,
            },
            { includeBranch: false },
          ),
        );
        if (!exists) {
          return res.status(404).json({
            success: false,
            error: 'Parent notification was not found.',
          });
        }
      }
      return res.json({ success: true, data: { read: true } });
    }

    const children = await listVerifiedChildren(req.parentIdentity);
    const hasClassAccess = children.some(
      child =>
        String(child.classId) === String(notification.classId) &&
        (!notification.section || String(child.section) === String(notification.section)),
    );
    if (!hasClassAccess) {
      return res.status(404).json({
        success: false,
        error: 'No verified linked child belongs to this notification class.',
      });
    }

    await collection.updateOne(
      scopedParentQuery(req, {
        _id: notification._id,
        parentUserId: req.parentUserId,
        type: 'parent_dlp_shared',
        classId: notification.classId,
      }),
      { $set: { readAt: new Date() } },
    );
    return res.json({ success: true, data: { read: true } });
  } catch (error) {
    return next(error);
  }
});

router.get('/notifications/:notificationId', async (req, res, next) => {
  try {
    const id = req.params.notificationId;
    const notificationMatch = [{ id }];
    if (ObjectId.isValid(id)) notificationMatch.push({ _id: new ObjectId(id) });
    const notification = await getDatabase()
      .collection('parentNotifications')
      .findOne(
        scopedParentQuery(req, {
          parentUserId: req.parentUserId,
          type: 'parent_dlp_shared',
          $or: notificationMatch,
        }),
      );
    if (!notification) {
      const genericNotification = await getDatabase()
        .collection('notifications')
        .findOne(
          scopedParentQuery(
            req,
            {
              recipientUserId: req.parentUserId,
              recipientRole: 'parent',
              $or: notificationMatch,
            },
            { includeBranch: false },
          ),
        );
      if (!genericNotification) {
        return res.status(404).json({
          success: false,
          error: 'Parent notification was not found.',
        });
      }
      const safeNotification = { ...genericNotification };
      delete safeNotification.recipientUserId;
      return res.json({ success: true, data: safeNotification });
    }

    const children = await listVerifiedChildren(req.parentIdentity);
    const hasClassAccess = children.some(
      child =>
        String(child.classId) === String(notification.classId) &&
        (!notification.section || String(child.section) === String(notification.section)),
    );
    if (!hasClassAccess) {
      return res.status(404).json({
        success: false,
        error: 'No verified linked child belongs to this DLP class.',
      });
    }

    const versionId = String(notification.dlpVersionId || '');
    const versionMatch = [{ id: versionId }];
    if (ObjectId.isValid(versionId))
      versionMatch.push({ _id: new ObjectId(versionId) });
    const dlpVersion = await getDatabase().collection('dlpVersions').findOne(
      scopedParentQuery(req, {
        $or: versionMatch,
        classId: notification.classId,
        ...(notification.section ? { section: notification.section } : {}),
        audience: 'parent',
        status: 'published',
      }),
    );
    if (!dlpVersion) {
      return res.status(404).json({
        success: false,
        error: 'The exact shared Parent DLP version is no longer available.',
      });
    }
    const safeDlpVersion = { ...dlpVersion };
    delete safeDlpVersion.internalStaffNotes;
    return res.json({ success: true, data: { notification, dlpVersion: safeDlpVersion } });
  } catch (error) {
    return next(error);
  }
});

router.get('/children', async (req, res, next) => {
  try {
    const children = await listVerifiedChildren(req.parentIdentity);
    const data = children.map(child => ({
      id: apiId(child),
      name: child.name,
      fullName: child.fullName,
      grade: child.grade,
      section: child.section,
      classId: child.classId,
      status: child.status,
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.use('/children/:studentId', async (req, res, next) => {
  try {
    const child = await getVerifiedChild(
      req.parentIdentity,
      req.params.studentId,
    );
    if (!child) {
      return res
        .status(404)
        .json({ success: false, error: 'No verified linked child was found.' });
    }
    req.parentChild = child;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.use('/children/:studentId/features', createLearnerFeatureRouter({
  getStudent: req => req.parentChild,
  getActor: req => ({ id: req.parentUserId, role: 'parent' }),
}));

router.get('/children/:studentId/applications', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('classTeacherApplications')
      .find(
        scopedParentQuery(req, {
          applicantUserId: req.parentUserId,
          applicantRole: 'parent',
          studentId: req.parentChild.id,
        }),
        { projection: { applicantUserId: 0, assignedTeacherUserId: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/children/:studentId/applications', async (req, res, next) => {
  try {
    const result = await createClassTeacherApplication({
      input: req.body,
      applicant: { id: req.parentUserId },
      student: req.parentChild,
      applicantRole: 'parent',
    });
    if (result.error) {
      return res
        .status(result.statusCode)
        .json({ success: false, error: result.error });
    }
    return res
      .status(result.statusCode)
      .json({ success: true, data: result.data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId', (req, res) =>
  res.json({ success: true, data: req.parentChild }),
);

router.get('/children/:studentId/attendance', async (req, res, next) => {
  try {
    const range = dateRange(req.query, 'date');
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const data = await getDatabase()
      .collection('attendance')
      .find(scopedParentQuery(req, ownedChildFilter(req.parentChild, range.filter)))
      .sort({ date: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/timetable', async (req, res, next) => {
  try {
    if (req.parentChild.classId) unresolvedClassReference();
    const data = await getDatabase()
      .collection('timetable')
      .find(scopedParentQuery(req, childScheduleFilter(req.parentChild)))
      .sort({ dayOfWeek: 1, startTime: 1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/homework', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('homework')
      .find(scopedParentQuery(req, { $and: [publishedFilter(), childScheduleFilter(req.parentChild)] }))
      .sort({ dueDate: 1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/results', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('results')
      .find(scopedParentQuery(req, ownedChildFilter(req.parentChild, publishedFilter())))
      .sort({ publishedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/progress', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('progress')
      .find(scopedParentQuery(req, ownedChildFilter(req.parentChild, publishedFilter())))
      .sort({ updatedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/fees', async (req, res, next) => {
  try {
    const paymentScopeMatch = req.tenantScope?.schoolFilter || {};
    const data = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: scopedParentQuery(req, { studentId: req.parentChild.id }) },
        {
          $lookup: {
            from: 'payments',
            let: { invoiceId: '$id', invoiceBranchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  ...paymentScopeMatch,
                  $expr: {
                    $and: [
                      { $eq: ['$invoiceId', '$$invoiceId'] },
                      { $eq: ['$studentId', req.parentChild.id] },
                      { $eq: ['$branchId', '$$invoiceBranchId'] },
                      { $in: ['$status', ['confirmed', 'pending_verification']] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  paidAmount: {
                    $sum: {
                      $cond: [{ $eq: ['$status', 'confirmed'] }, '$amount', 0],
                    },
                  },
                  pendingAmount: {
                    $sum: {
                      $cond: [
                        { $eq: ['$status', 'pending_verification'] },
                        '$amount',
                        0,
                      ],
                    },
                  },
                  confirmedReceipts: {
                    $push: {
                      $cond: [
                        { $eq: ['$status', 'confirmed'] },
                        {
                          paymentId: { $toString: '$_id' },
                          receiptNumber: '$receiptNumber',
                          amount: '$amount',
                          currency: '$currency',
                          method: '$method',
                          confirmedAt: '$confirmedAt',
                        },
                        null,
                      ],
                    },
                  },
                },
              },
              {
                $project: {
                  paidAmount: 1,
                  pendingAmount: 1,
                  confirmedReceipts: {
                    $filter: {
                      input: '$confirmedReceipts',
                      as: 'receipt',
                      cond: { $ne: ['$$receipt', null] },
                    },
                  },
                },
              },
            ],
            as: 'confirmedPayments',
          },
        },
        {
          $addFields: {
            confirmedPaidAmount: {
              $ifNull: [
                { $arrayElemAt: ['$confirmedPayments.paidAmount', 0] },
                0,
              ],
            },
            pendingAmount: {
              $ifNull: [
                { $arrayElemAt: ['$confirmedPayments.pendingAmount', 0] },
                0,
              ],
            },
            confirmedReceipts: {
              $ifNull: [
                { $arrayElemAt: ['$confirmedPayments.confirmedReceipts', 0] },
                [],
              ],
            },
            balanceDue: {
              $max: [
                {
                  $subtract: [
                    { $ifNull: ['$amount', 0] },
                    {
                      $ifNull: [
                        { $arrayElemAt: ['$confirmedPayments.paidAmount', 0] },
                        0,
                      ],
                    },
                  ],
                },
                0,
              ],
            },
            availableBalance: {
              $max: [
                {
                  $subtract: [
                    { $ifNull: ['$amount', 0] },
                    {
                      $add: [
                        {
                          $ifNull: [
                            { $arrayElemAt: ['$confirmedPayments.paidAmount', 0] },
                            0,
                          ],
                        },
                        {
                          $ifNull: [
                            { $arrayElemAt: ['$confirmedPayments.pendingAmount', 0] },
                            0,
                          ],
                        },
                      ],
                    },
                  ],
                },
                0,
              ],
            },
          },
        },
        { $project: { confirmedPayments: 0, voucherCode: 0 } },
        { $sort: { dueDate: -1 } },
      ])
      .toArray();
    return res.json({ success: true, data: normalizeInvoiceStatuses(data) });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/feedback', async (req, res, next) => {
  try {
    const studentId = req.parentChild.id;
    const homeworkScopeMatch = scopedParentQuery(req, {});
    const [homework, results, progress] = await Promise.all([
      getDatabase()
        .collection('submissions')
        .aggregate([
          {
            $match: scopedParentQuery(
              req,
              {
                studentId,
                $or: [
                  { teacherFeedback: { $type: 'string', $ne: '' } },
                  { feedback: { $type: 'string', $ne: '' } },
                ],
              },
              { includeBranch: false },
            ),
          },
          {
            $lookup: {
              from: 'homework',
              let: { submissionHomeworkId: '$homeworkId' },
              pipeline: [
                {
                  $match: {
                    ...homeworkScopeMatch,
                    $expr: {
                      $or: [
                        { $eq: ['$id', '$$submissionHomeworkId'] },
                        {
                          $eq: [
                            { $toString: '$_id' },
                            '$$submissionHomeworkId',
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
              as: 'homework',
            },
          },
          { $unwind: { path: '$homework', preserveNullAndEmptyArrays: true } },
          { $project: { fileData: 0 } },
          { $sort: { submittedAt: -1 } },
        ])
        .toArray(),
      getDatabase()
        .collection('results')
        .find(
          scopedParentQuery(req, {
            $and: [
              { studentId },
              publishedFilter(),
              {
                $or: [
                  { teacherFeedback: { $type: 'string', $ne: '' } },
                  { feedback: { $type: 'string', $ne: '' } },
                ],
              },
            ],
          }),
        )
        .sort({ publishedAt: -1 })
        .toArray(),
      getDatabase()
        .collection('progress')
        .find(
          scopedParentQuery(req, {
            $and: [
              ownedChildFilter(req.parentChild, publishedFilter()),
              {
                $or: [
                  { teacherFeedback: { $type: 'string', $ne: '' } },
                  { feedback: { $type: 'string', $ne: '' } },
                ],
              },
            ],
          }),
        )
        .sort({ updatedAt: -1 })
        .toArray(),
    ]);
    return res.json({ success: true, data: { homework, results, progress } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.__test = {
  getVerifiedChild,
  ownedChildFilter,
  scopedParentQuery,
  publishedFilter,
  requireParentContext,
  listVerifiedChildren,
  verifiedLinkFilter,
};
