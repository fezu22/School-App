import { oid, model } from './base.js';

export const FeePlan = model('FeePlan', {
  branchId: { ...oid, ref: 'Branch', required: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  frequency: { type: String, enum: ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL'], required: true },
  amount: { type: Number, required: true, min: 1 },
  dueDay: { type: Number, min: 1, max: 28 },
  classIds: [{ type: oid.type, ref: 'SchoolClass' }],
  studentIds: [{ type: oid.type, ref: 'Student' }],
  active: { type: Boolean, default: true },
  lateFeeType: { type: String, enum: ['NONE', 'FIXED', 'PERCENTAGE'], default: 'NONE' },
  lateFeeAmount: { type: Number, default: 0 },
  lateFeeGraceDays: { type: Number, min: 0, max: 90, default: 0 },
}, [[{ branchId: 1, name: 1 }, {}]]);
