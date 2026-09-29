import { oid, model } from './base.js';
export const BankReconciliation = model('BankReconciliation', {
  branchId: { ...oid, ref: 'Branch', required: true },
  importedBy: { ...oid, ref: 'User', required: true },
  rowKey: { type: String, required: true },
  bankReference: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  transactionDate: { type: String, required: true },
  description: String,
  status: { type: String, enum: ['MATCHED', 'UNMATCHED', 'APPROVED', 'REJECTED'], required: true },
  matchedPaymentId: { ...oid, ref: 'Payment' },
  matchReason: String,
  discrepancyReason: String,
  reviewedBy: { ...oid, ref: 'User' },
  reviewedAt: Date,
  auditRef: { type: String, unique: true, required: true },
  reviewAuditRef: String,
}, [[{ branchId: 1, rowKey: 1 }, { unique: true }]]);
