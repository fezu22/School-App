const crypto = require('node:crypto');
const { getDatabase } = require('./database');
const paymentFlow = require('./parentPaymentRoutes').__reconciliation;

const RECONCILABLE_STATUSES = ['initiated', 'pending', 'reconciliation_required'];
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
const LEASE_MS = 45_000;
const POLL_INTERVAL_MS = 15_000;
const MAX_PER_TICK = 10;

function retryPlan(attempt, now = new Date(), backoff = BACKOFF_MS, maxAttempts = MAX_ATTEMPTS) {
  if (attempt >= maxAttempts) return { exhaustedAt: new Date(now), nextAt: null };
  const delay = backoff[Math.max(0, Math.min(attempt - 1, backoff.length - 1))];
  return { exhaustedAt: null, nextAt: new Date(now.getTime() + delay) };
}

async function claimNextReconciliation(db, workerId, now = new Date(), leaseMs = LEASE_MS, maxAttempts = MAX_ATTEMPTS) {
  return db.collection('parentOnlinePayments').findOneAndUpdate(
    {
      activeKey: 'active',
      status: { $in: RECONCILABLE_STATUSES },
      $and: [
        { $or: [{ reconciliationNextAt: { $exists: false } }, { reconciliationNextAt: { $lte: now } }] },
        { $or: [{ workerLeaseExpiresAt: { $exists: false } }, { workerLeaseExpiresAt: { $lte: now } }] },
        { $or: [{ reconciliationAttempts: { $exists: false } }, { reconciliationAttempts: { $lt: maxAttempts } }] },
      ],
    },
    {
      $set: { workerLeaseId: workerId, workerLeaseExpiresAt: new Date(now.getTime() + leaseMs), reconciliationLastAttemptAt: now },
      $inc: { reconciliationAttempts: 1 },
    },
    { sort: { reconciliationNextAt: 1, createdAt: 1 }, returnDocument: 'after' },
  );
}

async function recordUnresolved(db, payment, workerId, reason, now = new Date(), backoff = BACKOFF_MS, maxAttempts = MAX_ATTEMPTS, details = {}) {
  const plan = retryPlan(Number(payment.reconciliationAttempts || 1), now, backoff, maxAttempts);
  const update = {
    $set: {
      status: 'reconciliation_required',
      reconciliationReason: reason,
      lastCheckedAt: now,
      ...(details.merchantStatus ? { merchantStatus: details.merchantStatus } : {}),
      ...(plan.nextAt ? { reconciliationNextAt: plan.nextAt } : { reconciliationExhaustedAt: plan.exhaustedAt }),
    },
    $unset: { workerLeaseId: '', workerLeaseExpiresAt: '' },
  };
  if (!plan.nextAt) update.$unset.reconciliationNextAt = '';
  const result = await db.collection('parentOnlinePayments').updateOne(
    { _id: payment._id, workerLeaseId: workerId, activeKey: 'active', status: { $in: RECONCILABLE_STATUSES } },
    update,
  );
  return { matched: result.matchedCount === 1, ...plan };
}

