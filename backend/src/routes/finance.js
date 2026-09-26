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
const lateFeeFor = invoice => {
  if (!invoice.lateFeeType || invoice.lateFeeType === 'NONE' || !invoice.dueDate) return 0;
  const due = new Date(`${invoice.dueDate}T23:59:59.999Z`);
  due.setUTCDate(due.getUTCDate() + (invoice.lateFeeGraceDays || 0));
  if (Date.now() <= due.getTime()) return 0;
  return invoice.lateFeeType === 'PERCENTAGE'
    ? Math.floor(invoice.amount * (invoice.lateFeeAmount || 0) / 100)
    : invoice.lateFeeAmount || 0;
};
const printable = (kind, invoice, payment, state) => ({
  kind,
  currency: 'PKR',
  documentNumber: `${kind}-${String(payment?._id || invoice._id)}`,
  issuedAt: new Date().toISOString(),
  student: invoice.studentId,
  invoice: { _id: invoice._id, title: invoice.title, category: invoice.category, dueDate: invoice.dueDate, periodKey: invoice.periodKey },
  amounts: payment ? { payment: payment.amount, paid: state.paid, balance: state.balance } : { charge: state.netCharge, balance: state.balance },
  payment: payment ? { amount: payment.amount, method: payment.method, reference: payment.reference, createdAt: payment.createdAt } : null,
});

