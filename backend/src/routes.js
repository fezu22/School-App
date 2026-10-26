const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getClient, getDatabase } = require('./database');
const {
  apiId,
  referenceValues,
  resolveBranchReference,
  resolveUserForRole,
} = require('./identityReferenceAdapter');
const studentRoutes = require('./studentRoutes');
const parentRoutes = require('./parentRoutes');
const { createUserNotificationRouter } = require('./userNotificationRoutes');
const { authenticateRequest } = require('./auth');
const authRoutes = require('./authRoutes');
const applicationReviewRoutes = require('./applicationReviewRoutes');
const {
  PARTIAL_INVOICE_STATUS,
  normalizeInvoiceStatus,
  normalizeInvoiceStatuses,
  invoiceStatusFromCents,
  financeInvoiceStatusMatch,
  isFinanceInvoiceStatus,
} = require('./invoiceStatus');
const { lockInvoice, invoiceReservedCents } = require('./invoiceReservations');
const { createFinancePayrollRouter, initializeFinancePayrollIndexes } = require('./financePayrollRoutes');
const { createFinanceWorkspaceRouter, initializeFinanceWorkspaceIndexes } = require('./financeWorkspaceRoutes');
const {
  createChatRouter,
  initializeChatIndexes,
  setChatRealtimePublisher,
} = require('./chatRoutes');

const router = express.Router();
let paymentIdempotencyIndexPromise;
let paymentReferenceIndexPromise;

function ensurePaymentIdempotencyIndex(payments) {
  if (!paymentIdempotencyIndexPromise) {
    paymentIdempotencyIndexPromise = payments.createIndex(
      { branchId: 1, createdByUserId: 1, idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
        name: 'finance_payment_idempotency_by_branch',
      },
    );
  }
  return paymentIdempotencyIndexPromise;
}

function ensurePaymentReferenceIndex(payments) {
  if (!paymentReferenceIndexPromise) {
    paymentReferenceIndexPromise = payments.createIndex(
      { branchId: 1, reference: 1 },
      {
        unique: true,
        partialFilterExpression: { reference: { $type: 'string' } },
        name: 'finance_payment_reference_by_branch',
      },
    );
  }
  return paymentReferenceIndexPromise;
}

async function getInvoicePaymentTotals(payments, invoiceId, branchValues, session) {
  const [totals] = await payments
    .aggregate(
      [
        { $match: { invoiceId, branchId: { $in: branchValues } } },
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
          },
        },
      ],
      session ? { session } : {},
    )
    .toArray();
  return {
    paidAmount: totals?.paidAmount || 0,
    pendingAmount: totals?.pendingAmount || 0,
  };
}

function requireFinanceContext(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  const branchId =
    typeof req.user?.branchId === 'string' ? req.user.branchId.trim() : '';
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, error: 'Trusted user context is required.' });
  }
  if (req.user.role !== 'finance') {
    return res
      .status(403)
      .json({ success: false, error: 'Finance access is required.' });
  }
  if (!branchId) {
    return res.status(403).json({
      success: false,
      error: 'Trusted Finance branch context is required.',
    });
  }
  (async () => {
    const db = getDatabase();
    const identity = await resolveUserForRole(db, userId, 'finance');
    const branch = await resolveBranchReference(db, identity.branchId);
    req.authenticatedIdentity = identity;
    req.financeContext = {
      userId: apiId(identity),
      branchId,
      branch,
      branchValues: referenceValues(branch, '_id'),
      branchFilter: { $in: referenceValues(branch, '_id') },
    };
    return next();
  })().catch(next);
}

const notFound = (res, entity, id) =>
  res
    .status(404)
    .json({ success: false, error: `${entity} ${id} was not found` });

router.use('/auth', authRoutes);
router.use(authenticateRequest);
router.use('/exam-papers', require('./examPapers').createExamPaperRouter());
router.use('/students/me', studentRoutes);
router.use('/parents/me', parentRoutes);
router.use('/chat', createChatRouter());
router.use('/applications', applicationReviewRoutes);
router.use('/finance', requireFinanceContext);
router.use('/finance/payroll', createFinancePayrollRouter());
router.use('/finance', createFinanceWorkspaceRouter());
router.use(
  '/finance/me/notifications',
  createUserNotificationRouter('finance'),
);

