import { oid, model } from './base.js';
export const CashEntry = model('CashEntry', {
  branchId: { ...oid, ref: 'Branch', required: true },
  cashierId: { ...oid, ref: 'User', required: true },
  kind: { type: String, enum: ['OPENING', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT'], required: true },
  date: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  description: { type: String, required: true },
  transferReference: String,
  occurredAt: { type: Date, required: true },
  requestKey: { type: String, unique: true, required: true },
  auditRef: { type: String, unique: true, required: true },
  closingId: { ...oid, ref: 'CashClosing' },
}, [[{ branchId: 1, date: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: 'OPENING' } }]]);
