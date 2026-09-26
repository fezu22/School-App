import { oid, model } from './base.js';
export const CashClosing = model('CashClosing', {
  branchId: { ...oid, ref: 'Branch', required: true },
  date: { type: String, required: true },
  cutoffAt: { type: Date, required: true },
  expectedAmount: { type: Number, required: true },
  countedAmount: { type: Number, required: true },
  difference: { type: Number, required: true },
  paymentsCount: Number,
  refundsCount: Number,
  closedBy: { ...oid, ref: 'User' },
}, [[{ branchId: 1, date: 1 }, { unique: true }]]);
