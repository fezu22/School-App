const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { createClassTeacherApplication } = require('./applicationService');
const { normalizeInvoiceStatuses } = require('./invoiceStatus');
const { createUserNotificationRouter } = require('./userNotificationRoutes');
const { createLearnerFeatureRouter } = require('./learnerFeatureRoutes');
const {
  apiId,
  assertSameBranch,
  referenceValues,
  resolveUserForRole,
  unresolvedClassReference,
} = require('./identityReferenceAdapter');

const router = express.Router();
const MAX_SUBMISSION_FILE_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SUBMISSION_FILE_BYTES, files: 1, fields: 10 },
});
let submissionIndexPromise;

function ensureSubmissionIndex(submissions) {
  if (!submissionIndexPromise) {
    submissionIndexPromise = submissions.createIndex(
      { homeworkId: 1, studentId: 1 },
      { unique: true, name: 'unique_student_homework_submission' },
    );
  }
  return submissionIndexPromise;
}

function requireStudentContext(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, error: 'Trusted user context is required.' });
  }
  if (req.user.role !== 'student') {
    return res
      .status(403)
      .json({ success: false, error: 'Student access is required.' });
  }
  (async () => {
    const db = getDatabase();
    const identity = await resolveUserForRole(db, userId, 'student');
    const students = await db.collection('students')
      .find({ userId: { $in: referenceValues(identity) } })
      .limit(3)
      .toArray();
    if (students.length > 1) {
      const error = new Error('User reference links to multiple student records; resolve the conflicting IDs before access.');
      error.statusCode = 409;
      error.code = 'INTEGRATION_REFERENCE_CONFLICT';
      throw error;
    }
    const student = students[0];
    if (!student) {
      const error = new Error('Student reference does not resolve to a record linked to this user.');
      error.statusCode = 503;
      error.code = 'INTEGRATION_REFERENCE_UNRESOLVED';
      throw error;
    }
    await assertSameBranch(db, identity.branchId, student.branchId);
    req.authenticatedIdentity = identity;
    req.apiUserId = apiId(identity);
    req.studentRecord = student;
    return next();
  })().catch(next);
}

function dateFilter(query, field) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const valid = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };
  if ((from && !valid(from)) || (to && !valid(to)))
    return { error: 'from and to must be valid YYYY-MM-DD dates.' };
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

function studentClassFilter(student) {
  const scope = [{ studentId: student.id }];
  scope.push({ studentIds: student.id });
  if (student.classId) scope.push({ classId: student.classId });
  return { $or: scope };
}

function publishedFilter() {
  return { $or: [{ published: true }, { status: 'published' }] };
}

function ownedStudentFilter(student, extra = {}) {
  return { ...extra, studentId: student.id };
}

function recordIdFilter(id) {
  const alternatives = [{ id }];
  if (ObjectId.isValid(id)) alternatives.push({ _id: new ObjectId(id) });
  return { $or: alternatives };
}

function submissionDeadline(value) {
  if (value == null || value === '') return { deadline: null };
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? { deadline: value }
      : { error: 'Homework has an invalid deadline.' };
  }
  if (typeof value !== 'string') {
    return { error: 'Homework has an invalid deadline.' };
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const midnight = new Date(Date.UTC(year, month - 1, day));
    if (
      midnight.getUTCFullYear() !== year ||
      midnight.getUTCMonth() !== month - 1 ||
      midnight.getUTCDate() !== day
    ) {
      return { error: 'Homework has an invalid deadline.' };
    }
    midnight.setUTCHours(23, 59, 59, 999);
    return { deadline: midnight };
  }
  const deadline = new Date(value);
  return Number.isFinite(deadline.getTime())
    ? { deadline }
    : { error: 'Homework has an invalid deadline.' };
}