function dateRange(query) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !datePattern.test(from)) || (to && !datePattern.test(to))) {
    return { error: 'from and to must use YYYY-MM-DD format.' };
  }
  const filter = {};
  if (from || to) {
    filter.$gte = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date('1970-01-01T00:00:00.000Z');
    if (to) {
      const end = new Date(`${to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      filter.$lt = end;
    }
  }
  if (from && to && from > to)
    return { error: 'from must be on or before to.' };
  return {
    filter: from || to ? filter : null,
    from: from || null,
    to: to || null,
  };
}

function escapedRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FINANCE_PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'card',
  'easypaisa',
  'cheque',
  'other',
];

function requiresPaymentReference(method) {
  return ['bank_transfer', 'card', 'easypaisa', 'cheque'].includes(method);
}

function rejectedInvoiceState(invoiceAmount, totals, rejectedAmount) {
  const paidAmount = Math.round(Number(totals.paidAmount) * 100) / 100;
  const pendingPaymentAmount =
    Math.max(
      Math.round(Number(totals.pendingAmount) * 100) -
        Math.round(Number(rejectedAmount) * 100),
      0,
    ) / 100;
  const balanceDue =
    Math.max(
      Math.round(Number(invoiceAmount) * 100) -
        Math.round(paidAmount * 100),
      0,
    ) / 100;
  return {
    paidAmount,
    pendingPaymentAmount,
    balanceDue,
    status: invoiceStatusFromCents(
      Math.round(Number(invoiceAmount) * 100),
      Math.round(paidAmount * 100),
    ),
    paymentStatus:
      balanceDue === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
    availableBalance: Math.max(balanceDue - pendingPaymentAmount, 0),
  };
}

function financeListFilters(query) {
  const range = dateRange(query);
  if (range.error) return { error: range.error };
  const studentId = String(query.studentId || '').trim();
  const method = String(query.method || '').trim().toLowerCase();
  if (studentId.length > 120)
    return { error: 'Student ID filter is too long.' };
  if (method && !FINANCE_PAYMENT_METHODS.includes(method))
    return {
      error: `method must be one of: ${FINANCE_PAYMENT_METHODS.join(', ')}.`,
    };
  return { range, studentId, method };
}

function financePaymentMatch(branchValues, status, filters) {
  const { range, studentId, method } = filters;
  const match = {
    branchId: { $in: Array.isArray(branchValues) ? branchValues : [branchValues] },
    status,
  };
  if (studentId) match.studentId = studentId;
  if (method) match.method = method;
  if (range.filter)
    match[status === 'confirmed' ? 'confirmedAt' : 'createdAt'] = range.filter;
  return match;
}

const SAFE_STUDENT_DIRECTORY_FIELDS = {
  _id: 0,
  id: 1,
  name: 1,
  fullName: 1,
  email: 1,
  grade: 1,
  section: 1,
  classId: 1,
  branchId: 1,
  status: 1,
};

const SAFE_PARENT_DIRECTORY_FIELDS = {
  _id: 0,
  id: 1,
  userId: 1,
  name: 1,
  fullName: 1,
  email: 1,
  phone: 1,
};

function verifiedDirectoryLinkFilter(parentUserId, studentIds) {
  return {
    ...(parentUserId ? { parentUserId } : {}),
    ...(studentIds ? { studentId: { $in: studentIds } } : {}),
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  };
}

async function linkedStudentIds(parentUserId) {
  const links = await getDatabase()
    .collection('parentChildLinks')
    .find(verifiedDirectoryLinkFilter(parentUserId))
    .toArray();
  return [...new Set(links.map(link => link.studentId).filter(Boolean))];
}

async function financeBranchStudentIds(branchId) {
  return getDatabase()
    .collection('students')
    .distinct('id', { branchId });
}

function studentDirectoryFilter(user, accessibleStudentIds, requestedId) {
  if (user?.role === 'student') {
    return {
      userId: user.id,
      ...(requestedId ? { id: requestedId } : {}),
    };
  }
  if (user?.role === 'parent') {
    return {
      id: requestedId
        ? { $in: accessibleStudentIds.filter(id => id === requestedId) }
        : { $in: accessibleStudentIds },
    };
  }
  if (user?.role === 'finance' && user.branchId) {
    return {
      branchId: user.branchId,
      ...(requestedId ? { id: requestedId } : {}),
    };
  }
  return null;
}

function parentDirectoryFilter(user, accessibleParentIds, requestedId) {
  if (user?.role === 'parent') {
    return {
      $and: [
        { $or: [{ id: user.id }, { userId: user.id }] },
        ...(requestedId
          ? [{ $or: [{ id: requestedId }, { userId: requestedId }] }]
          : []),
      ],
    };
  }
  if (user?.role === 'finance' && user.branchId) {
    return {
      $and: [
        {
          $or: [
            { id: { $in: accessibleParentIds } },
            { userId: { $in: accessibleParentIds } },
          ],
        },
        ...(requestedId
          ? [{ $or: [{ id: requestedId }, { userId: requestedId }] }]
          : []),
      ],
    };
  }
  return null;
}

function appendDirectorySearch(filter, rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return { filter };
  if (query.length > 100) return { error: 'Search query is too long.' };
  const pattern = escapedRegex(query);
  return {
    filter: {
      $and: [
        filter,
        {
          $or: [
            { id: { $regex: pattern, $options: 'i' } },
            { name: { $regex: pattern, $options: 'i' } },
            { fullName: { $regex: pattern, $options: 'i' } },
            { grade: { $regex: pattern, $options: 'i' } },
          ],
        },
      ],
    },
  };
}

router.get('/students', async (req, res, next) => {
  try {
    const accessibleIds =
      req.user.role === 'parent' ? await linkedStudentIds(req.user.id) : [];
    const accessFilter = studentDirectoryFilter(req.user, accessibleIds);
    if (!accessFilter) {
      return res.status(403).json({ success: false, error: 'Student directory access is denied.' });
    }
    const searched = appendDirectorySearch(accessFilter, req.query.q);
    if (searched.error) {
      return res.status(400).json({ success: false, error: searched.error });
    }
    const data = await getDatabase()
      .collection('students')
      .find(searched.filter, { projection: SAFE_STUDENT_DIRECTORY_FIELDS })
      .limit(100)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/students/:id', async (req, res, next) => {
  try {
    const accessibleIds =
      req.user.role === 'parent' ? await linkedStudentIds(req.user.id) : [];
    const filter = studentDirectoryFilter(req.user, accessibleIds, req.params.id);
    if (!filter) {
      return res.status(403).json({ success: false, error: 'Student directory access is denied.' });
    }
    const student = await getDatabase()
      .collection('students')
      .findOne(filter, { projection: SAFE_STUDENT_DIRECTORY_FIELDS });
    return student
      ? res.json({ success: true, data: student })
      : notFound(res, 'Student', req.params.id);
  } catch (error) {
    return next(error);
  }
});

router.get('/parents', async (req, res, next) => {
  try {
    let accessibleParentIds = [];
    let accessibleStudentIds = [];
    if (req.user.role === 'parent') {
      accessibleParentIds = [req.user.id];
      accessibleStudentIds = await linkedStudentIds(req.user.id);
    } else if (req.user.role === 'finance' && req.user.branchId) {
      accessibleStudentIds = await financeBranchStudentIds(req.user.branchId);
      const links = accessibleStudentIds.length
        ? await getDatabase().collection('parentChildLinks')
            .find(verifiedDirectoryLinkFilter(null, accessibleStudentIds))
            .toArray()
        : [];
      accessibleParentIds = [...new Set(links.map(link => link.parentUserId).filter(Boolean))];
    }
    const filter = parentDirectoryFilter(req.user, accessibleParentIds);
    if (!filter) {
      return res.status(403).json({ success: false, error: 'Parent directory access is denied.' });
    }
    const parents = await getDatabase().collection('parents')
      .find(filter, { projection: SAFE_PARENT_DIRECTORY_FIELDS })
      .limit(100)
      .toArray();
    const children = accessibleStudentIds.length
      ? await getDatabase().collection('students')
          .find(
            {
              id: { $in: accessibleStudentIds },
              ...(req.user.role === 'finance' ? { branchId: req.user.branchId } : {}),
            },
            { projection: SAFE_STUDENT_DIRECTORY_FIELDS },
          )
          .limit(500)
          .toArray()
      : [];
    const links = accessibleStudentIds.length
      ? await getDatabase().collection('parentChildLinks')
          .find(verifiedDirectoryLinkFilter(null, accessibleStudentIds))
          .toArray()
      : [];
    const data = parents.map(parent => ({
      ...parent,
      children: children.filter(child =>
        links.some(link =>
          link.parentUserId === (parent.userId || parent.id) && link.studentId === child.id,
        ),
      ),
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/parents/:id', async (req, res, next) => {
  try {
    let accessibleParentIds = [];
    let accessibleStudentIds = [];
    if (req.user.role === 'parent') {
      accessibleParentIds = [req.user.id];
      accessibleStudentIds = await linkedStudentIds(req.user.id);
    } else if (req.user.role === 'finance' && req.user.branchId) {
      accessibleStudentIds = await financeBranchStudentIds(req.user.branchId);
      const links = accessibleStudentIds.length
        ? await getDatabase().collection('parentChildLinks')
            .find(verifiedDirectoryLinkFilter(null, accessibleStudentIds))
            .toArray()
        : [];
      accessibleParentIds = [...new Set(links.map(link => link.parentUserId).filter(Boolean))];
    }
    const filter = parentDirectoryFilter(req.user, accessibleParentIds, req.params.id);
    if (!filter) {
      return res.status(403).json({ success: false, error: 'Parent directory access is denied.' });
    }
    const parent = await getDatabase().collection('parents').findOne(
      filter,
      { projection: SAFE_PARENT_DIRECTORY_FIELDS },
    );
    if (!parent) return notFound(res, 'Parent', req.params.id);
    const parentUserId = parent.userId || parent.id;
    const permittedStudentIds = req.user.role === 'parent'
      ? accessibleStudentIds
      : (await getDatabase().collection('parentChildLinks')
          .find(verifiedDirectoryLinkFilter(parentUserId, accessibleStudentIds))
          .toArray())
          .map(link => link.studentId);
    const children = permittedStudentIds.length
      ? await getDatabase().collection('students').find(
          {
            id: { $in: permittedStudentIds },
            ...(req.user.role === 'finance' ? { branchId: req.user.branchId } : {}),
          },
          { projection: SAFE_STUDENT_DIRECTORY_FIELDS },
        ).limit(100).toArray()
      : [];
    const notices = req.user.role === 'parent'
      ? await getDatabase().collection('notices')
          .find({ active: { $ne: false } })
          .sort({ postedAt: -1 })
          .limit(100)
          .toArray()
      : [];
    return res.json({
      success: true,
      data: { ...parent, children, ...(req.user.role === 'parent' ? { notices } : {}) },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/students', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    if (query.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query is too long.' });
    }
    const filter = { branchId: req.financeContext.branchFilter };
    if (query) {
      const pattern = escapedRegex(query);
      filter.$or = [
        { id: { $regex: pattern, $options: 'i' } },
        { name: { $regex: pattern, $options: 'i' } },
        { fullName: { $regex: pattern, $options: 'i' } },
        { email: { $regex: pattern, $options: 'i' } },
      ];
    }
    const data = await getDatabase()
      .collection('students')
      .find(filter, {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          fullName: 1,
          email: 1,
          grade: 1,
          section: 1,
          branchId: 1,
        },
      })
      .limit(100)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/summary', async (req, res, next) => {
  try {
    const filters = financeListFilters(req.query);
    if (filters.error)
      return res.status(400).json({ success: false, error: filters.error });
    const { range, studentId, method } = filters;
    const invoices = getDatabase().collection('invoices');
    const payments = getDatabase().collection('payments');
    const invoiceFilter = { branchId: req.financeContext.branchFilter };
    if (studentId) invoiceFilter.studentId = studentId;
    if (range.from || range.to) {
      invoiceFilter.dueDate = {};
      if (range.from) invoiceFilter.dueDate.$gte = range.from;
      if (range.to) invoiceFilter.dueDate.$lte = range.to;
    }
    const collectionFilter = {
      branchId: req.financeContext.branchFilter,
      status: 'confirmed',
    };
    if (studentId) collectionFilter.studentId = studentId;
    if (method) collectionFilter.method = method;
    if (range.filter) collectionFilter.confirmedAt = range.filter;
    const [collected, unpaid, invoiceCount] = await Promise.all([
      payments
        .aggregate([
          { $match: collectionFilter },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .toArray(),
      invoices
        .aggregate([
          { $match: invoiceFilter },
          ...(method
            ? [
                {
                  $lookup: {
                    from: 'payments',
                    let: { invoiceId: '$id', branchId: '$branchId' },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $and: [
                              { $eq: ['$invoiceId', '$$invoiceId'] },
                              { $eq: ['$branchId', '$$branchId'] },
                              { $eq: ['$method', method] },
                              {
                                $in: [
                                  '$status',
                                  ['confirmed', 'pending_verification'],
                                ],
                              },
                            ],
                          },
                        },
                      },
                      { $limit: 1 },
                    ],
                    as: 'methodPayments',
                  },
                },
                { $match: { 'methodPayments.0': { $exists: true } } },
              ]
            : []),
          {
            $lookup: {
              from: 'payments',
              let: { invoiceId: '$id', branchId: '$branchId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$invoiceId', '$$invoiceId'] },
                        { $eq: ['$branchId', '$$branchId'] },
                        { $eq: ['$status', 'confirmed'] },
                      ],
                    },
                  },
                },
                { $group: { _id: null, total: { $sum: '$amount' } } },
              ],
              as: 'paid',
            },
          },
          {
            $addFields: {
              balanceDue: {
                $max: [
                  {
                    $subtract: [
                      '$amount',
                      { $ifNull: [{ $arrayElemAt: ['$paid.total', 0] }, 0] },
                    ],
                  },
                  0,
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$balanceDue' } } },
        ])
        .toArray(),
      method
        ? invoices
            .aggregate([
              { $match: invoiceFilter },
              {
                $lookup: {
                  from: 'payments',
                  let: { invoiceId: '$id', branchId: '$branchId' },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ['$invoiceId', '$$invoiceId'] },
                            { $eq: ['$branchId', '$$branchId'] },
                            { $eq: ['$method', method] },
                            {
                              $in: [
                                '$status',
                                ['confirmed', 'pending_verification'],
                              ],
                            },
                          ],
                        },
                      },
                    },
                    { $limit: 1 },
                  ],
                  as: 'methodPayments',
                },
              },
              { $match: { 'methodPayments.0': { $exists: true } } },
              { $count: 'count' },
            ])
            .toArray()
            .then((counts) => counts[0]?.count || 0)
        : invoices.countDocuments(invoiceFilter),
    ]);
    return res.json({
      success: true,
      data: {
        currency: 'PKR',
        collected: collected[0]?.total || 0,
        outstanding: unpaid[0]?.total || 0,
        invoiceCount,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/invoices', async (req, res, next) => {
  try {
    const filters = financeListFilters(req.query);
    if (filters.error)
      return res.status(400).json({ success: false, error: filters.error });
    const { range, studentId, method } = filters;
    const status = String(req.query.status || '')
      .trim()
      .toLowerCase();
    if (status && !isFinanceInvoiceStatus(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be due, overdue, ${PARTIAL_INVOICE_STATUS}, or paid`,
      });
    }
    const query = String(req.query.q || '').trim();
    const grade = String(req.query.grade || '').trim();
    const gradeValues = /^\d+$/.test(grade) ? [grade, Number(grade)] : [grade];
    if (query.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query is too long.' });
    }
    if (grade.length > 40)
      return res.status(400).json({ success: false, error: 'Grade filter is too long.' });
    const match = {
      branchId: req.financeContext.branchFilter,
      ...financeInvoiceStatusMatch(status),
      ...(studentId ? { studentId } : {}),
    };
    if (range.from || range.to) {
      match.dueDate = {};
      if (range.from) match.dueDate.$gte = range.from;
      if (range.to) match.dueDate.$lte = range.to;
    }
    const pattern = query ? escapedRegex(query) : null;
    const data = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: match },
        ...(method
          ? [
              {
                $lookup: {
                  from: 'payments',
                  let: { invoiceId: '$id', branchId: '$branchId' },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ['$invoiceId', '$$invoiceId'] },
                            { $eq: ['$branchId', '$$branchId'] },
                            { $eq: ['$method', method] },
                            {
                              $in: [
                                '$status',
                                ['confirmed', 'pending_verification'],
                              ],
                            },
                          ],
                        },
                      },
                    },
                    { $limit: 1 },
                  ],
                  as: 'methodPayments',
                },
              },
              { $match: { 'methodPayments.0': { $exists: true } } },
            ]
          : []),
        {
          $lookup: {
            from: 'students',
            let: { studentId: '$studentId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$studentId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
            ],
            as: 'studentRecord',
          },
        },
        ...(grade ? [{ $match: { 'studentRecord.grade': { $in: gradeValues } } }] : []),
        ...(pattern
          ? [
              {
                $match: {
                  $or: [
                    { id: { $regex: pattern, $options: 'i' } },
                    { voucherCode: { $regex: pattern, $options: 'i' } },
                    { studentId: { $regex: pattern, $options: 'i' } },
                    {
                      'studentRecord.name': { $regex: pattern, $options: 'i' },
                    },
                    {
                      'studentRecord.fullName': {
                        $regex: pattern,
                        $options: 'i',
                      },
                    },
                  ],
                },
              },
            ]
          : []),
        {
          $unwind: { path: '$studentRecord', preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            student: {
              $ifNull: ['$studentRecord.fullName', '$studentRecord.name'],
            },
            grade: '$studentRecord.grade',
            section: '$studentRecord.section',
          },
        },
        { $project: { studentRecord: 0, methodPayments: 0 } },
        { $sort: { dueDate: 1 } },
        { $limit: 500 },
      ])
      .toArray();
    return res.json({ success: true, data: normalizeInvoiceStatuses(data) });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/dues', async (req, res, next) => {
  try {
    const range = dateRange(req.query);
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const studentId = String(req.query.studentId || '').trim();
    const method = String(req.query.method || '').trim().toLowerCase();
    const query = String(req.query.q || '').trim();
    if (studentId.length > 120 || query.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Search filter is too long.' });
    }
    if (method && !FINANCE_PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({
        success: false,
        error: `method must be one of: ${FINANCE_PAYMENT_METHODS.join(', ')}.`,
      });
    }
    const match = { branchId: req.financeContext.branchFilter };
    if (studentId) match.studentId = studentId;
    if (range.from || range.to) {
      match.dueDate = {};
      if (range.from) match.dueDate.$gte = range.from;
      if (range.to) match.dueDate.$lte = range.to;
    }
    const pattern = query ? escapedRegex(query) : null;
    const records = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'payments',
            let: { invoiceId: '$id', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$invoiceId', '$$invoiceId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                      {
                        $in: ['$status', ['confirmed', 'pending_verification']],
                      },
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
                  methods: { $addToSet: '$method' },
                },
              },
            ],
            as: 'paymentTotals',
          },
        },
        ...(method
          ? [{ $match: { 'paymentTotals.methods': method } }]
          : []),
        {
          $lookup: {
            from: 'students',
            let: { studentId: '$studentId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$studentId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
              { $project: { id: 1, name: 1, fullName: 1 } },
            ],
            as: 'studentRecord',
          },
        },
        {
          $unwind: { path: '$studentRecord', preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            paidAmount: {
              $ifNull: [{ $arrayElemAt: ['$paymentTotals.paidAmount', 0] }, 0],
            },
            pendingAmount: {
              $ifNull: [
                { $arrayElemAt: ['$paymentTotals.pendingAmount', 0] },
                0,
              ],
            },
            paymentMethods: {
              $ifNull: [
                { $arrayElemAt: ['$paymentTotals.methods', 0] },
                [],
              ],
            },
            student: {
              $ifNull: ['$studentRecord.fullName', '$studentRecord.name'],
            },
          },
        },
        {
          $addFields: {
            balanceDue: {
              $max: [{ $subtract: ['$amount', '$paidAmount'] }, 0],
            },
            availableBalance: {
              $max: [
                {
                  $subtract: [
                    '$amount',
                    { $add: ['$paidAmount', '$pendingAmount'] },
                  ],
                },
                0,
              ],
            },
          },
        },
        ...(pattern
          ? [
              {
                $match: {
                  $or: [
                    { id: { $regex: pattern, $options: 'i' } },
                    { studentId: { $regex: pattern, $options: 'i' } },
                    { student: { $regex: pattern, $options: 'i' } },
                  ],
                },
              },
            ]
          : []),
        { $match: { balanceDue: { $gt: 0 } } },
        { $sort: { dueDate: 1, id: 1 } },
        { $limit: 500 },
        { $project: { paymentTotals: 0, studentRecord: 0 } },
      ])
      .toArray();
    const today = new Date().toISOString().slice(0, 10);
    const data = records.map(invoice => ({
      ...invoice,
      status:
        invoice.paidAmount > 0
          ? String(invoice.dueDate || '').slice(0, 10) < today
            ? 'overdue'
            : PARTIAL_INVOICE_STATUS
          : String(invoice.dueDate || '').slice(0, 10) < today
          ? 'overdue'
          : 'due',
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/vouchers/:code/verify', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code)
      return res
        .status(400)
        .json({ success: false, error: 'Voucher code is required.' });
    const invoice = await getDatabase()
      .collection('invoices')
      .findOne({ voucherCode: code, branchId: req.financeContext.branchFilter });
    if (!invoice)
      return res.status(404).json({
        success: false,
        verified: false,
        error: 'Voucher was not found.',
      });
    const student = await getDatabase()
      .collection('students')
      .findOne(
        { id: invoice.studentId, branchId: req.financeContext.branchFilter },
        { projection: { name: 1, fullName: 1 } },
      );
    const totals = await getInvoicePaymentTotals(
      getDatabase().collection('payments'),
      invoice.id,
      req.financeContext.branchValues,
    );
    const { paidAmount, pendingAmount } = totals;
    const balanceDue = Math.max(Number(invoice.amount) - paidAmount, 0);
    const availableBalance = Math.max(
      Number(invoice.amount) - paidAmount - pendingAmount,
      0,
    );
    return res.json({
      success: true,
      verified: true,
      data: {
        invoiceId: invoice.id,
        voucherCode: invoice.voucherCode,
        student: student?.fullName || student?.name || null,
        amount: invoice.amount,
        paidAmount,
        pendingAmount,
        balanceDue,
        availableBalance,
        currency: invoice.currency || 'PKR',
        invoiceStatus: normalizeInvoiceStatus(invoice.status),
        paymentStatus:
          balanceDue === 0
            ? 'paid'
            : paidAmount > 0
            ? pendingAmount > 0
              ? 'partial_pending'
              : 'partial'
            : pendingAmount > 0
            ? 'pending_verification'
            : 'unpaid',
        dueDate: invoice.dueDate,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/payments', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending_verification').trim();
    if (!['pending_verification', 'confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be pending_verification, confirmed, or rejected.',
      });
    }
    const filters = financeListFilters(req.query);
    if (filters.error)
      return res.status(400).json({ success: false, error: filters.error });
    const match = financePaymentMatch(
      req.financeContext.branchValues,
      status,
      filters,
    );
    const data = await getDatabase()
      .collection('payments')
      .find(
        match,
        { projection: { requestHash: 0, idempotencyKey: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/reconciliation/parent-payments', async (req, res, next) => {
  try {
    const data = await getDatabase().collection('parentOnlinePayments').find(
      {
        branchId: req.financeContext.branchFilter,
        activeKey: 'active',
        status: { $in: ['initiated', 'pending', 'reconciliation_required'] },
      },
      {
        projection: {
          parentUserId: 0,
          checkoutUrl: 0,
          idempotencyKey: 0,
          requestHash: 0,
          activeKey: 0,
          workerLeaseId: 0,
        },
      },
    ).sort({ reconciliationNextAt: 1, createdAt: 1 }).limit(500).toArray();
    return res.json({ success: true, data: data.map(payment => ({
      paymentId: String(payment._id),
      invoiceId: payment.invoiceId,
      studentId: payment.studentId,
      branchId: payment.branchId,
      provider: payment.provider,
      providerTransactionId: payment.providerTransactionId || null,
      orderRef: payment.orderRef,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      merchantStatus: payment.merchantStatus || null,
      reconciliationReason: payment.reconciliationReason || null,
      reconciliationAttempts: payment.reconciliationAttempts || 0,
      reconciliationNextAt: payment.reconciliationNextAt || null,
      reconciliationExhaustedAt: payment.reconciliationExhaustedAt || null,
      lastCheckedAt: payment.lastCheckedAt || null,
      expiresAt: payment.expiresAt || null,
      createdAt: payment.createdAt,
    })) });
  } catch (error) {
    return next(error);
  }
});

router.post('/finance/payments/:paymentId/verify', async (req, res, next) => {
  const actor = req.financeContext;
  const paymentId = req.params.paymentId;
  if (!ObjectId.isValid(paymentId)) {
    return res
      .status(404)
      .json({ success: false, error: 'Payment was not found.' });
  }

  const db = getDatabase();
  const payments = db.collection('payments');
  const session = getClient().startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const payment = await payments.findOne(
        {
          _id: new ObjectId(paymentId),
          branchId: actor.branchFilter,
          status: 'pending_verification',
        },
        { session },
      );
      if (!payment) {
        const existing = await payments.findOne(
          { _id: new ObjectId(paymentId), branchId: actor.branchFilter },
          { session, projection: { _id: 1, status: 1 } },
        );
        const error = new Error(
          existing
            ? 'Payment is no longer pending verification.'
            : 'Payment was not found in this branch.',
        );
        error.statusCode = existing ? 409 : 404;
        throw error;
      }

      let invoice = await db
        .collection('invoices')
        .findOne(
          { id: payment.invoiceId, branchId: actor.branchFilter },
          { session },
        );
      if (!invoice) {
        const error = new Error('Invoice was not found in this branch.');
        error.statusCode = 404;
        throw error;
      }
      invoice = await lockInvoice(db.collection('invoices'), invoice, session);
      const totals = await getInvoicePaymentTotals(
        payments,
        payment.invoiceId,
        actor.branchValues,
        session,
      );
      const reservations = await invoiceReservedCents(db, invoice, session);
      const amountTotal = Number(invoice.amount);
      const paidCents = Math.round(totals.paidAmount * 100);
      const paymentCents = Math.round(Number(payment.amount) * 100);
      const totalCents = Math.round(amountTotal * 100);
      if (
        !Number.isFinite(amountTotal) ||
        paidCents + Math.round(totals.pendingAmount * 100) + reservations.parentReservedCents > totalCents
      ) {
        const error = new Error(
          'Verifying this payment would exceed the invoice total.',
        );
        error.statusCode = 409;
        throw error;
      }

      const now = new Date();
      const receiptNumber = `RCT-${crypto.randomUUID()}`;
      const updated = await payments.updateOne(
        {
          _id: payment._id,
          branchId: actor.branchFilter,
          status: 'pending_verification',
        },
        {
          $set: {
            status: 'confirmed',
            confirmedAt: now,
            verifiedAt: now,
            verifiedByUserId: actor.userId,
            receiptNumber,
          },
        },
        { session },
      );
      if (updated.modifiedCount !== 1) {
        const error = new Error('Payment changed while it was being verified.');
        error.statusCode = 409;
        throw error;
      }

      const remainingPending =
        Math.max(Math.round(totals.pendingAmount * 100) - paymentCents, 0) /
        100;
      const paidAmount = (paidCents + paymentCents) / 100;
      const balanceDue =
        Math.max(totalCents - paidCents - paymentCents, 0) / 100;
      const invoiceUpdate = await db.collection('invoices').updateOne(
        { _id: invoice._id, branchId: actor.branchFilter },
        {
          $set: {
            paidAmount,
            pendingPaymentAmount: remainingPending,
            balanceDue,
            status: invoiceStatusFromCents(totalCents, paidCents + paymentCents),
            paymentStatus:
              balanceDue === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
            updatedAt: now,
          },
        },
        { session },
      );
      if (invoiceUpdate.matchedCount !== 1) {
        const error = new Error(
          'Invoice changed while the payment was being verified.',
        );
        error.statusCode = 409;
        throw error;
      }
      await db.collection('financeAuditLogs').insertOne(
        {
          id: crypto.randomUUID(),
          event: 'payment.verified',
          branchId: invoice.branchId,
          actorUserId: actor.userId,
          invoiceId: payment.invoiceId,
          paymentId: payment._id,
          amount: payment.amount,
          receiptNumber,
          previousStatus: 'pending_verification',
          status: 'confirmed',
          createdAt: now,
        },
        { session },
      );
      result = {
        paymentId: payment._id,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        currency: payment.currency,
        status: 'confirmed',
        receiptNumber,
        confirmedAt: now,
        paidAmount,
        balanceDue,
      };
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode) {
      return res
        .status(error.statusCode)
        .json({ success: false, error: error.message });
    }
    return next(error);
  } finally {
    await session.endSession();
  }
});

router.post('/finance/payments/:paymentId/reject', async (req, res, next) => {
  const actor = req.financeContext;
  const paymentId = req.params.paymentId;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!ObjectId.isValid(paymentId)) {
    return res.status(404).json({ success: false, error: 'Payment was not found.' });
  }
  if (!reason || reason.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'A rejection reason of at most 500 characters is required.',
    });
  }
  const db = getDatabase();
  const payments = db.collection('payments');
  const session = getClient().startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const payment = await payments.findOne(
        {
          _id: new ObjectId(paymentId),
          branchId: actor.branchFilter,
          status: 'pending_verification',
        },
        { session },
      );
      if (!payment) {
        const existing = await payments.findOne(
          { _id: new ObjectId(paymentId), branchId: actor.branchFilter },
          { session, projection: { status: 1 } },
        );
        const error = new Error(
          existing
            ? 'Payment is no longer pending verification.'
            : 'Payment was not found in this branch.',
        );
        error.statusCode = existing ? 409 : 404;
        throw error;
      }
      const invoice = await db.collection('invoices').findOne(
        { id: payment.invoiceId, branchId: actor.branchFilter },
        { session },
      );
      if (!invoice) {
        const error = new Error('Invoice was not found in this branch.');
        error.statusCode = 404;
        throw error;
      }
      const totals = await getInvoicePaymentTotals(
        payments,
        payment.invoiceId,
        actor.branchValues,
        session,
      );
      const now = new Date();
      const updated = await payments.updateOne(
        {
          _id: payment._id,
          branchId: actor.branchFilter,
          status: 'pending_verification',
        },
        {
          $set: {
            status: 'rejected',
            rejectionReason: reason,
            rejectedAt: now,
            rejectedByUserId: actor.userId,
          },
        },
        { session },
      );
      if (updated.modifiedCount !== 1) {
        const error = new Error('Payment changed while it was being rejected.');
        error.statusCode = 409;
        throw error;
      }
      const invoiceState = rejectedInvoiceState(
        invoice.amount,
        totals,
        payment.amount,
      );
      const invoiceUpdate = await db.collection('invoices').updateOne(
        { _id: invoice._id, branchId: actor.branchFilter },
        {
          $set: {
            ...invoiceState,
            updatedAt: now,
          },
        },
        { session },
      );
      if (invoiceUpdate.matchedCount !== 1) {
        const error = new Error('Invoice changed while rejecting the payment.');
        error.statusCode = 409;
        throw error;
      }
      await db.collection('financeAuditLogs').insertOne(
        {
          id: crypto.randomUUID(),
          event: 'payment.rejected',
          branchId: invoice.branchId,
          actorUserId: actor.userId,
          invoiceId: payment.invoiceId,
          paymentId: payment._id,
          amount: payment.amount,
          previousStatus: 'pending_verification',
          status: 'rejected',
          reason,
          createdAt: now,
        },
        { session },
      );
      result = {
        paymentId: payment._id,
        invoiceId: payment.invoiceId,
        status: 'rejected',
        reason,
        rejectedAt: now,
        availableBalance: invoiceState.availableBalance,
      };
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    return next(error);
  } finally {
    await session.endSession();
  }
});

