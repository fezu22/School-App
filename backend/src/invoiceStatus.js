'use strict';

const PARTIAL_INVOICE_STATUS = 'partially_paid';
const LEGACY_PARTIAL_INVOICE_STATUS = 'partial';
const FINANCE_INVOICE_STATUSES = ['due', 'overdue', PARTIAL_INVOICE_STATUS, 'paid'];

function normalizeInvoiceStatus(status) {
  return status === LEGACY_PARTIAL_INVOICE_STATUS
    ? PARTIAL_INVOICE_STATUS
    : status;
}

function normalizeInvoiceStatuses(invoices) {
  return invoices.map(invoice => {
    if (!Object.prototype.hasOwnProperty.call(invoice, 'status')) return { ...invoice };
    return { ...invoice, status: normalizeInvoiceStatus(invoice.status) };
  });
}

function invoiceStatusFromCents(totalCents, paidCents) {
  if (paidCents >= totalCents) return 'paid';
  if (paidCents > 0) return PARTIAL_INVOICE_STATUS;
  return 'due';
}

function financeInvoiceStatusMatch(status) {
  if (!status) return {};
  if (status === PARTIAL_INVOICE_STATUS) {
    // Read legacy stored rows until the separately approved data migration runs.
    return { status: { $in: [PARTIAL_INVOICE_STATUS, LEGACY_PARTIAL_INVOICE_STATUS] } };
  }
  return { status };
}

function isFinanceInvoiceStatus(status) {
  return FINANCE_INVOICE_STATUSES.includes(status);
}

module.exports = {
  PARTIAL_INVOICE_STATUS,
  LEGACY_PARTIAL_INVOICE_STATUS,
  FINANCE_INVOICE_STATUSES,
  normalizeInvoiceStatus,
  normalizeInvoiceStatuses,
  invoiceStatusFromCents,
  financeInvoiceStatusMatch,
  isFinanceInvoiceStatus,
};
