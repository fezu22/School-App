import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { User, Branch, SchoolClass, Student, Invoice, Refund, CashClosing } from '../src/models/index.js';
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
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, args: ['--nounixsocket'] } });
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
  let r = await call(cashier, 'post', '/invoices/cash-closings', { branchId: branch._id, countedAmount: 2900 });
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
