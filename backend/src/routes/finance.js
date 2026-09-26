import { Router } from 'express';
import { z } from 'zod';
import { Invoice, Payment, Refund, CashClosing, Student, Branch } from '../models/index.js';
import { auth, allow, route, problem, getStudent, studentFilter, branchAllowed } from '../middleware/auth.js';
import { id, text, date } from '../config/validation.js';
import { audit } from '../services/audit.js';
export const router = Router();
router.use(auth, allow('SUPER_ADMIN', 'PRINCIPAL', 'ACCOUNTANT', 'PARENT', 'STUDENT'));
const manager = allow('SUPER_ADMIN', 'ACCOUNTANT');
const positivePaisa = z.number().int().min(1).max(100000000);
const requestKey = z.string().min(12).max(100);
const method = z.enum(['CASH', 'BANK', 'CHEQUE']);
const today = () => new Date().toISOString().slice(0, 10);

async function accessibleInvoice(req, invoiceId) {
  const item = await Invoice.findById(id.parse(invoiceId));
  if (!item) throw problem(404, 'Invoice not found');
  await getStudent(req.user, item.studentId, req.selectedStudentId);
  return item;
}
async function ledger(invoice, session) {
  const payments = await Payment.find({ invoiceId: invoice._id }).session(session || null).sort({ createdAt: 1 });
  const refunds = await Refund.find({ invoiceId: invoice._id }).session(session || null).sort({ createdAt: 1 });
  const grossPaid = payments.reduce((n, p) => n + p.amount, 0);
  const refunded = refunds.reduce((n, r) => n + r.amount, 0);
  const discountAmount = invoice.discountAmount || 0;
  const netCharge = invoice.amount - discountAmount;
  const paid = grossPaid - refunded;
  return {
    payments, refunds, grossPaid, refunded, discountAmount, netCharge, paid,
    balance: Math.max(0, netCharge - paid), credit: Math.max(0, paid - netCharge),
  };
}
async function writeInvoice(invoice, operation) {
  const session = await Invoice.startSession();
  try {
    return await session.withTransaction(async () => {
      // A write to the same invoice serializes competing payment, discount and refund operations.
      await Invoice.updateOne({ _id: invoice._id }, { $inc: { paymentRevision: 1 } }, { session });
      const current = await Invoice.findById(invoice._id).session(session);
      return operation(current, session);
    });
  } finally {
    await session.endSession();
  }
}
async function lockCashBranch(branchId, session) {
  await Branch.updateOne({ _id: branchId }, { $inc: { cashRevision: 1 } }, { session });
  if (await CashClosing.exists({ branchId, date: today() }).session(session))
    throw problem(409, 'Cash for this branch and day is closed');
}
router.get('/cash-closings', allow('SUPER_ADMIN', 'ACCOUNTANT'), route(async (req, res) => {
  const filter = req.user.role === 'SUPER_ADMIN' ? {} : { branchId: { $in: req.user.branchIds } };
  res.json({ items: await CashClosing.find(filter).populate('branchId', 'name').sort({ date: -1 }).limit(100) });
}));
router.post('/cash-closings', manager, route(async (req, res) => {
  const data = z.object({ branchId: id, countedAmount: z.number().int().min(0).max(100000000) }).parse(req.body);
  branchAllowed(req.user, data.branchId);
  if (!(await Branch.exists({ _id: data.branchId }))) throw problem(404, 'Branch not found');
  const dateValue = today();
  let item;
  const session = await Invoice.startSession();
  try {
    await session.withTransaction(async () => {
      await Branch.updateOne({ _id: data.branchId }, { $inc: { cashRevision: 1 } }, { session });
      if (await CashClosing.exists({ branchId: data.branchId, date: dateValue }).session(session))
        throw problem(409, 'Cash already closed for this branch today');
      const cutoffAt = new Date();
      const start = new Date(`${dateValue}T00:00:00.000Z`);
      const invoices = await Invoice.find({ branchId: data.branchId }).select('_id').session(session);
      const invoiceIds = invoices.map(i => i._id);
      const payments = await Payment.find({ invoiceId: { $in: invoiceIds }, method: 'CASH', createdAt: { $gte: start, $lte: cutoffAt } }).session(session);
      const refunds = await Refund.find({ invoiceId: { $in: invoiceIds }, method: 'CASH', createdAt: { $gte: start, $lte: cutoffAt } }).session(session);
      const expectedAmount = payments.reduce((n, p) => n + p.amount, 0) - refunds.reduce((n, r) => n + r.amount, 0);
      [item] = await CashClosing.create([{
        branchId: data.branchId, date: dateValue, cutoffAt, expectedAmount,
        countedAmount: data.countedAmount, difference: data.countedAmount - expectedAmount,
        paymentsCount: payments.length, refundsCount: refunds.length, closedBy: req.user._id,
      }], { session });
    });
  } finally { await session.endSession(); }
  await audit(req.user, 'CASH_CLOSE', 'CashClosing', item._id, data.branchId);
  res.status(201).json({ item });
}));
router.get('/', route(async (req, res) => {
  const students = await Student.find(await studentFilter(req.user, req.selectedStudentId)).select('_id');
  const invoices = await Invoice.find({ studentId: { $in: students.map(s => s._id) } }).populate('studentId', 'name admissionNumber').sort({ createdAt: -1 });
  const items = await Promise.all(invoices.map(async i => ({ ...i.toObject(), ...await ledger(i) })));
  res.json({ items });
}));
router.post('/', manager, route(async (req, res) => {
  const data = z.object({ studentId: id, title: text, amount: positivePaisa, dueDate: date }).parse(req.body);
  const student = await getStudent(req.user, data.studentId);
  const item = await Invoice.create({ ...data, branchId: student.branchId });
  await audit(req.user, 'CREATE', 'Invoice', item._id, item.branchId);
  res.status(201).json({ item });
}));
router.put('/:id/concession', allow('SUPER_ADMIN'), route(async (req, res) => {
  const data = z.object({ amount: z.number().int().min(0).max(100000000), reason: z.string().max(500) }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  if (data.amount > invoice.amount) throw problem(400, 'Concession exceeds invoice amount');
  if (data.amount && !data.reason.trim()) throw problem(400, 'Reason is required');
  const item = await writeInvoice(invoice, async (current, session) => {
    current.discountAmount = data.amount;
    current.discountReason = data.reason.trim();
    await current.save({ session });
    return { ...current.toObject(), ...await ledger(current, session) };
  });
  await audit(req.user, 'CONCESSION', 'Invoice', invoice._id, invoice.branchId);
  res.json({ item });
}));
router.post('/:id/payments', manager, route(async (req, res) => {
  const data = z.object({ amount: positivePaisa, method, reference: z.string().max(100).default(''), requestKey }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  const prior = await Payment.findOne({ requestKey: data.requestKey });
  if (prior) {
    if (String(prior.invoiceId) !== String(invoice._id) || prior.amount !== data.amount || prior.method !== data.method || prior.reference !== data.reference)
      throw problem(409, 'Payment request conflict');
    return res.json({ item: prior });
  }
  const item = await writeInvoice(invoice, async (current, session) => {
    const state = await ledger(current, session);
    if (data.amount > state.balance) throw problem(400, 'Payment exceeds balance');
    if (data.method === 'CASH') await lockCashBranch(current.branchId, session);
    const [payment] = await Payment.create([{ ...data, invoiceId: current._id, recordedBy: req.user._id }], { session });
    return payment;
  });
  await audit(req.user, 'PAY', 'Invoice', invoice._id, invoice.branchId);
  res.status(201).json({ item });
}));
router.post('/:id/refunds', allow('SUPER_ADMIN'), route(async (req, res) => {
  const data = z.object({ paymentId: id, amount: positivePaisa, method, reason: z.string().min(3).max(500), reference: z.string().max(100).default(''), requestKey }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  const prior = await Refund.findOne({ requestKey: data.requestKey });
  if (prior) {
    if (String(prior.invoiceId) !== String(invoice._id) || String(prior.paymentId) !== data.paymentId || prior.amount !== data.amount || prior.method !== data.method || prior.reason !== data.reason || prior.reference !== data.reference)
      throw problem(409, 'Refund request conflict');
    return res.json({ item: prior });
  }
  const item = await writeInvoice(invoice, async (current, session) => {
    const state = await ledger(current, session);
    const payment = state.payments.find(p => String(p._id) === data.paymentId);
    if (!payment) throw problem(400, 'Payment does not belong to this invoice');
    const already = state.refunds.filter(r => String(r.paymentId) === data.paymentId).reduce((n, r) => n + r.amount, 0);
    if (data.amount > payment.amount - already || data.amount > state.credit)
      throw problem(400, 'Refund exceeds available credit or payment');
    if (data.method === 'CASH') await lockCashBranch(current.branchId, session);
    const [refund] = await Refund.create([{ ...data, invoiceId: current._id, processedBy: req.user._id }], { session });
    return refund;
  });
  await audit(req.user, 'REFUND', 'Invoice', invoice._id, invoice.branchId);
  res.status(201).json({ item });
}));
