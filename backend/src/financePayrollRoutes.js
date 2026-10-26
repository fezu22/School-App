const crypto = require('node:crypto');
const express = require('express');
const { getDatabase } = require('./database');
const { referenceValues, resolveUserReference } = require('./identityReferenceAdapter');

const money = value => {
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents / 100 : null;
};
const value = (input, max = 200) => typeof input === 'string' && input.trim() && input.trim().length <= max ? input.trim() : null;

async function verifiedStaff(db, reference, branch) {
  const user = await resolveUserReference(db, reference);
  if (!user || ['student', 'parent'].includes(user.role) || user.status === 'inactive') return null;
  const branchMatch = referenceValues(branch).some(item => String(item) === String(user.branchId));
  return branchMatch ? user : null;
}

function createFinancePayrollRouter() {
  const router = express.Router();
  router.get('/staff', async (req, res, next) => {
    try {
      const data = await getDatabase().collection('users').find({
        branchId: req.financeContext.branchFilter,
        role: { $nin: ['student', 'parent'] }, status: { $ne: 'inactive' },
      }, { projection: { _id: 1, id: 1, fullName: 1, name: 1, role: 1, branchId: 1, status: 1 } }).limit(500).toArray();
      return res.json({ success: true, data });
    } catch (error) { return next(error); }
  });
  router.get('/salaries', async (req, res, next) => {
    try {
      const filter = { branchId: req.financeContext.branchFilter };
      if (req.query.month) filter.month = String(req.query.month);
      if (req.query.status) filter.status = String(req.query.status);
      const data = await getDatabase().collection('staffSalaries').find(filter).sort({ month: -1, createdAt: -1 }).limit(1000).toArray();
      return res.json({ success: true, data });
    } catch (error) { return next(error); }
  });
  router.post('/salaries', async (req, res, next) => {
    try {
      const staffUserId = value(req.body?.staffUserId, 120), month = value(req.body?.month, 7);
      const baseSalary = money(req.body?.baseSalary), deductions = money(req.body?.deductions || 0);
      const deductionReason = deductions ? value(req.body?.deductionReason, 1000) : null;
      if (!staffUserId || !/^\d{4}-\d{2}$/.test(month) || baseSalary == null || deductions == null || deductions > baseSalary || (deductions && !deductionReason))
        return res.status(400).json({ success: false, error: 'Verified staff, YYYY-MM month, valid salary, and deduction reason are required.' });
      const db = getDatabase();
      const staff = await verifiedStaff(db, staffUserId, req.financeContext.branch);
      if (!staff) return res.status(404).json({ success: false, error: 'Active staff identity was not found in this Finance branch.' });
      const salary = { id: crypto.randomUUID(), branchId: req.financeContext.branchId, staffUserId: String(staff.id || staff._id), staffName: staff.fullName || staff.name, month, currency: 'PKR', baseSalary, deductions, ...(deductionReason ? { deductionReason } : {}), netSalary: baseSalary - deductions, status: 'draft', createdByUserId: req.financeContext.userId, createdAt: new Date(), updatedAt: new Date() };
      try { await db.collection('staffSalaries').insertOne(salary); }
      catch (error) { if (error?.code === 11000) return res.status(409).json({ success: false, error: 'A salary record already exists for this staff member and month.' }); throw error; }
      return res.status(201).json({ success: true, data: salary });
    } catch (error) { return next(error); }
  });
  router.post('/salaries/:salaryId/approve', async (req, res, next) => {
    try {
      const result = await getDatabase().collection('staffSalaries').findOneAndUpdate(
        { id: req.params.salaryId, branchId: req.financeContext.branchFilter, status: 'draft' },
        { $set: { status: 'approved', approvedByUserId: req.financeContext.userId, approvedAt: new Date(), updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return result ? res.json({ success: true, data: result }) : res.status(409).json({ success: false, error: 'Draft salary was not found in this branch.' });
    } catch (error) { return next(error); }
  });
  router.post('/salaries/:salaryId/payouts', async (req, res, next) => {
    try {
      const method = value(req.body?.method, 40), reference = value(req.body?.reference, 200), paidAtText = value(req.body?.paidAt, 40);
      const paidAt = paidAtText ? new Date(paidAtText) : null;
      if (!method || !reference || !paidAt || !Number.isFinite(paidAt.getTime())) return res.status(400).json({ success: false, error: 'Documented payout method, reference, and paidAt are required.' });
      const db = getDatabase(); const salary = await db.collection('staffSalaries').findOne({ id: req.params.salaryId, branchId: req.financeContext.branchFilter, status: 'approved' });
      if (!salary) return res.status(409).json({ success: false, error: 'Approved salary was not found in this branch.' });
      const payout = { id: crypto.randomUUID(), salaryId: salary.id, branchId: req.financeContext.branchId, staffUserId: salary.staffUserId, amount: salary.netSalary, currency: salary.currency, method, reference, paidAt, recordedByUserId: req.financeContext.userId, createdAt: new Date() };
      const session = require('./database').getClient().startSession();
      try { await session.withTransaction(async () => {
        await db.collection('salaryPayouts').insertOne(payout, { session });
        const updated = await db.collection('staffSalaries').updateOne({ _id: salary._id, status: 'approved' }, { $set: { status: 'paid', payoutId: payout.id, paidAt, updatedAt: new Date() } }, { session });
        if (updated.modifiedCount !== 1) throw new Error('Salary approval changed before payout recording.');
      }); } finally { await session.endSession(); }
      return res.status(201).json({ success: true, data: payout });
    } catch (error) { return next(error); }
  });
  router.get('/salaries/:salaryId/payslip', async (req, res, next) => {
    try {
      const salary = await getDatabase().collection('staffSalaries').findOne({ id: req.params.salaryId, branchId: req.financeContext.branchFilter, status: 'paid' });
      if (!salary) return res.status(404).json({ success: false, error: 'Paid salary was not found in this branch.' });
      const payout = await getDatabase().collection('salaryPayouts').findOne({ id: salary.payoutId, branchId: req.financeContext.branchFilter });
      return res.json({ success: true, data: { salaryId: salary.id, staffUserId: salary.staffUserId, staffName: salary.staffName, month: salary.month, currency: salary.currency, baseSalary: salary.baseSalary, deductions: salary.deductions, deductionReason: salary.deductionReason || null, netSalary: salary.netSalary, status: salary.status, payout } });
    } catch (error) { return next(error); }
  });
  return router;
}

async function initializeFinancePayrollIndexes() {
  await Promise.all([
    getDatabase().collection('staffSalaries').createIndex({ branchId: 1, staffUserId: 1, month: 1 }, { unique: true, name: 'unique_staff_salary_month_branch' }),
    getDatabase().collection('salaryPayouts').createIndex({ branchId: 1, reference: 1 }, { unique: true, name: 'unique_salary_payout_reference_branch' }),
  ]);
}

module.exports = { createFinancePayrollRouter, initializeFinancePayrollIndexes, __test: { money } };
