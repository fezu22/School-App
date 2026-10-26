const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('./financePayrollRoutes');

test('payroll amounts accept finite non-negative money only', () => {
  assert.equal(__test.money('1250.555'), 1250.56);
  assert.equal(__test.money(0), 0);
  assert.equal(__test.money(-1), null);
  assert.equal(__test.money('not-money'), null);
});
