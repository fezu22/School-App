import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { BankReconciliation, Branch, Payment } from '../models/index.js';
import { auth, allow, route, problem, branchAllowed } from '../middleware/auth.js';
import { id } from '../config/validation.js';
import { audit } from '../services/audit.js';

export const router = Router();
router.use(auth, allow('SUPER_ADMIN', 'PRINCIPAL', 'ACCOUNTANT'));
const importer = allow('SUPER_ADMIN', 'ACCOUNTANT');
const reviewer = allow('SUPER_ADMIN', 'PRINCIPAL');
const row = z.object({ rowKey: z.string().min(1).max(150), bankReference: z.string().min(1).max(150), amount: z.number().int().min(1).max(100000000), transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().max(500).default('') });

router.get('/', route(async (req, res) => {
  const filter = req.user.role === 'SUPER_ADMIN' ? {} : { branchId: { $in: req.user.branchIds } };
  res.json({ items: await BankReconciliation.find(filter).populate('branchId', 'name').populate('matchedPaymentId').populate('reviewedBy', 'name').sort({ createdAt: -1 }).limit(500) });
}));

router.post('/import', importer, route(async (req, res) => {
  const data = z.object({ branchId: id, rows: z.array(row).min(1).max(1000) }).parse(req.body);
  branchAllowed(req.user, data.branchId);
  if (!(await Branch.exists({ _id: data.branchId }))) throw problem(404, 'Branch not found');
  if (new Set(data.rows.map(item => item.rowKey)).size !== data.rows.length) throw problem(409, 'Duplicate statement row in import');
  const existing = await BankReconciliation.findOne({ branchId: data.branchId, rowKey: { $in: data.rows.map(item => item.rowKey) } });
  if (existing) throw problem(409, 'Statement row was already imported');
  const items = [];
  for (const statement of data.rows) {
    const candidates = await Payment.find({ method: 'BANK', reference: statement.bankReference, amount: statement.amount }).populate({ path: 'invoiceId', select: 'branchId' });
    const candidate = candidates.find(payment => String(payment.invoiceId?.branchId) === String(data.branchId));
    const matchedPaymentId = candidate?._id;
    const status = candidate ? 'MATCHED' : 'UNMATCHED';
    const ref = randomUUID();
    const auditItem = await audit(req.user, 'BANK_IMPORT_ROW', 'BankReconciliation', ref, data.branchId);
    items.push(await BankReconciliation.create({ ...statement, branchId: data.branchId, importedBy: req.user._id, status, matchedPaymentId, matchReason: candidate ? 'Reference and amount matched a BANK payment; awaiting reviewer approval' : undefined, discrepancyReason: candidate ? undefined : 'No matching BANK payment by reference and amount', auditRef: auditItem.immutableRef }));
  }
  res.status(201).json({ items, matched: items.filter(item => item.status === 'MATCHED').length, unmatched: items.filter(item => item.status === 'UNMATCHED').length, verified: false });
}));

router.post('/:id/review', reviewer, route(async (req, res) => {
  const data = z.object({ decision: z.enum(['APPROVE_MATCH', 'ACCEPT_UNMATCHED', 'REJECT']), discrepancyReason: z.string().max(500).default('') }).parse(req.body);
  const item = await BankReconciliation.findById(id.parse(req.params.id));
  if (!item) throw problem(404, 'Reconciliation item not found');
  branchAllowed(req.user, item.branchId);
  if (item.reviewedAt) throw problem(409, 'Reconciliation item already reviewed');
  if (data.decision === 'APPROVE_MATCH' && (item.status !== 'MATCHED' || !item.matchedPaymentId)) throw problem(400, 'Only matched bank rows can be approved as matched');
  if (data.decision === 'ACCEPT_UNMATCHED' && item.status !== 'UNMATCHED') throw problem(400, 'Only unmatched bank rows can be accepted as unmatched');
  if (data.decision !== 'APPROVE_MATCH' && !data.discrepancyReason.trim()) throw problem(400, 'Discrepancy reason is required');
  const reviewed = await audit(req.user, `BANK_${data.decision}`, 'BankReconciliation', item._id, item.branchId);
  item.status = data.decision === 'APPROVE_MATCH' ? 'APPROVED' : data.decision === 'ACCEPT_UNMATCHED' ? 'APPROVED' : 'REJECTED';
  item.discrepancyReason = data.discrepancyReason.trim() || item.discrepancyReason;
  item.reviewedBy = req.user._id; item.reviewedAt = new Date(); item.reviewAuditRef = reviewed.immutableRef;
  await item.save();
  res.json({ item, verifiedPayment: false });
}));