async function accessibleInvoice(req, invoiceId) {
  const item = await Invoice.findById(id.parse(invoiceId));
  if (!item) throw problem(404, 'Invoice not found');
  await getStudent(req.user, item.studentId, req.selectedStudentId);
  return item;
}
async function ledger(invoice, session) {
  const payments = await Payment.find({ $or: [{ invoiceId: invoice._id }, { 'allocations.invoiceId': invoice._id }] }).session(session || null).sort({ createdAt: 1 });
  const refunds = await Refund.find({ invoiceId: invoice._id }).session(session || null).sort({ createdAt: 1 });
  const invoiceAmount = payment => payment.allocations?.length
    ? payment.allocations.filter(a => String(a.invoiceId) === String(invoice._id)).reduce((n, a) => n + a.amount, 0)
    : String(payment.invoiceId) === String(invoice._id) ? payment.amount : 0;
  const grossPaid = payments.reduce((n, p) => n + invoiceAmount(p), 0);
  const refunded = refunds.reduce((n, r) => n + r.amount, 0);
  const discountAmount = invoice.discountAmount || 0;
  const lateFee = lateFeeFor(invoice);
  const netCharge = invoice.amount + lateFee - discountAmount;
  const paid = grossPaid - refunded;
  const dues = (invoice.dues?.length ? invoice.dues : [{ key: 'default', title: invoice.title, amount: invoice.amount, dueDate: invoice.dueDate }]).map(due => ({
    ...(due.toObject?.() || due),
    amount: due.key === 'default' ? due.amount + lateFee : due.amount,
    paid: Math.max(0, payments.reduce((n, p) => n + (p.allocations?.length
      ? p.allocations.filter(a => String(a.invoiceId) === String(invoice._id) && a.dueKey === due.key).reduce((x, a) => x + a.amount, 0)
      : String(p.invoiceId) === String(invoice._id) && due.key === 'default' ? p.amount : 0), 0) - (due.key === 'default' ? refunded : 0)),
  })).map(due => ({ ...due, balance: Math.max(0, due.amount - due.paid) }));
  const studentInvoices = await Invoice.find({ studentId: invoice.studentId }).select('_id').session(session || null);
  const studentInvoiceIds = studentInvoices.map(item => item._id);
  const studentPayments = await Payment.find({ invoiceId: { $in: studentInvoiceIds } }).select('advanceAmount').session(session || null);
  const advanceCredit = studentPayments.reduce((n, p) => n + (p.advanceAmount || 0) - (p.advanceUsed || 0), 0);
  return {
    payments, refunds, grossPaid, refunded, discountAmount, lateFee, netCharge, paid, dues,
    balance: Math.max(0, netCharge - paid), outstandingBalance: Math.max(0, netCharge - paid),
    credit: Math.max(0, paid - netCharge), advanceCredit,
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
router.get('/:id/voucher', route(async (req, res) => {
  const invoice = await accessibleInvoice(req, req.params.id);
  const state = await ledger(invoice);
  res.json({ document: printable('VOUCHER', invoice, null, state) });
}));
router.get('/:id/payments/:paymentId/receipt', route(async (req, res) => {
  const invoice = await accessibleInvoice(req, req.params.id);
  const payment = await Payment.findOne({ _id: id.parse(req.params.paymentId), invoiceId: invoice._id });
  if (!payment) throw problem(404, 'Payment not found for this invoice');
  const state = await ledger(invoice);
  res.json({ document: printable('RECEIPT', invoice, payment, state) });
}));
router.post('/', manager, route(async (req, res) => {
  const data = z.object({ studentId: id, title: text, amount: positivePaisa, dueDate: date }).parse(req.body);
  const student = await getStudent(req.user, data.studentId);
  const item = await Invoice.create({ ...data, branchId: student.branchId, dues: [{ key: 'default', title: data.title, amount: data.amount, dueDate: data.dueDate }] });
  await audit(req.user, 'CREATE', 'Invoice', item._id, item.branchId);
  res.status(201).json({ item });
}));
router.put('/:id/concession', allow('SUPER_ADMIN'), route(async (req, res) => {
  const data = z.object({ amount: z.number().int().min(0).max(100000000), reason: z.string().max(500), kind: z.enum(['SCHOLARSHIP', 'SIBLING', 'NONE']).default('NONE') }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  if (data.amount > invoice.amount) throw problem(400, 'Concession exceeds invoice amount');
  if (data.amount && !data.reason.trim()) throw problem(400, 'Reason is required');
  const item = await writeInvoice(invoice, async (current, session) => {
    current.discountAmount = data.amount;
    current.discountReason = data.reason.trim();
    current.discountKind = data.kind;
    await current.save({ session });
    return { ...current.toObject(), ...await ledger(current, session) };
  });
  await audit(req.user, 'CONCESSION', 'Invoice', invoice._id, invoice.branchId);
  res.json({ item });
}));
router.put('/:id/scholarship', allow('SUPER_ADMIN'), route(async (req, res) => {
  const data = z.object({ amount: z.number().int().min(1).max(100000000), reason: z.string().min(3).max(500) }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  if (data.amount > invoice.amount) throw problem(400, 'Scholarship exceeds invoice amount');
  const item = await writeInvoice(invoice, async (current, session) => {
    current.discountAmount = data.amount; current.discountReason = data.reason.trim(); current.discountKind = 'SCHOLARSHIP';
    await current.save({ session }); return { ...current.toObject(), ...await ledger(current, session) };
  });
  await audit(req.user, 'SCHOLARSHIP', 'Invoice', invoice._id, invoice.branchId);
  res.json({ item });
}));
router.put('/:id/sibling-discount', allow('SUPER_ADMIN'), route(async (req, res) => {
  const data = z.object({ percent: z.number().int().min(1).max(100), reason: z.string().min(3).max(500) }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  const student = await Student.findById(invoice.studentId);
  if (!student?.guardianName) throw problem(400, 'Student has no guardian identity for sibling matching');
  const siblings = await Student.countDocuments({ guardianName: student.guardianName, _id: { $ne: student._id }, active: true });
  if (!siblings) throw problem(400, 'No active sibling found for this discount');
  const amount = Math.floor(invoice.amount * data.percent / 100);
  const item = await writeInvoice(invoice, async (current, session) => {
    current.discountAmount = amount; current.discountReason = data.reason.trim(); current.discountKind = 'SIBLING';
    await current.save({ session }); return { ...current.toObject(), ...await ledger(current, session) };
  });
  await audit(req.user, 'SIBLING_DISCOUNT', 'Invoice', invoice._id, invoice.branchId);
  res.json({ item, siblings });
}));
router.post('/:id/payments', manager, route(async (req, res) => {
  const data = z.object({
    amount: positivePaisa, method, reference: z.string().max(100).default(''), requestKey,
    allocations: z.array(z.object({ invoiceId: id, dueKey: z.string().min(1).max(80), amount: positivePaisa })).optional(),
    advanceUsed: z.number().int().min(0).max(100000000).default(0),
  }).parse(req.body);
  const invoice = await accessibleInvoice(req, req.params.id);
  const prior = await Payment.findOne({ requestKey: data.requestKey });
  if (prior) {
    const priorAllocations = prior.allocations?.length ? prior.allocations.map(item => ({ invoiceId: String(item.invoiceId), dueKey: item.dueKey, amount: item.amount })) : prior.advanceAmount > 0 ? [] : [{ invoiceId: String(prior.invoiceId), dueKey: 'default', amount: prior.amount }];
    const requestedAllocations = data.allocations === undefined ? [{ invoiceId: String(invoice._id), dueKey: 'default', amount: data.amount }] : data.allocations.map(item => ({ invoiceId: String(item.invoiceId), dueKey: item.dueKey, amount: item.amount }));
    if (String(prior.invoiceId) !== String(invoice._id) || prior.amount !== data.amount || prior.method !== data.method || prior.reference !== data.reference || prior.advanceUsed !== data.advanceUsed || JSON.stringify(priorAllocations) !== JSON.stringify(requestedAllocations))
      throw problem(409, 'Payment request conflict');
    return res.json({ item: prior });
  }
  const item = await writeInvoice(invoice, async (current, session) => {
    const state = await ledger(current, session);
    const studentInvoices = await Invoice.find({ studentId: current.studentId }).select('_id').session(session);
    const existingPayments = await Payment.find({ invoiceId: { $in: studentInvoices.map(item => item._id) } }).select('advanceAmount advanceUsed').session(session);
    const availableAdvance = existingPayments.reduce((n, p) => n + (p.advanceAmount || 0) - (p.advanceUsed || 0), 0);
    if (data.advanceUsed > availableAdvance) throw problem(400, 'Advance credit exceeds available student credit');
    const allocations = data.allocations === undefined ? [{ invoiceId: current._id, dueKey: 'default', amount: data.amount + data.advanceUsed }] : data.allocations;
    const allocated = allocations.reduce((n, allocation) => n + allocation.amount, 0);
    if (allocated > data.amount + data.advanceUsed) throw problem(400, 'Allocations exceed payment and advance amount');
    const seen = new Set();
    for (const allocation of allocations) {
      const target = await Invoice.findById(allocation.invoiceId).session(session);
      if (!target || String(target.studentId) !== String(current.studentId) || String(target.branchId) !== String(current.branchId)) throw problem(403, 'Payment allocation is outside the student branch');
      const targetState = await ledger(target, session);
      const due = targetState.dues.find(item => item.key === allocation.dueKey);
      if (!due) throw problem(400, 'Payment allocation references an unknown due');
      if (seen.has(`${target._id}:${due.key}`)) throw problem(400, 'Duplicate payment allocation');
      seen.add(`${target._id}:${due.key}`);
      if (allocation.amount > due.balance) throw problem(400, 'Payment allocation exceeds due balance');
    }
    if (data.method === 'CASH') await lockCashBranch(current.branchId, session);
    const [payment] = await Payment.create([{ ...data, allocations, advanceAmount: data.amount + data.advanceUsed - allocated, invoiceId: current._id, recordedBy: req.user._id }], { session });
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
