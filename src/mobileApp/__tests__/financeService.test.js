jest.mock('../shared/services/apiConfig', () => ({
  API_ROOT: 'http://school.test/api',
}));
jest.mock('../shared/services/authRequest', () => ({ authRequest: jest.fn() }));

import { authRequest } from '../shared/services/authRequest';
import { financeApi } from '../roles/finance/financeService';

beforeEach(() => {
  authRequest.mockReset();
  authRequest.mockResolvedValue({ success: true, data: [] });
});

test('pending payments use one query delimiter and encode every supported filter', async () => {
  await financeApi.getPendingPayments({
    studentId: 'STU/002 & sibling',
    from: '2026-09-01',
    to: '2026-09-30',
    method: 'bank_transfer',
    q: 'ignored',
  });

  expect(authRequest).toHaveBeenCalledWith(
    '/finance/payments?status=pending_verification&studentId=STU%2F002+%26+sibling&from=2026-09-01&to=2026-09-30&method=bank_transfer',
    {},
    true,
    true,
  );
  expect(authRequest.mock.calls[0][0].match(/\?/g)).toHaveLength(1);
});

test('confirmed payment history uses the same encoded filter contract', async () => {
  await financeApi.getPaymentHistory({
    studentId: '002',
    from: '2026-10-01',
    to: '2026-10-07',
    method: 'easypaisa',
  });

  expect(authRequest).toHaveBeenCalledWith(
    '/finance/payments?status=confirmed&studentId=002&from=2026-10-01&to=2026-10-07&method=easypaisa',
    {},
    true,
    true,
  );
  expect(authRequest.mock.calls[0][0].match(/\?/g)).toHaveLength(1);
});

test('manual payment entry sends its stable idempotency key with the payload', async () => {
  const payment = {
    invoiceId: 'INV-002',
    amount: 1250,
    method: 'cash',
    reference: 'CASH-9',
  };
  await financeApi.enterPayment(payment, 'finance-retry-key-001');

  expect(authRequest).toHaveBeenCalledWith(
    '/finance/payments',
    {
      method: 'POST',
      headers: { 'Idempotency-Key': 'finance-retry-key-001' },
      body: JSON.stringify(payment),
    },
    true,
    true,
  );
});

test('payment queries omit empty filters without adding another delimiter', async () => {
  await financeApi.getPendingPayments({});
  await financeApi.getPaymentHistory();

  expect(authRequest.mock.calls.map(call => call[0])).toEqual([
    '/finance/payments?status=pending_verification',
    '/finance/payments?status=confirmed',
  ]);
});

test('Parent payment reconciliation uses the branch-scoped Finance API', async () => {
  await financeApi.getParentPaymentReconciliation();

  expect(authRequest).toHaveBeenCalledWith(
    '/finance/reconciliation/parent-payments',
    {},
    true,
    true,
  );
});

test('extra charge APIs use the branch protected Finance workspace endpoints', async () => {
  await financeApi.getExtraCharges();
  await financeApi.createExtraCharge({ title: 'Exam fee' });
  await financeApi.applyExtraCharge('charge/one');

  expect(authRequest.mock.calls.map(call => call[0])).toEqual([
    '/finance/extra-charges',
    '/finance/extra-charges',
    '/finance/extra-charges/charge%2Fone/apply',
  ]);
  expect(authRequest.mock.calls[1][1]).toEqual({
    method: 'POST',
    body: JSON.stringify({ title: 'Exam fee' }),
  });
});

test('expense list and JSON expense records use authenticated APIs', async () => {
  await financeApi.getExpenses();
  await financeApi.createExpense({ title: 'Electric bill', amount: 500 });

  expect(authRequest.mock.calls[0][0]).toBe('/finance/expenses');
  expect(authRequest.mock.calls[1]).toEqual([
    '/finance/expenses',
    {
      method: 'POST',
      body: JSON.stringify({ title: 'Electric bill', amount: 500 }),
    },
    true,
    true,
  ]);
});

test('finance workspace and monthly reports are loaded through protected endpoints', async () => {
  await financeApi.getWorkspace();
  await financeApi.getMonthlyReport();
  expect(authRequest.mock.calls.map(call => call[0])).toEqual([
    '/finance/workspace',
    '/finance/reports/monthly',
  ]);
  expect(
    authRequest.mock.calls.every(call => call[2] === true && call[3] === true),
  ).toBe(true);
});
