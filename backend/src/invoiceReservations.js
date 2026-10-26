const ACTIVE_PARENT_RESERVATION_STATUSES = [
  'initiated',
  'pending',
  'confirming',
  'reconciliation_required',
];

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

function checkoutIdempotencyKey(parentUserId, studentId, invoiceId, method, suppliedKey) {
  if (suppliedKey) return suppliedKey;
  const digest = crypto.createHash('sha256').update(`${parentUserId}:${studentId}:${invoiceId}:${method}`).digest('hex');
  return `auto-${digest}`;
}

function checkoutRequestHash(studentId, invoiceId, method) {
  return crypto.createHash('sha256').update(JSON.stringify({ studentId, invoiceId, method })).digest('hex');
}

function availableInvoiceCents(invoice, totals) {
  const totalCents = cents(invoice?.amount);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return 0;
  return Math.max(totalCents - totals.paidCents - totals.pendingCents - totals.parentReservedCents, 0);
}

function canSettleParentPayment(invoice, payment, totals) {
  const amountCents = cents(payment?.amount);
  const totalCents = cents(invoice?.amount);
  return Boolean(invoice && Number.isSafeInteger(amountCents) && amountCents > 0 &&
    Number.isSafeInteger(totalCents) && totalCents > 0 &&
    String(invoice.id) === String(payment.invoiceId) && String(invoice.studentId) === String(payment.studentId) && String(invoice.branchId) === String(payment.branchId) &&
    String(invoice.currency || 'PKR').toUpperCase() === String(payment.currency || '').toUpperCase() &&
    totals.paidCents + totals.pendingCents + totals.parentReservedCents + amountCents <= totalCents);
}

async function lockInvoice(invoices, invoice, session) {
  const result = await invoices.updateOne(
    { _id: invoice._id, id: invoice.id, branchId: invoice.branchId },
    { $inc: { paymentReservationVersion: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    const error = new Error('Invoice changed while reserving its balance.');
    error.statusCode = 409;
    throw error;
  }
  return invoices.findOne({ _id: invoice._id }, { session });
}

async function invoiceReservedCents(db, invoice, session, excludeParentPaymentId) {
  const options = session ? { session } : {};
  const payments = await db.collection('payments').find({
    invoiceId: invoice.id,
    studentId: invoice.studentId,
    branchId: invoice.branchId,
    status: { $in: ['confirmed', 'pending_verification'] },
  }, options).toArray();
  const parentPayments = await db.collection('parentOnlinePayments').find({
    invoiceId: invoice.id,
    studentId: invoice.studentId,
    branchId: invoice.branchId,
    status: { $in: ACTIVE_PARENT_RESERVATION_STATUSES },
    activeKey: 'active',
    ...(excludeParentPaymentId ? { _id: { $ne: excludeParentPaymentId } } : {}),
  }, options).toArray();
  return {
    paidCents: payments.reduce((sum, item) => sum + (item.status === 'confirmed' ? cents(item.amount) : 0), 0),
    pendingCents: payments.reduce((sum, item) => sum + (item.status === 'pending_verification' ? cents(item.amount) : 0), 0),
    parentReservedCents: parentPayments.reduce((sum, item) => sum + cents(item.amount), 0),
  };
}

module.exports = { ACTIVE_PARENT_RESERVATION_STATUSES, cents, checkoutIdempotencyKey, checkoutRequestHash, availableInvoiceCents, canSettleParentPayment, lockInvoice, invoiceReservedCents };
const crypto = require('node:crypto');
