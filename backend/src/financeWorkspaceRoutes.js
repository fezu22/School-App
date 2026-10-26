const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { getDatabase, getClient } = require('./database');
const {
  amount,
  text,
  validDate,
  validateImage,
  chargeCategories,
  expenseCategories,
  paymentMethods,
} = require('./financeWorkspaceValidation');

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 12 },
});
function parseUpload(req, res, next) {
  upload.single('bill')(req, res, error => {
    if (error instanceof multer.MulterError)
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        success: false,
        error:
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Bill attachment must be 5 MB or smaller.'
            : 'Only one bill attachment is allowed.',
      });
    if (error)
      return res
        .status(400)
        .json({ success: false, error: 'Bill attachment could not be read.' });
    next();
  });
}
function auditRecord(
  branchId,
  actorUserId,
  action,
  entityType,
  entityId,
  details,
  createdAt,
) {
  return {
    id: crypto.randomUUID(),
    branchId,
    actorUserId,
    action,
    entityType,
    entityId,
    details,
    createdAt,
  };
}

function createFinanceWorkspaceRouter() {
  const router = express.Router();
  router.get('/workspace', (req, res) => {
    const branch = req.financeContext.branch;
    return res.json({
      success: true,
      data: {
        branch: {
          id: String(branch._id),
          name:
            branch.name ||
            branch.branchName ||
            branch.title ||
            'Assigned campus',
          code: branch.code || null,
        },
      },
    });
  });
  router.get('/reports/monthly', async (req, res, next) => {
    try {
      const now = new Date();
      const monthStarts = [];
      for (let offset = 5; offset >= 0; offset -= 1)
        monthStarts.push(
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
          ),
        );
      const from = monthStarts[0],
        until = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        );
      const branchId = req.financeContext.branchFilter;
      const [payments, expenseRows, payouts] = await Promise.all([
        getDatabase()
          .collection('payments')
          .find(
            {
              branchId,
              status: 'confirmed',
              confirmedAt: { $gte: from, $lt: until },
            },
            { projection: { amount: 1, confirmedAt: 1 } },
          )
          .limit(10000)
          .toArray(),
        getDatabase()
          .collection('financeExpenses')
          .find(
            {
              branchId,
              expenseDate: {
                $gte: from.toISOString().slice(0, 10),
                $lt: until.toISOString().slice(0, 10),
              },
            },
            { projection: { amount: 1, expenseDate: 1 } },
          )
          .limit(10000)
          .toArray(),
        getDatabase()
          .collection('salaryPayouts')
          .find(
            { branchId, paidAt: { $gte: from, $lt: until } },
            { projection: { amount: 1, paidAt: 1 } },
          )
          .limit(10000)
          .toArray(),
      ]);
      const data = monthStarts.map(start => {
        const key = start.toISOString().slice(0, 7);
        const nextStart = new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
        );
        return {
          month: key,
          collected: payments
            .filter(
              item => item.confirmedAt >= start && item.confirmedAt < nextStart,
            )
            .reduce((sum, item) => sum + Number(item.amount || 0), 0),
          expenses: expenseRows
            .filter(item => String(item.expenseDate).startsWith(key))
            .reduce((sum, item) => sum + Number(item.amount || 0), 0),
          payroll: payouts
            .filter(item => item.paidAt >= start && item.paidAt < nextStart)
            .reduce((sum, item) => sum + Number(item.amount || 0), 0),
        };
      });
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });
  router.get('/extra-charges', async (req, res, next) => {
    try {
      const data = await getDatabase()
        .collection('financeExtraCharges')
        .find({ branchId: req.financeContext.branchFilter })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/extra-charges', async (req, res, next) => {
    try {
      const title = text(req.body?.title, 120);
      const category = text(req.body?.category, 32);
      const perStudentAmount = amount(req.body?.perStudentAmount);
      const dueDate = text(req.body?.dueDate, 10);
      const grade =
        req.body?.grade === 'all' ? 'all' : text(req.body?.grade, 40);
      const description = req.body?.description
        ? text(req.body.description, 500)
        : '';
      if (
        !title ||
        !chargeCategories.has(category) ||
        perStudentAmount == null ||
        !validDate(dueDate) ||
        !grade ||
        (req.body?.description && description === null)
      )
        return res.status(400).json({
          success: false,
          error:
            'Title, supported category, valid per-student amount, due date and grade scope are required.',
        });
      const now = new Date();
      const charge = {
        id: crypto.randomUUID(),
        branchId: req.financeContext.branchId,
        title,
        category,
        perStudentAmount,
        currency: 'PKR',
        dueDate,
        grade,
        description,
        status: 'draft',
        createdByUserId: req.financeContext.userId,
        createdAt: now,
        updatedAt: now,
      };
      const db = getDatabase(),
        session = getClient().startSession();
      try {
        await session.withTransaction(async () => {
          await db
            .collection('financeExtraCharges')
            .insertOne(charge, { session });
          await db
            .collection('financeAuditLogs')
            .insertOne(
              auditRecord(
                req.financeContext.branchId,
                req.financeContext.userId,
                'extra_charge.created',
                'extra_charge',
                charge.id,
                { title, category, perStudentAmount, grade, dueDate },
                now,
              ),
              { session },
            );
        });
      } finally {
        await session.endSession();
      }
      return res.status(201).json({ success: true, data: charge });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/extra-charges/:chargeId/apply', async (req, res, next) => {
    const db = getDatabase();
    const session = getClient().startSession();
    try {
      let response;
      await session.withTransaction(async () => {
        const charges = db.collection('financeExtraCharges');
        const charge = await charges.findOne(
          {
            id: req.params.chargeId,
            branchId: req.financeContext.branchFilter,
          },
          { session },
        );
        if (!charge) {
          response = {
            status: 404,
            body: {
              success: false,
              error: 'Extra charge was not found in this branch.',
            },
          };
          return;
        }
        if (charge.status === 'applied') {
          response = {
            status: 200,
            body: {
              success: true,
              data: {
                chargeId: charge.id,
                status: 'applied',
                invoiceCount: charge.invoiceCount || 0,
                duplicate: true,
              },
            },
          };
          return;
        }
        const studentFilter = {
          branchId: { $in: req.financeContext.branchValues },
          status: { $ne: 'inactive' },
        };
        if (charge.grade !== 'all')
          studentFilter.grade = /^\d+$/.test(charge.grade)
            ? { $in: [charge.grade, Number(charge.grade)] }
            : charge.grade;
        const students = await db
          .collection('students')
          .find(studentFilter, {
            session,
            projection: {
              id: 1,
              studentId: 1,
              fullName: 1,
              name: 1,
              grade: 1,
              section: 1,
              branchId: 1,
            },
          })
          .limit(5000)
          .toArray();
        const validStudents = students.filter(
          student =>
            typeof (student.id || student.studentId) === 'string' &&
            (student.id || student.studentId).trim(),
        );
        if (!validStudents.length) {
          response = {
            status: 409,
            body: {
              success: false,
              error:
                'No active students matched this branch and grade. Nothing was billed.',
            },
          };
          return;
        }
        const now = new Date();
        const invoices = validStudents.map(student => ({
          id: crypto.randomUUID(),
          branchId: req.financeContext.branchId,
          studentId: String(student.id || student.studentId),
          student: student.fullName || student.name || null,
          description: charge.title,
          lineItems: [
            {
              title: charge.title,
              category: charge.category,
              amount: charge.perStudentAmount,
            },
          ],
          amount: charge.perStudentAmount,
          currency: charge.currency,
          dueDate: charge.dueDate,
          status: 'due',
          sourceChargeId: charge.id,
          createdByUserId: req.financeContext.userId,
          createdAt: now,
          updatedAt: now,
        }));
        await db
          .collection('invoices')
          .insertMany(invoices, { session, ordered: true });
        const updated = await charges.updateOne(
          { _id: charge._id, status: 'draft' },
          {
            $set: {
              status: 'applied',
              invoiceCount: invoices.length,
              appliedAt: now,
              appliedByUserId: req.financeContext.userId,
              updatedAt: now,
            },
          },
          { session },
        );
        if (updated.modifiedCount !== 1)
          throw new Error('Extra charge changed before it could be applied.');
        await db.collection('financeAuditLogs').insertOne(
          auditRecord(
            req.financeContext.branchId,
            req.financeContext.userId,
            'extra_charge.applied',
            'extra_charge',
            charge.id,
            {
              invoiceCount: invoices.length,
              perStudentAmount: charge.perStudentAmount,
              grade: charge.grade,
            },
            now,
          ),
          { session },
        );
        response = {
          status: 200,
          body: {
            success: true,
            data: {
              chargeId: charge.id,
              status: 'applied',
              invoiceCount: invoices.length,
            },
          },
        };
      });
      return res.status(response.status).json(response.body);
    } catch (error) {
      return next(error);
    } finally {
      await session.endSession();
    }
  });

  router.get('/expenses', async (req, res, next) => {
    try {
      const data = await getDatabase()
        .collection('financeExpenses')
        .find({ branchId: req.financeContext.branchFilter })
        .sort({ expenseDate: -1, createdAt: -1 })
        .limit(500)
        .project({
          _id: 1,
          id: 1,
          title: 1,
          category: 1,
          amount: 1,
          currency: 1,
          vendor: 1,
          expenseDate: 1,
          method: 1,
          notes: 1,
          attachment: 1,
          status: 1,
          approvedByName: 1,
          createdAt: 1,
        })
        .toArray();
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  });
  router.post('/expenses', parseUpload, async (req, res, next) => {
    try {
      const title = text(req.body?.title, 120),
        category = text(req.body?.category, 32);
      const total = amount(req.body?.amount),
        vendor = text(req.body?.vendor, 120);
      const expenseDate = text(req.body?.expenseDate, 10),
        method = text(req.body?.method, 32);
      const notes = req.body?.notes ? text(req.body.notes, 1000) : '';
      if (
        !title ||
        !expenseCategories.has(category) ||
        total == null ||
        !vendor ||
        !validDate(expenseDate) ||
        !paymentMethods.has(method) ||
        (req.body?.notes && notes === null)
      )
        return res.status(400).json({
          success: false,
          error:
            'Title, category, positive amount, vendor, valid date and payment method are required.',
        });
      const attachmentCheck = req.file ? validateImage(req.file) : null;
      if (req.file && !attachmentCheck)
        return res.status(400).json({
          success: false,
          error: 'Bill must be a valid JPEG or PNG image no larger than 5 MB.',
        });
      const db = getDatabase(),
        now = new Date(),
        id = crypto.randomUUID();
      const expense = {
        id,
        branchId: req.financeContext.branchId,
        title,
        category,
        amount: total,
        currency: 'PKR',
        vendor,
        expenseDate,
        method,
        notes,
        status: 'recorded',
        recordedByUserId: req.financeContext.userId,
        createdAt: now,
        updatedAt: now,
        ...(req.file
          ? {
              attachment: {
                fileName:
                  text(req.file.originalname, 160) ||
                  `bill.${attachmentCheck.extension}`,
                contentType: attachmentCheck.contentType,
                fileSize: req.file.size,
              },
            }
          : {}),
      };
      const session = getClient().startSession();
      try {
        await session.withTransaction(async () => {
          await db
            .collection('financeExpenses')
            .insertOne(expense, { session });
          if (req.file)
            await db.collection('financeExpenseAttachments').insertOne(
              {
                id: crypto.randomUUID(),
                expenseId: id,
                branchId: req.financeContext.branchId,
                contentType: attachmentCheck.contentType,
                fileName: expense.attachment.fileName,
                fileSize: req.file.size,
                data: req.file.buffer,
                uploadedByUserId: req.financeContext.userId,
                createdAt: now,
              },
              { session },
            );
          await db.collection('financeAuditLogs').insertOne(
            auditRecord(
              req.financeContext.branchId,
              req.financeContext.userId,
              'expense.recorded',
              'expense',
              id,
              {
                title,
                category,
                amount: total,
                vendor,
                expenseDate,
                method,
                hasAttachment: Boolean(req.file),
              },
              now,
            ),
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      return res.status(201).json({ success: true, data: expense });
    } catch (error) {
      return next(error);
    }
  });
  router.get('/expenses/:expenseId/attachment', async (req, res, next) => {
    try {
      const db = getDatabase();
      const expense = await db.collection('financeExpenses').findOne(
        {
          id: req.params.expenseId,
          branchId: req.financeContext.branchFilter,
        },
        { projection: { id: 1 } },
      );
      if (!expense)
        return res.status(404).json({
          success: false,
          error: 'Expense was not found in this branch.',
        });
      const attachment = await db
        .collection('financeExpenseAttachments')
        .findOne({
          expenseId: expense.id,
          branchId: req.financeContext.branchId,
        });
      if (
        !attachment ||
        !Buffer.isBuffer(attachment.data) ||
        !['image/jpeg', 'image/png'].includes(attachment.contentType)
      )
        return res
          .status(404)
          .json({ success: false, error: 'Bill attachment was not found.' });
      return res
        .status(200)
        .set({
          'Content-Type': attachment.contentType,
          'Content-Length': String(attachment.fileSize),
          'Content-Disposition': `inline; filename="${attachment.fileName.replace(
            /["\r\n]/g,
            '',
          )}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(attachment.data);
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

async function initializeFinanceWorkspaceIndexes(db = getDatabase()) {
  await Promise.all([
    db
      .collection('financeExtraCharges')
      .createIndex(
        { branchId: 1, createdAt: -1 },
        { name: 'finance_extra_charges_branch_date' },
      ),
    db
      .collection('financeExtraCharges')
      .createIndex(
        { id: 1 },
        { unique: true, name: 'unique_finance_extra_charge_id' },
      ),
    db
      .collection('financeExpenses')
      .createIndex(
        { branchId: 1, expenseDate: -1 },
        { name: 'finance_expenses_branch_date' },
      ),
    db
      .collection('financeExpenses')
      .createIndex(
        { id: 1 },
        { unique: true, name: 'unique_finance_expense_id' },
      ),
    db
      .collection('financeExpenseAttachments')
      .createIndex(
        { expenseId: 1, branchId: 1 },
        { unique: true, name: 'unique_finance_expense_attachment' },
      ),
    db
      .collection('financeAuditLogs')
      .createIndex(
        { branchId: 1, createdAt: -1 },
        { name: 'finance_audit_branch_date' },
      ),
    db.collection('invoices').createIndex(
      { sourceChargeId: 1, studentId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          sourceChargeId: { $type: 'string' },
          studentId: { $type: 'string' },
        },
        name: 'unique_extra_charge_student_invoice',
      },
    ),
  ]);
}

module.exports = {
  createFinanceWorkspaceRouter,
  initializeFinanceWorkspaceIndexes,
};
