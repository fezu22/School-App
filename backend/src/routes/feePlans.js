import { Router } from 'express';
import { z } from 'zod';
import { Branch, FeePlan, SchoolClass, Student, Invoice } from '../models/index.js';
import { auth, allow, route, problem, branchAllowed } from '../middleware/auth.js';
import { id, text } from '../config/validation.js';
import { audit } from '../services/audit.js';

export const router = Router();
router.use(auth, allow('SUPER_ADMIN', 'PRINCIPAL', 'ACCOUNTANT'));
const manager = allow('SUPER_ADMIN', 'ACCOUNTANT');
const amount = z.number().int().min(1).max(100000000);
const frequency = z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL']);
const scope = async user => user.role === 'SUPER_ADMIN' ? {} : { branchId: { $in: user.branchIds } };

router.get('/', route(async (req, res) => {
  res.json({ items: await FeePlan.find(await scope(req.user)).populate('branchId', 'name').sort({ name: 1 }) });
}));

router.post('/', manager, route(async (req, res) => {
  const data = z.object({
    branchId: id, name: text, category: text, frequency, amount,
    dueDay: z.number().int().min(1).max(28).optional(),
    classIds: z.array(id).default([]), studentIds: z.array(id).default([]),
    lateFeeType: z.enum(['NONE', 'FIXED', 'PERCENTAGE']).default('NONE'),
    lateFeeAmount: z.number().int().min(0).max(100000000).default(0),
    lateFeeGraceDays: z.number().int().min(0).max(90).default(0),
  }).parse(req.body);
  branchAllowed(req.user, data.branchId);
  if (!(await Branch.exists({ _id: data.branchId }))) throw problem(404, 'Branch not found');
  const item = await FeePlan.create(data);
  await audit(req.user, 'CREATE', 'FeePlan', item._id, item.branchId);
  res.status(201).json({ item });
}));

router.post('/:id/generate', manager, route(async (req, res) => {
  const data = z.object({ periodKey: z.string().min(4).max(30), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  const plan = await FeePlan.findById(id.parse(req.params.id));
  if (!plan) throw problem(404, 'Fee plan not found');
  branchAllowed(req.user, plan.branchId);
  if (!plan.active) throw problem(409, 'Fee plan is inactive');
  const filter = { branchId: plan.branchId, active: true };
  if (plan.studentIds.length) filter._id = { $in: plan.studentIds };
  else if (plan.classIds.length) filter.classId = { $in: plan.classIds };
  const students = await Student.find(filter).select('_id branchId');
  const created = [];
  for (const student of students) {
    const exists = await Invoice.findOne({ studentId: student._id, planId: plan._id, periodKey: data.periodKey });
    if (exists) continue;
    created.push(await Invoice.create({
      studentId: student._id, branchId: plan.branchId, planId: plan._id,
      periodKey: data.periodKey, title: `${plan.name} - ${data.periodKey}`,
      category: plan.category, amount: plan.amount, dueDate: data.dueDate,
      dues: [{ key: 'default', title: plan.name, amount: plan.amount, dueDate: data.dueDate }],
      lateFeeType: plan.lateFeeType, lateFeeAmount: plan.lateFeeAmount, lateFeeGraceDays: plan.lateFeeGraceDays,
    }));
  }
  await audit(req.user, 'GENERATE', 'FeePlan', plan._id, plan.branchId);
  res.status(201).json({ items: created, created: created.length, skipped: students.length - created.length });
}));