function validateSubmissionFile(file) {
  if (!file) return { type: null, safeFileName: null };
  const allowed = {
    '.pdf': { mime: 'application/pdf', signature: Buffer.from('%PDF-') },
    '.jpg': { mime: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    '.jpeg': { mime: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    '.png': {
      mime: 'image/png',
      signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  };
  const extension = path.extname(file.originalname || '').toLowerCase();
  const type = allowed[extension];
  if (
    !type ||
    file.mimetype !== type.mime ||
    !Buffer.isBuffer(file.buffer) ||
    !file.buffer.subarray(0, type.signature.length).equals(type.signature)
  ) {
    return {
      error: 'File content, extension, and MIME type must match PDF, JPEG, or PNG.',
    };
  }
  return {
    type,
    safeFileName: path
      .basename(String(file.originalname).replace(/\\/g, '/'))
      .replace(/[\r\n\0"]/g, '_')
      .slice(0, 180),
  };
}

router.use(requireStudentContext);
router.use('/notifications', createUserNotificationRouter('student'));
router.use('/features', createLearnerFeatureRouter({
  getStudent: req => req.studentRecord,
  getActor: req => ({ id: req.apiUserId, role: 'student' }),
}));

router.get('/applications', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('classTeacherApplications')
      .find(
        {
          applicantUserId: req.user.id,
          applicantRole: 'student',
          studentId: req.studentRecord.id,
        },
        { projection: { applicantUserId: 0, assignedTeacherUserId: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/applications', async (req, res, next) => {
  try {
    const result = await createClassTeacherApplication({
      input: req.body,
      applicant: req.user,
      student: req.studentRecord,
      applicantRole: 'student',
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

router.get('/', async (req, res, next) => {
  try {
    const profile = await getDatabase()
      .collection('students')
      .findOne(
        { _id: req.studentRecord._id },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            fullName: 1,
            email: 1,
            grade: 1,
            section: 1,
            classId: 1,
            branchId: 1,
            attendance: 1,
            status: 1,
          },
        },
      );
    return res.json({ success: true, data: profile });
  } catch (error) {
    return next(error);
  }
});

router.get('/timetable', async (req, res, next) => {
  try {
    if (req.studentRecord.classId) unresolvedClassReference();
    const data = await getDatabase()
      .collection('timetable')
      .find(studentClassFilter(req.studentRecord))
      .sort({ dayOfWeek: 1, startTime: 1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const range = dateFilter(req.query, 'date');
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const data = await getDatabase()
      .collection('attendance')
      .find(ownedStudentFilter(req.studentRecord, range.filter))
      .sort({ date: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/results', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('results')
      .find(ownedStudentFilter(req.studentRecord, publishedFilter()))
      .sort({ publishedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/progress', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('progress')
      .find(ownedStudentFilter(req.studentRecord, publishedFilter()))
      .sort({ updatedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/fees', async (req, res, next) => {
  try {
    const student = req.studentRecord;
    const match = { studentId: student.id };
    if (student.branchId) match.branchId = student.branchId;
    const data = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'payments',
            let: { invoiceId: '$id', invoiceBranchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$invoiceId', '$$invoiceId'] },
                      { $eq: ['$studentId', student.id] },
                      ...(student.branchId
                        ? [{ $eq: ['$branchId', '$$invoiceBranchId'] }]
                        : []),
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
                  confirmedPaidAmount: {
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
                  confirmedPaidAmount: 1,
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
            as: 'paymentTotals',
          },
        },
        {
          $addFields: {
            confirmedPaidAmount: {
              $ifNull: [
                { $arrayElemAt: ['$paymentTotals.confirmedPaidAmount', 0] },
                0,
              ],
            },
            pendingAmount: {
              $ifNull: [
                { $arrayElemAt: ['$paymentTotals.pendingAmount', 0] },
                0,
              ],
            },
            confirmedReceipts: {
              $ifNull: [
                { $arrayElemAt: ['$paymentTotals.confirmedReceipts', 0] },
                [],
              ],
            },
          },
        },
        {
          $addFields: {
            balanceDue: {
              $max: [{ $subtract: ['$amount', '$confirmedPaidAmount'] }, 0],
            },
            availableBalance: {
              $max: [
                {
                  $subtract: [
                    '$amount',
                    { $add: ['$confirmedPaidAmount', '$pendingAmount'] },
                  ],
                },
                0,
              ],
            },
          },
        },
        { $project: { paymentTotals: 0, voucherCode: 0 } },
        { $sort: { dueDate: -1 } },
      ])
      .toArray();
    return res.json({ success: true, data: normalizeInvoiceStatuses(data) });
  } catch (error) {
    return next(error);
  }
});

router.get('/homework', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('homework')
      .aggregate([
        {
          $match: {
            $and: [publishedFilter(), studentClassFilter(req.studentRecord)],
          },
        },
        {
          $lookup: {
            from: 'submissions',
            let: { homeworkId: { $ifNull: ['$id', { $toString: '$_id' }] } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$homeworkId', '$$homeworkId'] },
                      { $eq: ['$studentId', req.studentRecord.id] },
                    ],
                  },
                },
              },
              { $sort: { submittedAt: -1 } },
              { $limit: 1 },
              { $project: { fileData: 0 } },
            ],
            as: 'studentSubmissions',
          },
        },
        { $addFields: { latestSubmission: { $first: '$studentSubmissions' } } },
        { $project: { studentSubmissions: 0 } },
        { $sort: { dueDate: 1 } },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/homework/:homeworkId', async (req, res, next) => {
  try {
    const db = getDatabase();
    const homework = await db.collection('homework').findOne({
      $and: [
        recordIdFilter(req.params.homeworkId),
        publishedFilter(),
        studentClassFilter(req.studentRecord),
      ],
    });
    if (!homework) {
      return res.status(404).json({
        success: false,
        error: 'Published homework was not found for this student.',
      });
    }
    const homeworkId = homework.id || String(homework._id);
    const latestSubmission = await db.collection('submissions').findOne(
      { homeworkId, studentId: req.studentRecord.id },
      { projection: { fileData: 0 }, sort: { submittedAt: -1 } },
    );
    return res.json({
      success: true,
      data: { ...homework, latestSubmission: latestSubmission || null },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/homework/:homeworkId/submissions', async (req, res, next) => {
  try {
    const db = getDatabase();
    const homework = await db.collection('homework').findOne({
      $and: [
        recordIdFilter(req.params.homeworkId),
        publishedFilter(),
        studentClassFilter(req.studentRecord),
      ],
    });
    if (!homework) {
      return res.status(404).json({
        success: false,
        error: 'Published homework was not found for this student.',
      });
    }
    const data = await db
      .collection('submissions')
      .find(
        {
          homeworkId: homework.id || String(homework._id),
          studentId: req.studentRecord.id,
        },
        { projection: { fileData: 0 } },
      )
      .sort({ submittedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/submissions/:submissionId/file', async (req, res, next) => {
  try {
    const submission = await getDatabase().collection('submissions').findOne({
      id: req.params.submissionId,
      studentId: req.studentRecord.id,
    });
    if (!submission || !submission.fileData) {
      return res
        .status(404)
        .json({ success: false, error: 'Submission file was not found.' });
    }
    res.setHeader('Content-Type', submission.contentType);
    const downloadName = path
      .basename(String(submission.fileName || 'submission').replace(/\\/g, '/'))
      .replace(/[\r\n\0"]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(
      Buffer.isBuffer(submission.fileData)
        ? submission.fileData
        : submission.fileData.buffer,
    );
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/homework/:homeworkId/submissions',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const db = getDatabase();
      const homework = await db.collection('homework').findOne({
        $and: [
          recordIdFilter(req.params.homeworkId),
          publishedFilter(),
          studentClassFilter(req.studentRecord),
        ],
      });
      if (!homework)
        return res.status(404).json({
          success: false,
          error: 'Published homework was not found for this student.',
        });
      const textProvided = req.body.text !== undefined;
      if (textProvided && typeof req.body.text !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Submission text must be plain text.',
        });
      }
      const submissionText = textProvided ? req.body.text.trim() : '';
      if (submissionText.length > 10000) {
        return res.status(400).json({
          success: false,
          error: 'Submission text must be 10,000 characters or fewer.',
        });
      }
      if (!req.file && !submissionText) {
        return res.status(400).json({
          success: false,
          error:
            'Provide submission text or attach one PDF, JPEG, or PNG file.',
        });
      }

      const { deadline, error: deadlineError } = submissionDeadline(
        homework.dueDate,
      );
      if (deadlineError) {
        return res.status(409).json({ success: false, error: deadlineError });
      }
      if (deadline && Date.now() > deadline.getTime()) {
        return res.status(409).json({
          success: false,
          error: 'The homework submission deadline has passed.',
        });
      }

      const homeworkId = homework.id || String(homework._id);
      const existingSubmission = await db.collection('submissions').findOne({
        homeworkId,
        studentId: req.studentRecord.id,
      });
      if (existingSubmission) {
        return res.status(409).json({
          success: false,
          error: 'A submission already exists for this homework.',
        });
      }

      const { type, safeFileName, error: fileError } = validateSubmissionFile(req.file);
      if (fileError) {
        return res.status(400).json({ success: false, error: fileError });
      }

      const submission = {
        id: crypto.randomUUID(),
        homeworkId,
        studentId: req.studentRecord.id,
        ...(submissionText ? { text: submissionText } : {}),
        ...(req.file
          ? {
              fileName: safeFileName,
              contentType: type.mime,
              fileSize: req.file.size,
              fileData: req.file.buffer,
            }
          : {}),
        status: 'submitted',
        submittedAt: new Date(),
      };
      const submissions = db.collection('submissions');
      await ensureSubmissionIndex(submissions);
      try {
        await submissions.insertOne(submission);
      } catch (error) {
        if (error?.code === 11000) {
          return res.status(409).json({
            success: false,
            error: 'A submission already exists for this homework.',
          });
        }
        throw error;
      }
      const { fileData, ...response } = submission;
      return res.status(201).json({ success: true, data: response });
    } catch (error) {
      return next(error);
    }
  },
);

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      error:
        status === 413
          ? 'Upload exceeds the 5 MB limit.'
          : 'Upload must include one file and no more than 10 fields.',
    });
  }
  return next(error);
});

module.exports = router;
module.exports.__test = {
  ownedStudentFilter,
  MAX_SUBMISSION_FILE_BYTES,
  publishedFilter,
  requireStudentContext,
  submissionDeadline,
  studentClassFilter,
  validateSubmissionFile,
};
