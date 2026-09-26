import { oid, model } from './base.js';
export const Refund = model('Refund', {
  invoiceId: { ...oid, ref: 'Invoice', required: true },
  paymentId: { ...oid, ref: 'Payment', required: true },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['CASH', 'BANK', 'CHEQUE'], required: true },
  reason: { type: String, required: true },
  reference: String,
  processedBy: { ...oid, ref: 'User' },
  requestKey: { type: String, unique: true, required: true },
});
