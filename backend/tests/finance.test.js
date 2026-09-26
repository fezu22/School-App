import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { User, Branch, SchoolClass, Student, Invoice, Refund, CashClosing, FeePlan } from '../src/models/index.js';
let mongo, owner, cashier, parent, other, branch, foreignBranch, child, foreignChild;
const password = 'Test-finance-password-123';
const call = (token, method, path, body) => request(app)[method](path).set('Authorization', `Bearer ${token}`).send(body);
async function login(email) {
  const r = await request(app).post('/auth/login').send({ email, password });
  assert.equal(r.status, 200, r.text);
  return r.body.token;
}
before(async () => {
  process.env.JWT_SECRET = 'finance-test-secret-at-least-32-characters';
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('finance_test'));
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  [branch, foreignBranch] = await Branch.create([{ name: 'North' }, { name: 'South' }]);
  const [c1, c2] = await SchoolClass.create([
    { name: 'One', section: 'A', session: '2026', branchId: branch._id },
    { name: 'Two', section: 'A', session: '2026', branchId: foreignBranch._id },
  ]);
  [child, foreignChild] = await Student.create([
    { name: 'Child', admissionNumber: 'F-1', classId: c1._id, branchId: branch._id },
    { name: 'Other', admissionNumber: 'F-2', classId: c2._id, branchId: foreignBranch._id },
  ]);
  const hash = await bcrypt.hash(password, 4);
  await User.create([
    { name: 'Owner', email: 'owner@finance.test', passwordHash: hash, role: 'SUPER_ADMIN', mustChangePassword: false },
    { name: 'Cashier', email: 'cashier@finance.test', passwordHash: hash, role: 'ACCOUNTANT', branchIds: [branch._id], mustChangePassword: false },
    { name: 'Parent', email: 'parent@finance.test', passwordHash: hash, role: 'PARENT', studentIds: [child._id], mustChangePassword: false },
    { name: 'Other cashier', email: 'other@finance.test', passwordHash: hash, role: 'ACCOUNTANT', branchIds: [foreignBranch._id], mustChangePassword: false },
  ]);
  [owner, cashier, parent, other] = await Promise.all(['owner','cashier','parent','other'].map(name => login(`${name}@finance.test`)));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test('concession creates refundable credit, refund is idempotent, permissions and totals remain valid', async () => {
  let r = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Tuition', amount: 10000, dueDate: '2026-10-01' });
  assert.equal(r.status, 201, r.text);
  const invoiceId = r.body.item._id;
  r = await call(cashier, 'post', `/invoices/${invoiceId}/payments`, { amount: 10000, method: 'BANK', requestKey: 'finance-payment-0001' });
  assert.equal(r.status, 201, r.text);
  const paymentId = r.body.item._id;
  assert.equal((await call(cashier, 'put', `/invoices/${invoiceId}/concession`, { amount: 2000, reason: 'Scholarship' })).status, 403);
  r = await call(owner, 'put', `/invoices/${invoiceId}/concession`, { amount: 2000, reason: 'Scholarship' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.item.credit, 2000);
  const refund = { paymentId, amount: 2000, method: 'BANK', reason: 'Approved concession refund', requestKey: 'finance-refund-0001' };
  assert.equal((await call(parent, 'post', `/invoices/${invoiceId}/refunds`, refund)).status, 403);
  assert.equal((await call(other, 'get', '/invoices')).body.items.length, 0);
  assert.equal((await call(other, 'post', `/invoices/${invoiceId}/payments`, { amount: 1, method: 'BANK', requestKey: 'finance-payment-foreign' })).status, 403);
  assert.equal((await call(owner, 'post', `/invoices/${invoiceId}/refunds`, refund)).status, 201);
  assert.equal((await call(owner, 'post', `/invoices/${invoiceId}/refunds`, refund)).status, 200);
  assert.equal((await Refund.countDocuments({ invoiceId })), 1);
  assert.equal((await call(owner, 'post', `/invoices/${invoiceId}/refunds`, { ...refund, amount: 1 })).status, 409);
  r = await call(parent, 'get', '/invoices');
  assert.equal(r.body.items[0].discountAmount, 2000);
  assert.equal(r.body.items[0].paid, 8000);
  assert.equal(r.body.items[0].balance, 0);
  assert.equal(r.body.items[0].credit, 0);
  assert.equal(r.body.items[0].refunds.length, 1);
});
test('cash closing records variance, blocks same-day cash writes, and does not affect another branch', async () => {
  const create = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Activity', amount: 9000, dueDate: '2026-10-01' });
  const id = create.body.item._id;
  assert.equal((await call(cashier, 'post', `/invoices/${id}/payments`, { amount: 3000, method: 'CASH', requestKey: 'finance-payment-cash1' })).status, 201);
  let r = await call(cashier, 'post', '/invoices/cash-closings', { branchId: branch._id, countedAmount: 2900, varianceExplanation: 'Drawer short by 100 after count' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.item.expectedAmount, 3000);
  assert.equal(r.body.item.difference, -100);
  assert.equal((await call(cashier, 'post', '/invoices/cash-closings', { branchId: branch._id, countedAmount: 0 })).status, 409);
  assert.equal((await call(cashier, 'post', `/invoices/${id}/payments`, { amount: 1000, method: 'CASH', requestKey: 'finance-payment-cash2' })).status, 409);
  assert.equal((await call(cashier, 'post', `/invoices/${id}/payments`, { amount: 1000, method: 'BANK', requestKey: 'finance-payment-bank2' })).status, 201);
  assert.equal((await CashClosing.countDocuments({ branchId: branch._id })), 1);
  assert.equal((await call(other, 'get', '/invoices/cash-closings')).body.items.length, 0);
  assert.equal((await call(other, 'post', '/invoices/cash-closings', { branchId: branch._id, countedAmount: 0 })).status, 403);
  const south = await call(owner, 'post', '/invoices', { studentId: foreignChild._id, title: 'South fee', amount: 10000, dueDate: '2026-10-01' });
  assert.equal((await call(other, 'post', `/invoices/${south.body.item._id}/payments`, { amount: 1000, method: 'CASH', requestKey: 'finance-payment-south' })).status, 201);
});
test('fee plans generate period invoices once and expose printable voucher and receipt documents', async () => {
  let r = await call(owner, 'post', '/fee-plans', { branchId: branch._id, name: 'Monthly tuition', category: 'TUITION', frequency: 'MONTHLY', amount: 12000, dueDay: 10, studentIds: [child._id] });
  assert.equal(r.status, 201, r.text);
  const planId = r.body.item._id;
  r = await call(owner, 'post', `/fee-plans/${planId}/generate`, { periodKey: '2026-10', dueDate: '2026-10-10' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.created, 1);
  r = await call(owner, 'post', `/fee-plans/${planId}/generate`, { periodKey: '2026-10', dueDate: '2026-10-10' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.created, 0);
  const invoice = await Invoice.findOne({ planId, periodKey: '2026-10' });
  r = await call(cashier, 'get', `/invoices/${invoice._id}/voucher`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.document.kind, 'VOUCHER');
  r = await call(cashier, 'post', `/invoices/${invoice._id}/payments`, { amount: 12000, method: 'BANK', requestKey: 'finance-plan-payment-1' });
  assert.equal(r.status, 201, r.text);
  r = await call(parent, 'get', `/invoices/${invoice._id}/payments/${r.body.item._id}/receipt`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.document.kind, 'RECEIPT');
});
test('payments allocate to named dues, retain advance credit, isolate branches, and retry idempotently', async () => {
  let r = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Term one', amount: 5000, dueDate: '2026-11-01' });
  assert.equal(r.status, 201, r.text);
  const first = r.body.item;
  r = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Transport', amount: 3000, dueDate: '2026-11-01' });
  assert.equal(r.status, 201, r.text);
  const second = r.body.item;
  const allocations = [
    { invoiceId: first._id, dueKey: 'default', amount: 5000 },
    { invoiceId: second._id, dueKey: 'default', amount: 2000 },
  ];
  r = await call(cashier, 'post', `/invoices/${first._id}/payments`, { amount: 8000, method: 'BANK', requestKey: 'finance-allocation-0001', allocations });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.item.advanceAmount, 1000);
  r = await call(cashier, 'post', `/invoices/${first._id}/payments`, { amount: 8000, method: 'BANK', requestKey: 'finance-allocation-0001', allocations });
  assert.equal(r.status, 200, r.text);
  r = await call(parent, 'get', '/invoices');
  const firstView = r.body.items.find(item => item._id === first._id);
  const secondView = r.body.items.find(item => item._id === second._id);
  assert.equal(firstView.outstandingBalance, 0);
  assert.equal(secondView.outstandingBalance, 1000);
  assert.equal(firstView.advanceCredit, 1000);
  const foreign = await call(owner, 'post', '/invoices', { studentId: foreignChild._id, title: 'Foreign', amount: 1000, dueDate: '2026-11-01' });
  assert.equal((await call(cashier, 'post', `/invoices/${first._id}/payments`, { amount: 1, method: 'BANK', requestKey: 'finance-allocation-foreign', allocations: [{ invoiceId: foreign.body.item._id, dueKey: 'default', amount: 1 }] })).status, 403);
});
test('advance can be used once, late fees apply after grace, and approved scholarship/sibling discounts affect balances', async () => {
  let r = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Advance target', amount: 4000, dueDate: '2026-12-01' });
  const advanceTarget = r.body.item;
  r = await call(cashier, 'post', `/invoices/${advanceTarget._id}/payments`, { amount: 1500, method: 'BANK', requestKey: 'finance-advance-create', allocations: [] });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.item.advanceAmount, 1500);
  r = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Advance use', amount: 3000, dueDate: '2026-12-01' });
  const advanceUse = r.body.item;
  r = await call(cashier, 'post', `/invoices/${advanceUse._id}/payments`, { amount: 500, advanceUsed: 1000, method: 'BANK', requestKey: 'finance-advance-use', allocations: [{ invoiceId: advanceUse._id, dueKey: 'default', amount: 1500 }] });
  assert.equal(r.status, 201, r.text);
  r = await call(parent, 'get', '/invoices');
  assert.equal(r.body.items.find(item => item._id === advanceUse._id).outstandingBalance, 1500);
  assert.equal(r.body.items.find(item => item._id === advanceUse._id).advanceCredit, 2500);
  const feePlan = await call(owner, 'post', '/fee-plans', { branchId: branch._id, name: 'Late fee plan', category: 'MONTHLY', frequency: 'MONTHLY', amount: 1000, lateFeeType: 'FIXED', lateFeeAmount: 100, lateFeeGraceDays: 0, studentIds: [child._id] });
  r = await call(owner, 'post', `/fee-plans/${feePlan.body.item._id}/generate`, { periodKey: '2020-01', dueDate: '2020-01-01' });
  const late = (await call(parent, 'get', '/invoices')).body.items.find(item => item.periodKey === '2020-01');
  assert.equal(late.lateFee, 100);
  assert.equal(late.outstandingBalance, 1100);
  const sibling = await Student.create({ name: 'Sibling', admissionNumber: 'F-SIB', classId: child.classId, branchId: branch._id, guardianName: 'Shared Guardian' });
  await Student.updateOne({ _id: child._id }, { guardianName: 'Shared Guardian' });
  r = await call(owner, 'post', '/invoices', { studentId: sibling._id, title: 'Sibling invoice', amount: 1000, dueDate: '2026-12-01' });
  r = await call(owner, 'put', `/invoices/${r.body.item._id}/sibling-discount`, { percent: 10, reason: 'Sibling policy' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.item.discountKind, 'SIBLING');
  r = await call(owner, 'post', '/invoices', { studentId: child._id, title: 'Scholarship invoice', amount: 1000, dueDate: '2026-12-01' });
  r = await call(owner, 'put', `/invoices/${r.body.item._id}/scholarship`, { amount: 250, reason: 'Need-based scholarship' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.item.discountKind, 'SCHOLARSHIP');
});
test('cash workflow records opening, expenses, transfers, approval and handover with immutable audit refs', async () => {
  let r = await call(owner, 'post', '/invoices', { studentId: foreignChild._id, title: 'Cash workflow fee', amount: 10000, dueDate: '2026-12-01' });
  const invoiceId = r.body.item._id;
  r = await call(other, 'post', `/invoices/${invoiceId}/payments`, { amount: 3000, method: 'CASH', requestKey: 'finance-handover-payment' });
  assert.equal(r.status, 201, r.text);
  r = await call(other, 'post', '/invoices/cash-entries', { branchId: foreignBranch._id, kind: 'OPENING', amount: 5000, description: 'Opening drawer', requestKey: 'finance-opening-001' });
  assert.equal(r.status, 201, r.text); assert.ok(r.body.auditRef);
  r = await call(other, 'post', '/invoices/cash-entries', { branchId: foreignBranch._id, kind: 'EXPENSE', amount: 500, description: 'Stationery', requestKey: 'finance-expense-001' });
  assert.equal(r.status, 201, r.text);
  r = await call(other, 'post', '/invoices/cash-entries', { branchId: foreignBranch._id, kind: 'TRANSFER_IN', amount: 1000, description: 'Float transfer', transferReference: 'TR-IN-1', requestKey: 'finance-transfer-in-001' });
  assert.equal(r.status, 201, r.text);
  r = await call(other, 'post', '/invoices/cash-entries', { branchId: foreignBranch._id, kind: 'TRANSFER_OUT', amount: 200, description: 'Bank deposit', transferReference: 'TR-OUT-1', requestKey: 'finance-transfer-out-001' });
  assert.equal(r.status, 201, r.text);
  assert.equal((await call(cashier, 'post', '/invoices/cash-entries', { branchId: foreignBranch._id, kind: 'EXPENSE', amount: 10, description: 'Wrong branch', requestKey: 'finance-wrong-branch-1' })).status, 403);
  r = await call(other, 'post', '/invoices/cash-closings', { branchId: foreignBranch._id, countedAmount: 9200, varianceExplanation: 'Documented drawer variance' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.item.expectedAmount, 9300);
  assert.equal(r.body.item.difference, -100);
  assert.ok(r.body.item.auditRef);
  assert.equal((await call(other, 'post', '/invoices/cash-entries', { branchId: foreignBranch._id, kind: 'EXPENSE', amount: 10, description: 'After close', requestKey: 'finance-after-close-1' })).status, 409);
  assert.equal((await call(other, 'post', '/invoices/cash-closings', { branchId: foreignBranch._id, countedAmount: 9200, varianceExplanation: 'Duplicate' })).status, 409);
  const closingId = r.body.item._id;
  assert.equal((await call(other, 'post', `/invoices/cash-closings/${closingId}/approve`, {})).status, 403);
  r = await call(owner, 'post', `/invoices/cash-closings/${closingId}/approve`, {});
  assert.equal(r.status, 200, r.text); assert.ok(r.body.item.approvalAuditRef);
  assert.equal((await call(owner, 'post', `/invoices/cash-closings/${closingId}/approve`, {})).status, 409);
  const recipient = await User.findOne({ email: 'other@finance.test' });
  r = await call(owner, 'post', `/invoices/cash-closings/${closingId}/handover`, { recipientId: recipient._id, note: 'Handover recorded' });
  assert.equal(r.status, 200, r.text); assert.ok(r.body.item.handoverAuditRef);
  assert.equal((await call(owner, 'post', `/invoices/cash-closings/${closingId}/handover`, { recipientId: recipient._id, note: 'Duplicate handover' })).status, 409);
});
