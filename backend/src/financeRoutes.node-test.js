const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const databasePath = require.resolve('./database');
const schoolObjectId = new ObjectId();
const branchObjectId = new ObjectId();
const branchRecord = { _id: branchObjectId };
Object.defineProperty(branchRecord, 'schoolId', { value: schoolObjectId, enumerable: false });
let currentFinanceIdentity = {
  _id: new ObjectId(),
  id: 'finance-a',
  role: 'finance',
  schoolId: schoolObjectId.toHexString(),
  branchId: branchObjectId.toHexString(),
};
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    getDatabase: () => ({
      collection: name => ({
        find: query => ({
          limit: count => ({
            toArray: async () => (name === 'users' && query.$or.some(item => item.id === 'finance-a') ? [currentFinanceIdentity] : []).slice(0, count),
          }),
        }),
        findOne: async query => {
          if (name === 'schools') {
            return String(query._id) === String(schoolObjectId)
              ? { _id: schoolObjectId, isActive: true, status: 'active' }
              : null;
          }
          return name === 'branches' && String(query._id) === String(branchObjectId)
            ? branchRecord
            : null;
        },
      }),
    }),
  },
};
const { __test } = require('./routes');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('Finance context requires persisted Finance identity and a resolvable branch', async () => {
  for (const [user, expected] of [
    [{ id: 'finance-a', role: 'finance', branchId: branchObjectId.toHexString() }, 200],
    [{ id: 'finance-a', role: 'student', branchId: branchObjectId.toHexString() }, 403],
    [{ id: 'finance-a', role: 'finance' }, 403],
    [null, 401],
  ]) {
    const req = { user };
    const res = responseRecorder();
    let passed = false;
    await new Promise((resolve, reject) => {
      const originalJson = res.json.bind(res);
      res.json = body => {
        originalJson(body);
        resolve();
        return res;
      };
      __test.requireFinanceContext(req, res, error => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (res.statusCode === 200) {
      passed = true;
    }
    assert.equal(passed, expected === 200);
    assert.equal(res.statusCode, expected);
    if (passed) {
      assert.deepEqual(req.financeContext, {
        userId: 'finance-a',
        branchId: branchObjectId.toHexString(),
        branch: { _id: branchObjectId },
        branchValues: [branchObjectId, branchObjectId.toHexString()],
        branchFilter: { $in: [branchObjectId, branchObjectId.toHexString()] },
      });
    }
  }

  // Missing schoolId on finance user fails closed with 503
  currentFinanceIdentity = { ...currentFinanceIdentity, schoolId: undefined };
  const reqMissingSchool = { user: { id: 'finance-a', role: 'finance', branchId: branchObjectId.toHexString() } };
  const resMissingSchool = responseRecorder();
  const missingSchoolErr = await new Promise(resolve => {
    const originalJson = resMissingSchool.json.bind(resMissingSchool);
    resMissingSchool.json = body => { originalJson(body); resolve(null); return resMissingSchool; };
    __test.requireFinanceContext(reqMissingSchool, resMissingSchool, err => resolve(err || null));
  });
  assert.equal(missingSchoolErr?.statusCode || resMissingSchool.statusCode, 503);
  currentFinanceIdentity = { ...currentFinanceIdentity, schoolId: schoolObjectId.toHexString() };
});


test('Finance list filters reject invalid dates, methods, and oversized student IDs', () => {
  assert.match(__test.financeListFilters({ from: 'bad' }).error, /YYYY-MM-DD/);
  assert.match(__test.financeListFilters({ method: 'crypto' }).error, /method must/);
  assert.match(__test.financeListFilters({ studentId: 'x'.repeat(121) }).error, /too long/);
  assert.equal(__test.financeListFilters({ method: 'easypaisa' }).method, 'easypaisa');
});

test('payment history filters retain branch, status, student, dates, and method', () => {
  const filters = __test.financeListFilters({
    studentId: 'STU 002',
    from: '2026-09-01',
    to: '2026-09-30',
    method: 'bank_transfer',
  });
  const pending = __test.financePaymentMatch(
    'branch-a',
    'pending_verification',
    filters,
  );
  assert.deepEqual(pending.branchId, { $in: ['branch-a'] });
  assert.equal(pending.status, 'pending_verification');
  assert.equal(pending.studentId, 'STU 002');
  assert.equal(pending.method, 'bank_transfer');
  assert.deepEqual(pending.createdAt, filters.range.filter);
  assert.equal(pending.confirmedAt, undefined);

  const confirmed = __test.financePaymentMatch(
    'branch-b',
    'confirmed',
    filters,
  );
  assert.deepEqual(confirmed.branchId, { $in: ['branch-b'] });
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.confirmedAt, filters.range.filter);
  assert.equal(confirmed.createdAt, undefined);
});

test('traceable non-cash payment methods require a transaction reference', () => {
  for (const method of ['bank_transfer', 'card', 'easypaisa', 'cheque']) {
    assert.equal(__test.requiresPaymentReference(method), true);
  }
  assert.equal(__test.requiresPaymentReference('cash'), false);
  assert.equal(__test.requiresPaymentReference('other'), false);
});

test('rejecting a partial payment releases only that pending reservation', () => {
  assert.deepEqual(__test.rejectedInvoiceState(
    1000,
    { paidAmount: 300, pendingAmount: 350 },
    200,
  ), {
    paidAmount: 300,
    pendingPaymentAmount: 150,
    balanceDue: 700,
    status: 'partially_paid',
    paymentStatus: 'partial',
    availableBalance: 550,
  });
});

test('invoice status filters and reads expose the canonical partial status', () => {
  assert.equal(__test.isFinanceInvoiceStatus('partially_paid'), true);
  assert.equal(__test.isFinanceInvoiceStatus('partial'), false);
  assert.deepEqual(__test.financeInvoiceStatusMatch('partially_paid'), {
    status: { $in: ['partially_paid', 'partial'] },
  });
  assert.deepEqual(__test.financeInvoiceStatusMatch('paid'), { status: 'paid' });
  assert.deepEqual(
    __test.normalizeInvoiceStatuses([
      { id: 'INV-1', status: 'partial', amount: 100 },
      { id: 'INV-2', status: 'partially_paid', amount: 100 },
      { id: 'INV-3', amount: 100 },
    ]),
    [
      { id: 'INV-1', status: 'partially_paid', amount: 100 },
      { id: 'INV-2', status: 'partially_paid', amount: 100 },
      { id: 'INV-3', amount: 100 },
    ],
  );
  assert.equal(__test.normalizeInvoiceStatus('partial'), 'partially_paid');
  assert.equal(__test.normalizeInvoiceStatus('due'), 'due');
});

test('payment indexes protect idempotency per actor and references per branch', async () => {
  const calls = [];
  const payments = {
    createIndex: async (keys, options) => {
      calls.push({ keys, options });
      return options.name;
    },
  };
  await __test.ensurePaymentIdempotencyIndex(payments);
  await __test.ensurePaymentReferenceIndex(payments);
  assert.deepEqual(calls[0].keys, {
    branchId: 1,
    createdByUserId: 1,
    idempotencyKey: 1,
  });
  assert.equal(calls[0].options.unique, true);
  assert.deepEqual(calls[1].keys, { branchId: 1, reference: 1 });
  assert.equal(calls[1].options.unique, true);
});