async function processClaimedPayment({ db, payment, workerId, config, now = () => new Date(), fetchStatus = paymentFlow.fetchVerifiedMerchantStatus, settle = paymentFlow.confirmPayment, backoff = BACKOFF_MS, maxAttempts = MAX_ATTEMPTS }) {
  try {
    const verified = await fetchStatus(payment, config);
    if (verified.confirmed) {
      let current = await db.collection('parentOnlinePayments').findOne({
        _id: payment._id, workerLeaseId: workerId, activeKey: 'active',
      });
      if (!current) return 'lease_lost';
      if (!current.providerTransactionId) {
        const updated = await db.collection('parentOnlinePayments').updateOne(
          { _id: current._id, workerLeaseId: workerId, activeKey: 'active' },
          { $set: { providerTransactionId: verified.transactionId } },
        );
        if (updated.modifiedCount !== 1) return 'lease_lost';
        current = { ...current, providerTransactionId: verified.transactionId };
      }
      const settled = await settle(current, verified);
      if (settled?.status === 'reconciliation_required') {
        const result = await recordUnresolved(db, { ...payment, ...settled }, workerId, settled.reconciliationReason || 'settlement_requires_reconciliation', now(), backoff, maxAttempts, { merchantStatus: verified.status });
        return result.matched ? (result.nextAt ? 'reconciliation_required' : 'exhausted') : 'lease_lost';
      }
      return settled?.status === 'confirmed' ? 'confirmed' : 'unchanged';
    }

    if (verified.failed) {
      const result = await db.collection('parentOnlinePayments').updateOne(
        { _id: payment._id, workerLeaseId: workerId, activeKey: 'active', status: { $in: RECONCILABLE_STATUSES } },
        {
          $set: { status: 'failed', merchantStatus: verified.status, lastCheckedAt: now(), terminalFailureVerifiedAt: now() },
          $unset: { activeKey: '', workerLeaseId: '', workerLeaseExpiresAt: '', reconciliationNextAt: '', reconciliationExhaustedAt: '' },
        },
      );
      return result.modifiedCount === 1 ? 'failed' : 'lease_lost';
    }

    const result = await recordUnresolved(db, payment, workerId, 'merchant_status_non_terminal', now(), backoff, maxAttempts, { merchantStatus: verified.status });
    return result.matched ? (result.nextAt ? 'retry_scheduled' : 'exhausted') : 'lease_lost';
  } catch (error) {
    const reason = error?.name === 'AbortError' || error?.name === 'TimeoutError'
      ? 'merchant_status_timeout'
      : 'merchant_status_unavailable_or_invalid';
    const result = await recordUnresolved(db, payment, workerId, reason, now(), backoff, maxAttempts);
    return result.matched ? (result.nextAt ? 'retry_scheduled' : 'exhausted') : 'lease_lost';
  }
}

async function reconcileBatch({ db = getDatabase(), config = paymentFlow.gatewayConfiguration(), workerId = crypto.randomUUID(), limit = MAX_PER_TICK, now = () => new Date(), fetchStatus, settle, backoff = BACKOFF_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!config.enabled) return { disabled: true, processed: 0 };
  await paymentFlow.ensurePaymentIndexes(db);
  const counts = { disabled: false, processed: 0, confirmed: 0, failed: 0, retryScheduled: 0, exhausted: 0, leaseLost: 0 };
  for (let i = 0; i < limit; i += 1) {
    const leaseId = `${workerId}:${crypto.randomUUID()}`;
    const payment = await claimNextReconciliation(db, leaseId, now(), LEASE_MS, maxAttempts);
    if (!payment) break;
    const outcome = await processClaimedPayment({ db, payment, workerId: leaseId, config, now, fetchStatus, settle, backoff, maxAttempts });
    counts.processed += 1;
    if (outcome === 'confirmed') counts.confirmed += 1;
    else if (outcome === 'failed') counts.failed += 1;
    else if (outcome === 'retry_scheduled' || outcome === 'reconciliation_required') counts.retryScheduled += 1;
    else if (outcome === 'exhausted') counts.exhausted += 1;
    else if (outcome === 'lease_lost') counts.leaseLost += 1;
  }
  return counts;
}

function startParentPaymentReconciler({ intervalMs = POLL_INTERVAL_MS, limit = MAX_PER_TICK } = {}) {
  const config = paymentFlow.gatewayConfiguration();
  if (!config.enabled) return { enabled: false, stop() {} };
  let stopped = false;
  let running = false;
  const workerId = crypto.randomUUID();
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await reconcileBatch({ config, workerId, limit });
    } catch (error) {
      console.error(`Parent payment reconciliation tick failed (${error.name}).`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
  return {
    enabled: true,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  RECONCILABLE_STATUSES,
  BACKOFF_MS,
  MAX_ATTEMPTS,
  LEASE_MS,
  retryPlan,
  claimNextReconciliation,
  recordUnresolved,
  processClaimedPayment,
  reconcileBatch,
  startParentPaymentReconciler,
};