router.post('/finance/payments', async (req, res, next) => {
  try {
    const invoiceId =
      typeof req.body?.invoiceId === 'string' ? req.body.invoiceId.trim() : '';
    const amount = Number(req.body?.amount);
    const method =
      typeof req.body?.method === 'string'
        ? req.body.method.trim().toLowerCase()
        : '';
    const reference =
      typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    if (
      !invoiceId ||
      !Number.isFinite(amount) ||
      Math.round(amount * 100) !== amount * 100 ||
      amount <= 0 ||
      amount > 1000000000
    ) {
      return res.status(400).json({
        success: false,
        error:
          'invoiceId and a positive amount with at most two decimals are required.',
      });
    }
    if (
      !['cash', 'bank_transfer', 'card', 'easypaisa', 'cheque', 'other'].includes(method)
    ) {
      return res.status(400).json({
        success: false,
        error: 'method must be cash, bank_transfer, card, easypaisa, cheque, or other.',
      });
    }
    if (requiresPaymentReference(method) && !reference) {
      return res.status(400).json({
        success: false,
        error: `A transaction reference is required for ${method}.`,
      });
    }
    if (reference.length > 160) {
      return res.status(400).json({
        success: false,
        error: 'Payment reference must be at most 160 characters.',
      });
    }
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (!/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        error:
          'A valid Idempotency-Key header is required for payment entries.',
      });
    }
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ invoiceId, amount, method, reference }))
      .digest('hex');
    const db = getDatabase();
    const payments = db.collection('payments');
    await Promise.all([
      ensurePaymentIdempotencyIndex(payments),
      ensurePaymentReferenceIndex(payments),
    ]);
    const actor = req.financeContext;
    const idempotencyFilter = {
      branchId: actor.branchFilter,
      createdByUserId: actor.userId,
      idempotencyKey,
    };
    const session = getClient().startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const previous = await payments.findOne(idempotencyFilter, { session });
        if (previous) {
          if (previous.requestHash !== requestHash) {
            const conflict = new Error(
              'Idempotency-Key was already used for a different payment request.',
            );
            conflict.statusCode = 409;
            throw conflict;
          }
          response = {
            statusCode: 200,
            payload: {
              success: true,
              duplicate: true,
              data: {
                paymentId: previous._id,
                invoiceId: previous.invoiceId,
                amount: previous.amount,
                currency: previous.currency,
                status: previous.status,
              },
              message: 'This payment entry was already recorded.',
            },
          };
          return;
        }

        let invoice = await db
          .collection('invoices')
          .findOne({ id: invoiceId, branchId: actor.branchFilter }, { session });
        if (!invoice) {
          const missing = new Error(
            'Invoice was not found in this Finance branch.',
          );
          missing.statusCode = 404;
          throw missing;
        }
        invoice = await lockInvoice(db.collection('invoices'), invoice, session);
        if (
          !Number.isFinite(Number(invoice.amount)) ||
          Number(invoice.amount) <= 0
        ) {
          const invalid = new Error('Invoice has an invalid total amount.');
          invalid.statusCode = 409;
          throw invalid;
        }

        const totals = await getInvoicePaymentTotals(
          payments,
          invoiceId,
          actor.branchValues,
          session,
        );
        const reservations = await invoiceReservedCents(db, invoice, session);
        const availableCents = Math.max(
          Math.round(Number(invoice.amount) * 100) -
            Math.round(totals.paidAmount * 100) -
            Math.round(totals.pendingAmount * 100) - reservations.parentReservedCents,
          0,
        );
        const available = availableCents / 100;
        if (amount > available) {
          const overpayment = new Error(
            `Payment exceeds the available invoice balance (${available.toFixed(
              2,
            )}).`,
          );
          overpayment.statusCode = 409;
          throw overpayment;
        }

        const now = new Date();
        const payment = {
          invoiceId,
          studentId: invoice.studentId,
          branchId: invoice.branchId,
          amount,
          currency: invoice.currency || 'PKR',
          method,
          reference: reference || null,
          status: 'pending_verification',
          createdByUserId: actor.userId,
          idempotencyKey,
          requestHash,
          createdAt: now,
        };
        const inserted = await payments.insertOne(payment, { session });
        const invoiceUpdate = await db.collection('invoices').updateOne(
          { _id: invoice._id, branchId: actor.branchFilter },
          {
            $set: {
              paidAmount: totals.paidAmount,
              pendingPaymentAmount:
                (Math.round(totals.pendingAmount * 100) +
                  Math.round(amount * 100)) /
                100,
              balanceDue:
                Math.max(
                  Math.round(Number(invoice.amount) * 100) -
                    Math.round(totals.paidAmount * 100),
                  0,
                ) / 100,
              updatedAt: now,
            },
          },
          { session },
        );
        if (invoiceUpdate.matchedCount !== 1) {
          const changed = new Error(
            'Invoice changed while recording the payment.',
          );
          changed.statusCode = 409;
          throw changed;
        }
        await db.collection('financeAuditLogs').insertOne(
          {
            id: crypto.randomUUID(),
            event: 'payment.entry_created',
            branchId: invoice.branchId,
            actorUserId: actor.userId,
            invoiceId,
            paymentId: inserted.insertedId,
            amount,
            status: payment.status,
            createdAt: now,
          },
          { session },
        );
        response = {
          statusCode: 201,
          payload: {
            success: true,
            data: {
              paymentId: inserted.insertedId,
              invoiceId,
              amount,
              currency: payment.currency,
              status: payment.status,
              availableBalance: Math.max(available - amount, 0),
            },
            message:
              'Payment entry recorded for verification. No receipt is issued until confirmation.',
          },
        };
      });
    } catch (error) {
      if (error.code === 11000) {
        const duplicate = await payments.findOne(idempotencyFilter);
        if (duplicate?.requestHash === requestHash) {
          response = {
            statusCode: 200,
            payload: {
              success: true,
              duplicate: true,
              data: {
                paymentId: duplicate._id,
                invoiceId: duplicate.invoiceId,
                amount: duplicate.amount,
                currency: duplicate.currency,
                status: duplicate.status,
              },
              message: 'This payment entry was already recorded.',
            },
          };
        } else if (duplicate) {
          return res.status(409).json({
            success: false,
            error:
              'Idempotency-Key was already used for a different payment request.',
          });
        } else if (error.keyPattern?.reference || error.message?.includes('finance_payment_reference_by_branch')) {
          return res.status(409).json({
            success: false,
            error: 'This payment reference is already recorded in this branch.',
          });
        } else {
          throw error;
        }
      } else if (error.statusCode) {
        return res
          .status(error.statusCode)
          .json({ success: false, error: error.message });
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }
    return res.status(response.statusCode).json(response.payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/receipts', async (req, res, next) => {
  try {
    const filters = financeListFilters(req.query);
    if (filters.error)
      return res.status(400).json({ success: false, error: filters.error });
    const { range, studentId, method } = filters;
    const match = {
      branchId: req.financeContext.branchFilter,
      status: 'confirmed',
    };
    if (studentId) match.studentId = studentId;
    if (method) match.method = method;
    if (range.filter) match.confirmedAt = range.filter;
    const data = await getDatabase()
      .collection('payments')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'invoices',
            let: { invoiceId: '$invoiceId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$invoiceId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
            ],
            as: 'invoice',
          },
        },
        { $unwind: { path: '$invoice', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'students',
            let: { studentId: '$studentId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$studentId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
            ],
            as: 'studentRecord',
          },
        },
        {
          $unwind: { path: '$studentRecord', preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            receiptNumber: 1,
            invoiceId: 1,
            amount: 1,
            currency: 1,
            method: 1,
            reference: 1,
            confirmedAt: 1,
            student: {
              $ifNull: ['$studentRecord.fullName', '$studentRecord.name'],
            },
          },
        },
        { $sort: { confirmedAt: -1 } },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/receipts/:paymentId', async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    if (!ObjectId.isValid(paymentId)) {
      return res
        .status(404)
        .json({ success: false, error: 'Receipt was not found.' });
    }
    const payment = await getDatabase()
      .collection('payments')
      .findOne({
        _id: new ObjectId(paymentId),
        branchId: req.financeContext.branchFilter,
        status: 'confirmed',
      });
    if (!payment || !payment.receiptNumber) {
      return res
        .status(404)
        .json({ success: false, error: 'Confirmed receipt was not found.' });
    }
    const [invoice, student] = await Promise.all([
      getDatabase()
        .collection('invoices')
        .findOne(
          { id: payment.invoiceId, branchId: req.financeContext.branchFilter },
          { projection: { id: 1, description: 1, amount: 1, currency: 1 } },
        ),
      getDatabase()
        .collection('students')
        .findOne(
          { id: payment.studentId, branchId: req.financeContext.branchFilter },
          { projection: { id: 1, name: 1, fullName: 1 } },
        ),
    ]);
    return res.json({
      success: true,
      data: {
        receiptNumber: payment.receiptNumber,
        invoiceId: payment.invoiceId,
        student: student?.fullName || student?.name || null,
        description: invoice?.description || null,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        reference: payment.reference,
        confirmedAt: payment.confirmedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/reports/collections', async (req, res, next) => {
  try {
    const filters = financeListFilters(req.query);
    if (filters.error)
      return res.status(400).json({ success: false, error: filters.error });
    const { range, studentId, method } = filters;
    const match = {
      branchId: req.financeContext.branchFilter,
      status: 'confirmed',
    };
    if (studentId) match.studentId = studentId;
    if (method) match.method = method;
    if (range.filter) match.confirmedAt = range.filter;
    const [totals, byMethod] = await Promise.all([
      getDatabase()
        .collection('payments')
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: '$currency',
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      getDatabase()
        .collection('payments')
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: { method: '$method', currency: '$currency' },
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: '$_id.method',
              currency: '$_id.currency',
              total: 1,
              count: 1,
            },
          },
          { $sort: { currency: 1, _id: 1 } },
        ])
        .toArray(),
    ]);
    return res.json({
      success: true,
      data: { confirmedCollections: totals, byMethod },
    });
  } catch (error) {
    return next(error);
  }
});

router.__test = {
  FINANCE_PAYMENT_METHODS,
  financeListFilters,
  financePaymentMatch,
  requireFinanceContext,
  requiresPaymentReference,
  rejectedInvoiceState,
  normalizeInvoiceStatus,
  normalizeInvoiceStatuses,
  financeInvoiceStatusMatch,
  invoiceStatusFromCents,
  isFinanceInvoiceStatus,
  ensurePaymentIdempotencyIndex,
  ensurePaymentReferenceIndex,
  SAFE_PARENT_DIRECTORY_FIELDS,
  SAFE_STUDENT_DIRECTORY_FIELDS,
  appendDirectorySearch,
  parentDirectoryFilter,
  studentDirectoryFilter,
  verifiedDirectoryLinkFilter,
};
router.initializeFinanceIndexes = async function initializeFinanceIndexes() {
  const payments = getDatabase().collection('payments');
  await Promise.all([
    ensurePaymentIdempotencyIndex(payments),
    ensurePaymentReferenceIndex(payments),
  ]);
  await initializeFinancePayrollIndexes();
  await initializeFinanceWorkspaceIndexes();
};
router.initializeChatIndexes = initializeChatIndexes;
router.setChatRealtimePublisher = setChatRealtimePublisher;

module.exports = router;
