const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_PARENT_RESERVATION_STATUSES,
  availableInvoiceCents,
  canSettleParentPayment,
} = require('./invoiceReservations');

const invoice = {
  id: 'INV-1', studentId: 'STU-1', branchId: 'BR-1', currency: 'PKR', amount: 100,
};

test('concurrent Parents and Finance share one invoice balance reservation', () => {
  const totals = { paidCents: 2000, pendingCents: 3000, parentReservedCents: 2500 };
  assert.equal(availableInvoiceCents(invoice, totals), 2500);
  const firstParent = { ...totals, parentReservedCents: totals.parentReservedCents + 2500 };
  assert.equal(availableInvoiceCents(invoice, firstParent), 0);
  const financeOverlap = { ...totals, pendingCents: totals.pendingCents + 2000 };
  assert.equal(availableInvoiceCents(invoice, financeOverlap), 500);
});

test('expired and uncertain checkouts stay reserved until authoritative terminal status', () => {
  assert.deepEqual(ACTIVE_PARENT_RESERVATION_STATUSES, ['initiated', 'pending', 'confirming', 'reconciliation_required']);
  const expiredButUnresolved = { paidCents: 0, pendingCents: 0, parentReservedCents: 9000 };
  assert.equal(availableInvoiceCents(invoice, expiredButUnresolved), 1000);
});

test('settlement requires exact invoice, student, branch, currency and a non-overpaid balance', () => {
  const payment = { invoiceId: 'INV-1', studentId: 'STU-1', branchId: 'BR-1', currency: 'PKR', amount: 25 };
  assert.equal(canSettleParentPayment(invoice, payment, { paidCents: 5000, pendingCents: 2500, parentReservedCents: 0 }), true);
  assert.equal(canSettleParentPayment(null, payment, { paidCents: 0, pendingCents: 0, parentReservedCents: 0 }), false);
  assert.equal(canSettleParentPayment(invoice, { ...payment, studentId: 'STU-OTHER' }, { paidCents: 0, pendingCents: 0, parentReservedCents: 0 }), false);
  assert.equal(canSettleParentPayment(invoice, { ...payment, branchId: 'BR-OTHER' }, { paidCents: 0, pendingCents: 0, parentReservedCents: 0 }), false);
  assert.equal(canSettleParentPayment(invoice, { ...payment, currency: 'USD' }, { paidCents: 0, pendingCents: 0, parentReservedCents: 0 }), false);
  assert.equal(canSettleParentPayment(invoice, payment, { paidCents: 7600, pendingCents: 0, parentReservedCents: 0 }), false);
  assert.equal(canSettleParentPayment({ ...invoice, amount: 0 }, payment, { paidCents: 0, pendingCents: 0, parentReservedCents: 0 }), false);
});

test('already-paid invoices are reconciliation cases, not receipt-issuing settlements', () => {
  const payment = { invoiceId: 'INV-1', studentId: 'STU-1', branchId: 'BR-1', currency: 'PKR', amount: 1 };
  assert.equal(canSettleParentPayment(invoice, payment, { paidCents: 10000, pendingCents: 0, parentReservedCents: 0 }), false);
  assert.equal(canSettleParentPayment(invoice, payment, { paidCents: 9000, pendingCents: 1000, parentReservedCents: 0 }), false);
});
