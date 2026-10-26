const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retryPlan, BACKOFF_MS, MAX_ATTEMPTS } = require('./parentPaymentReconciler');

test('reconciliation uses bounded increasing retry delays', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  assert.equal(retryPlan(1, now).nextAt.getTime(), now.getTime() + BACKOFF_MS[0]);
  assert.equal(retryPlan(2, now).nextAt.getTime(), now.getTime() + BACKOFF_MS[1]);
  const exhausted = retryPlan(MAX_ATTEMPTS, now);
  assert.equal(exhausted.nextAt, null);
  assert.equal(exhausted.exhaustedAt.getTime(), now.getTime());
});
