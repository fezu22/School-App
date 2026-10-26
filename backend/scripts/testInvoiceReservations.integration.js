// Explicit opt-in integration test. Uses a uniquely named temporary database,
// exercises real MongoDB transactions, and drops only that temporary database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { ObjectId } = require('mongodb');
const database = require('../src/database');
const {
  availableInvoiceCents,
  invoiceReservedCents,
  lockInvoice,
} = require('../src/invoiceReservations');
const { confirmPayment } = require('../src/parentPaymentRoutes').__test;
const {
  claimNextReconciliation,
  processClaimedPayment,
  MAX_ATTEMPTS,
  LEASE_MS,
} = require('../src/parentPaymentReconciler');

const configuredDatabaseName = String(process.env.MONGODB_DB || '').trim();
const isolatedDatabaseName = `codex_invres_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const report = { isolated: true, transactions: false, scenarios: {} };
let connected = false;
let stage = 'configuration';
let branchId;

async function inTransaction(client, callback) {
  const session = client.startSession();
  try {
    return await session.withTransaction(
      () => callback(session),
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
    );
  } finally {
    await session.endSession();
  }
}

async function seedInvoice(db, id, amount) {
  const invoice = {
    id, studentId: 'S-1', branchId, currency: 'PKR', amount,
    paymentReservationVersion: 0,
  };
  await db.collection('invoices').insertOne(invoice);
  return invoice;
}

async function reserveParent(db, client, invoiceId, parentUserId) {
  return inTransaction(client, async session => {
    let invoice = await db.collection('invoices').findOne({ id: invoiceId }, { session });
    invoice = await lockInvoice(db.collection('invoices'), invoice, session);
    const totals = await invoiceReservedCents(db, invoice, session);
    const amountCents = availableInvoiceCents(invoice, totals);
    if (!amountCents) throw Object.assign(new Error('No unreserved invoice balance.'), { code: 'NO_BALANCE' });
    const payment = {
      parentUserId,
      studentId: invoice.studentId,
      invoiceId,
      branchId: invoice.branchId,
      amount: amountCents / 100,
      currency: invoice.currency,
      method: 'easypaisa',
      provider: 'easypaisa',
      orderRef: `TEST-${invoiceId}-${parentUserId}`,
      idempotencyKey: `test-${invoiceId}-${parentUserId}`,
      requestHash: 'isolated-fixture',
      status: 'pending',
      activeKey: 'active',
      createdAt: new Date(),
    };
    const inserted = await db.collection('parentOnlinePayments').insertOne(payment, { session });
    return { ...payment, _id: inserted.insertedId };
  });
}

async function run() {
  assert.ok(process.env.MONGODB_URI && configuredDatabaseName, 'Configured Mongo settings are required.');
  assert.notEqual(isolatedDatabaseName, configuredDatabaseName);
  stage = 'connect isolated database';
  await database.connectDatabase({ MONGODB_URI: process.env.MONGODB_URI, MONGODB_DB: isolatedDatabaseName });
  connected = true;
  const db = database.getDatabase();
  const client = database.getClient();
  const hello = await db.admin().command({ hello: 1 });
  assert.ok(hello.setName || hello.msg === 'isdbgrid', 'MongoDB endpoint does not support multi-document transactions.');
  report.transactions = true;

  stage = 'prepare isolated fixture collections';
  for (const name of ['invoices', 'payments', 'parentOnlinePayments', 'users', 'students', 'branches', 'parentChildLinks', 'financeAuditLogs']) {
    await db.createCollection(name);
  }
  branchId = new ObjectId();
  await db.collection('branches').insertOne({ _id: branchId, id: branchId.toHexString(), name: 'isolated-fixture' });
  await db.collection('users').insertOne({ id: 'P-1', role: 'parent', branchId });
  await db.collection('students').insertOne({ id: 'S-1', branchId });
  await db.collection('parentChildLinks').insertOne({
    parentUserId: 'P-1', studentId: 'S-1', revokedAt: null, status: 'verified',
  });

  stage = 'concurrent Parent checkout reservations';
  const concurrentInvoice = await seedInvoice(db, 'INV-PARALLEL', 100);
  const parentAttempts = await Promise.allSettled([
    reserveParent(db, client, concurrentInvoice.id, 'P-A'),
    reserveParent(db, client, concurrentInvoice.id, 'P-B'),
  ]);
  const concurrentRows = await db.collection('parentOnlinePayments')
    .find({ invoiceId: concurrentInvoice.id, activeKey: 'active' }).toArray();
  const reservedCents = concurrentRows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
  assert.equal(parentAttempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(parentAttempts.filter(item => item.status === 'rejected' && item.reason.code === 'NO_BALANCE').length, 1);
  assert.equal(reservedCents, 10000);
  report.scenarios.concurrentParents = 'pass: one reservation, no overbooking';
  await db.collection('parentOnlinePayments').updateMany(
    { invoiceId: concurrentInvoice.id, activeKey: 'active' },
    { $set: { status: 'failed' }, $unset: { activeKey: '' } },
  );

  stage = 'Parent and Finance overlap';
  const overlapInvoice = await seedInvoice(db, 'INV-OVERLAP', 100);
  await inTransaction(client, async session => {
    let invoice = await db.collection('invoices').findOne({ id: overlapInvoice.id }, { session });
    invoice = await lockInvoice(db.collection('invoices'), invoice, session);
    assert.ok(availableInvoiceCents(invoice, await invoiceReservedCents(db, invoice, session)) >= 7000);
    await db.collection('payments').insertOne({
      invoiceId: invoice.id, studentId: invoice.studentId, branchId: invoice.branchId,
      amount: 70, currency: 'PKR', status: 'pending_verification', createdByUserId: 'F-1',
    }, { session });
  });
  const parentOverlap = await reserveParent(db, client, overlapInvoice.id, 'P-OVERLAP');
  assert.equal(parentOverlap.amount, 30);
  let financeDenied = false;
  try {
    await inTransaction(client, async session => {
      let invoice = await db.collection('invoices').findOne({ id: overlapInvoice.id }, { session });
      invoice = await lockInvoice(db.collection('invoices'), invoice, session);
      const available = availableInvoiceCents(invoice, await invoiceReservedCents(db, invoice, session));
      if (available < 100) throw Object.assign(new Error('No available invoice balance.'), { code: 'NO_BALANCE' });
    });
  } catch (error) { financeDenied = error.code === 'NO_BALANCE'; }
  assert.ok(financeDenied);
  report.scenarios.parentFinanceOverlap = 'pass: Parent held 30 after Finance pending 70; Finance over-reservation denied';
  await db.collection('parentOnlinePayments').updateOne(
    { _id: parentOverlap._id }, { $set: { status: 'failed' }, $unset: { activeKey: '' } },
  );

  stage = 'authoritative cancellation release';
  const cancellationInvoice = await seedInvoice(db, 'INV-CANCEL', 50);
  const cancelled = await reserveParent(db, client, cancellationInvoice.id, 'P-CANCEL');
  await db.collection('parentOnlinePayments').updateOne(
    { _id: cancelled._id, status: 'pending' },
    { $set: { status: 'failed', merchantStatus: 'DECLINED' }, $unset: { activeKey: '' } },
  );
  const replacement = await reserveParent(db, client, cancellationInvoice.id, 'P-RETRY');
  assert.equal(replacement.amount, 50);
  report.scenarios.cancellation = 'pass: authoritative terminal failure released the hold';
  await db.collection('parentOnlinePayments').updateOne(
    { _id: replacement._id }, { $set: { status: 'failed' }, $unset: { activeKey: '' } },
  );

  stage = 'merchant timeout hold';
  const timeoutInvoice = await seedInvoice(db, 'INV-TIMEOUT', 60);
  const timedOut = await reserveParent(db, client, timeoutInvoice.id, 'P-TIMEOUT');
  await db.collection('parentOnlinePayments').updateOne(
    { _id: timedOut._id, status: 'pending' },
    { $set: { status: 'reconciliation_required', reconciliationReason: 'merchant_checkout_outcome_unknown' } },
  );
  let secondCheckoutDenied = false;
  try { await reserveParent(db, client, timeoutInvoice.id, 'P-SECOND'); }
  catch (error) { secondCheckoutDenied = error.code === 'NO_BALANCE'; }
  assert.ok(secondCheckoutDenied);
  assert.equal((await db.collection('parentOnlinePayments').findOne({ _id: timedOut._id })).activeKey, 'active');
  const timeoutWorkerId = 'worker-timeout-fixture';
  const timeoutClaim = await claimNextReconciliation(db, timeoutWorkerId, new Date());
  assert.equal(String(timeoutClaim._id), String(timedOut._id));
  const timeoutOutcome = await processClaimedPayment({
    db, payment: timeoutClaim, workerId: timeoutWorkerId, config: { enabled: true },
    fetchStatus: async () => { throw Object.assign(new Error('isolated timeout'), { name: 'TimeoutError' }); },
  });
  const timeoutAfterPoll = await db.collection('parentOnlinePayments').findOne({ _id: timedOut._id });
  assert.equal(timeoutOutcome, 'retry_scheduled');
  assert.equal(timeoutAfterPoll.activeKey, 'active');
  assert.equal(timeoutAfterPoll.reconciliationReason, 'merchant_status_timeout');
  assert.ok(timeoutAfterPoll.reconciliationNextAt > new Date());
  const financeVisible = await db.collection('parentOnlinePayments').find({
    branchId, activeKey: 'active', status: { $in: ['initiated', 'pending', 'reconciliation_required'] },
  }).toArray();
  assert.ok(financeVisible.some(row => String(row._id) === String(timedOut._id)));
  report.scenarios.merchantTimeout = 'pass: bounded worker retry scheduled; uncertain hold remained Finance-visible';

  stage = 'worker restart recovery';
  const restartInvoice = await seedInvoice(db, 'INV-RESTART', 25);
  const restartPayment = await reserveParent(db, client, restartInvoice.id, 'P-RESTART');
  const leaseStart = new Date();
  const oldWorkerClaim = await claimNextReconciliation(db, 'worker-before-restart', leaseStart, LEASE_MS);
  assert.equal(String(oldWorkerClaim._id), String(restartPayment._id));
  const afterRestart = new Date(leaseStart.getTime() + LEASE_MS + 1);
  const recoveredClaim = await claimNextReconciliation(db, 'worker-after-restart', afterRestart, LEASE_MS);
  assert.equal(String(recoveredClaim._id), String(restartPayment._id));
  assert.equal(recoveredClaim.workerLeaseId, 'worker-after-restart');
  assert.equal(recoveredClaim.reconciliationAttempts, 2);
  report.scenarios.restartRecovery = 'pass: expired worker lease was reclaimed after restart';
  await db.collection('parentOnlinePayments').updateOne(
    { _id: restartPayment._id }, { $set: { status: 'failed' }, $unset: { activeKey: '', workerLeaseId: '', workerLeaseExpiresAt: '' } },
  );

  stage = 'overlapping worker leases';
  const workerInvoice = await seedInvoice(db, 'INV-WORKERS', 35);
  const workerPayment = await reserveParent(db, client, workerInvoice.id, 'P-WORKERS');
  const simultaneousClaims = await Promise.all([
    claimNextReconciliation(db, 'worker-overlap-A', new Date()),
    claimNextReconciliation(db, 'worker-overlap-B', new Date()),
  ]);
  const workerClaims = simultaneousClaims.filter(Boolean);
  assert.equal(workerClaims.length, 1);
  assert.equal(String(workerClaims[0]._id), String(workerPayment._id));
  report.scenarios.overlappingWorkers = 'pass: atomic lease allowed only one concurrent claimant';
  await db.collection('parentOnlinePayments').updateOne(
    { _id: workerPayment._id }, { $set: { status: 'failed' }, $unset: { activeKey: '', workerLeaseId: '', workerLeaseExpiresAt: '' } },
  );

  stage = 'bounded worker retries';
  const exhaustedInvoice = await seedInvoice(db, 'INV-EXHAUSTED', 45);
  const exhaustedPayment = await reserveParent(db, client, exhaustedInvoice.id, 'P-EXHAUSTED');
  await db.collection('parentOnlinePayments').updateOne(
    { _id: exhaustedPayment._id }, { $set: { status: 'reconciliation_required', reconciliationAttempts: MAX_ATTEMPTS - 1 } },
  );
  const finalClaim = await claimNextReconciliation(db, 'worker-final-attempt', new Date());
  assert.equal(String(finalClaim._id), String(exhaustedPayment._id));
  const exhaustedOutcome = await processClaimedPayment({
    db, payment: finalClaim, workerId: 'worker-final-attempt', config: { enabled: true },
    fetchStatus: async () => { throw Object.assign(new Error('isolated timeout'), { name: 'TimeoutError' }); },
  });
  const exhaustedRow = await db.collection('parentOnlinePayments').findOne({ _id: exhaustedPayment._id });
  assert.equal(exhaustedOutcome, 'exhausted');
  assert.ok(exhaustedRow.reconciliationExhaustedAt instanceof Date);
  assert.equal(exhaustedRow.activeKey, 'active');
  report.scenarios.boundedRetries = 'pass: max attempts exhausted automatic polling without releasing the hold';

  stage = 'duplicate settlement transaction';
  const settlementInvoice = await seedInvoice(db, 'INV-SETTLE', 100);
  const settlementPayment = await reserveParent(db, client, settlementInvoice.id, 'P-1');
  await db.collection('parentOnlinePayments').updateOne(
    { _id: settlementPayment._id },
    { $set: { providerTransactionId: 'TX-FIXTURE-ONLY' } },
  );
  const paymentRef = { _id: settlementPayment._id, orderRef: settlementPayment.orderRef };
  // This calls the production settlement routine with an isolated fixture status only;
  // it is not a live gateway confirmation.
  await Promise.all([
    confirmPayment(paymentRef, { transactionId: 'TX-FIXTURE-ONLY', orderRef: paymentRef.orderRef, status: 'PAID_FIXTURE_ONLY' }),
    confirmPayment(paymentRef, { transactionId: 'TX-FIXTURE-ONLY', orderRef: paymentRef.orderRef, status: 'PAID_FIXTURE_ONLY' }),
  ]);
  const canonicalRows = await db.collection('payments').find({ onlinePaymentId: String(settlementPayment._id) }).toArray();
  const settledOnline = await db.collection('parentOnlinePayments').findOne({ _id: settlementPayment._id });
  assert.equal(canonicalRows.length, 1);
  assert.equal(new Set(canonicalRows.map(row => row.receiptNumber)).size, 1);
  assert.equal(settledOnline.status, 'confirmed');
  report.scenarios.duplicateSettlement = 'pass: concurrent fixture confirmations produced one canonical payment and receipt';
  report.allPassed = true;
}

(async () => {
  try {
    await run();
  } catch (error) {
    report.failedAt = stage;
    report.errorName = error.name;
    report.errorCode = error.code || null;
    report.errorMessage = String(error.message || '').replace(String(process.env.MONGODB_URI || ''), '[redacted URI]');
    report.allPassed = false;
    process.exitCode = 1;
  } finally {
    if (connected) {
      const client = database.getClient();
      try {
        const dropped = await client.db(isolatedDatabaseName).dropDatabase();
        report.temporaryDatabaseDropped = dropped === true || dropped?.ok === 1;
      } catch {
        report.temporaryDatabaseDropped = false;
      }
      await database.closeDatabase().catch(() => {});
      if (!report.temporaryDatabaseDropped) {
        report.allPassed = false;
        process.exitCode = 1;
      }
    }
    console.log(JSON.stringify(report));
  }
})();
