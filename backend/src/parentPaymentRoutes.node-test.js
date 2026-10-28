const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invoiceStatusFromCents } = require('./invoiceStatus');

const {
  gatewayConfiguration,
  cardProviderConfiguration,
  assertNoRawCardData,
  verifyCardWebhookSignature,
  httpsUrl,
  publicGatewayConfiguration,
  statusResponse,
  validateMerchantStatus,
  ensurePaymentIndexes,
} = require('./parentPaymentRoutes').__test;
const { checkoutIdempotencyKey, checkoutRequestHash } = require('./invoiceReservations');

const configuredEnv = {
  ONLINE_PAYMENTS_VERIFIED: 'true',
  EASYPAISA_CHECKOUT_URL: 'https://merchant.example/checkout',
  EASYPAISA_STATUS_URL: 'https://merchant.example/status',
  EASYPAISA_STORE_ID: 'store-1',
  EASYPAISA_API_KEY: 'server-secret',
  EASYPAISA_METHODS: 'card,easypaisa',
  EASYPAISA_CONFIRMED_STATUS: 'PAID',
  EASYPAISA_FAILED_STATUSES: 'FAILED,DECLINED,CANCELLED',
};

test('provider credentials alone cannot enable unverified online payments', () => {
  const env = {...configuredEnv};
  delete env.ONLINE_PAYMENTS_VERIFIED;
  assert.equal(gatewayConfiguration(env).enabled, false);
  assert.deepEqual(publicGatewayConfiguration(env).methods, []);
});

test('checkout is disabled when any merchant verification setting is missing', () => {
  assert.equal(gatewayConfiguration({}).enabled, false);
  assert.equal(
    gatewayConfiguration({ ...configuredEnv, EASYPAISA_STATUS_URL: '' }).enabled,
    false,
  );
  assert.equal(
    gatewayConfiguration({ ...configuredEnv, EASYPAISA_CONFIRMED_STATUS: '' }).enabled,
    false,
  );
});

test('public checkout config exposes methods but never merchant secrets', () => {
  const config = publicGatewayConfiguration(configuredEnv);
  assert.equal(config.enabled, true);
  assert.deepEqual(config.methods, ['card', 'easypaisa']);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.storeId, undefined);
  assert.equal(config.checkoutUrl, undefined);
  assert.equal(config.statusUrl, undefined);
});

test('merchant endpoints must use HTTPS', () => {
  assert.equal(httpsUrl('http://merchant.example/checkout'), '');
  assert.equal(httpsUrl('not a url'), '');
  assert.equal(httpsUrl('https://merchant.example/checkout'), 'https://merchant.example/checkout');
});

test('only an exact matching server status can confirm payment', () => {
  const payment = {
    providerTransactionId: 'TX-1',
    orderRef: 'ORDER-1',
    currency: 'PKR',
    amount: 1250,
  };
  const config = gatewayConfiguration(configuredEnv);
  const confirmed = validateMerchantStatus(payment, {
    transactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250, status: 'PAID',
  }, config);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.failed, false);

  const pending = validateMerchantStatus(payment, {
    transactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250, status: 'PENDING',
  }, config);
  assert.equal(pending.confirmed, false);
  assert.equal(pending.failed, false);

  const failed = validateMerchantStatus(payment, {
    transactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250, status: 'DECLINED',
  }, config);
  assert.equal(failed.confirmed, false);
  assert.equal(failed.failed, true);
});

test('mismatched amount, order, currency, or transaction cannot confirm', () => {
  const payment = {
    providerTransactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250,
  };
  const config = gatewayConfiguration(configuredEnv);
  assert.throws(
    () => validateMerchantStatus(payment, {
      transactionId: 'TX-1', orderRef: 'OTHER', currency: 'PKR', amount: 1250, status: 'PAID',
    }, config),
    /did not match/,
  );
});

test('receipts are hidden until the canonical payment is confirmed', () => {
  const pending = statusResponse({ _id: '1', invoiceId: 'INV-1', status: 'pending' });
  assert.equal(pending.receipt, null);
  const confirmed = statusResponse({
    _id: '1', invoiceId: 'INV-1', status: 'confirmed', receiptNumber: 'RCT-1',
    amount: 1250, currency: 'PKR', method: 'card', confirmedAt: new Date('2026-10-07T10:00:00Z'),
  });
  assert.equal(confirmed.receipt.receiptNumber, 'RCT-1');
  assert.equal(confirmed.receipt.method, 'card');
});

test('confirmed parent checkout uses the shared canonical invoice status', () => {
  assert.equal(invoiceStatusFromCents(10000, 3000), 'partially_paid');
  assert.equal(invoiceStatusFromCents(10000, 10000), 'paid');
  assert.equal(invoiceStatusFromCents(10000, 0), 'due');
});

test('checkout retries reuse the same key and changed payloads are detectable', () => {
  const key = checkoutIdempotencyKey('P-1', 'S-1', 'INV-1', 'card', 'retry-key-0001');
  assert.equal(checkoutIdempotencyKey('P-1', 'S-1', 'INV-1', 'card', 'retry-key-0001'), key);
  assert.equal(checkoutRequestHash('S-1', 'INV-1', 'card'), checkoutRequestHash('S-1', 'INV-1', 'card'));
  assert.notEqual(checkoutRequestHash('S-1', 'INV-1', 'card'), checkoutRequestHash('S-1', 'INV-1', 'easypaisa'));
});

test('payment indexes enforce one active reservation per invoice and one settlement per checkout', async () => {
  const calls = [];
  const db = { collection: name => ({ createIndex: async (fields, options) => {
    calls.push({ name, fields, options });
    return options.name;
  } }) };
  await ensurePaymentIndexes(db);
  assert.ok(calls.some(call => call.options.name === 'unique_active_parent_invoice_checkout' && call.options.unique && call.options.partialFilterExpression.activeKey === 'active'));
  assert.ok(calls.some(call => call.options.name === 'unique_active_parent_invoice_reservation' && call.options.unique && call.options.partialFilterExpression.activeKey === 'active' && call.fields.invoiceId === 1));
  assert.ok(calls.some(call => call.options.name === 'unique_parent_checkout_idempotency' && call.options.unique));
  assert.ok(calls.some(call => call.options.name === 'unique_parent_online_provider_transaction' && call.options.unique && call.options.partialFilterExpression.providerTransactionId.$type === 'string'));
  assert.ok(calls.some(call => call.options.name === 'unique_confirmed_online_payment' && call.options.unique && call.fields.onlinePaymentId === 1));
});

test('per-school hosted card provider contract requires merchant config, webhook secret, and ONLINE_PAYMENTS_VERIFIED, and forbids raw PAN/CVV', () => {
  const crypto = require('node:crypto');
  const schoolMerchant = {
    cardCheckoutUrl: 'https://cards.merchant.example/session',
    cardStatusUrl: 'https://cards.merchant.example/status',
    cardMerchantId: 'sch-merchant-01',
    cardApiKey: 'sch-secret-key',
    cardConfirmedStatus: 'CAPTURED',
    cardFailedStatuses: 'FAILED,DECLINED',
  };
  const secret = '0123456789abcdef0123456789abcdef_webhook_secret';

  // Missing webhook secret or ONLINE_PAYMENTS_VERIFIED stays disabled
  assert.equal(cardProviderConfiguration(schoolMerchant, { ONLINE_PAYMENTS_VERIFIED: 'true' }).enabled, false);
  assert.equal(cardProviderConfiguration(schoolMerchant, { CARD_PROVIDER_WEBHOOK_SECRET: secret }).enabled, false);

  // Full verified configuration enables hosted_tokenized card checkout without raw card collection
  const enabledCard = cardProviderConfiguration(schoolMerchant, {
    ONLINE_PAYMENTS_VERIFIED: 'true',
    CARD_PROVIDER_WEBHOOK_SECRET: secret,
  });
  assert.equal(enabledCard.enabled, true);
  assert.equal(enabledCard.provider, 'hosted_card');
  assert.equal(enabledCard.mode, 'hosted_tokenized');
  assert.equal(enabledCard.rawCardCollectionAllowed, false);

  // Raw PAN / CVV fields are strictly rejected
  assert.throws(() => assertNoRawCardData({ method: 'card', cardNumber: '4111111111111111' }), /strictly prohibited/);
  assert.throws(() => assertNoRawCardData({ method: 'card', cvv: '123' }), /strictly prohibited/);
  assert.doesNotThrow(() => assertNoRawCardData({ method: 'card' }));

  // Webhook HMAC verification fails closed when secret is absent or signature mismatches
  assert.throws(() => verifyCardWebhookSignature('{"tx":"1"}', 'bad', ''), /disabled/);
  const payload = JSON.stringify({ transactionId: 'TX-99', status: 'CAPTURED' });
  const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(verifyCardWebhookSignature(payload, `sha256=${validSig}`, secret), true);
  assert.throws(() => verifyCardWebhookSignature(payload, `sha256=${'0'.repeat(64)}`, secret), /verification failed/);
});

test('connected card checkout and webhook handle success, pending, failure, duplicate callbacks, invalid signatures, cross-school rejection, and client redirect settlement parameters', async () => {
  const crypto = require('node:crypto');
  const { ObjectId } = require('mongodb');
  const databasePath = require.resolve('./database');
  const previousDbCache = require.cache[databasePath];
  const prevVerified = process.env.ONLINE_PAYMENTS_VERIFIED;
  const prevSecret = process.env.CARD_PROVIDER_WEBHOOK_SECRET;
  const webhookSecret = '0123456789abcdef0123456789abcdef_card_webhook_secret';
  process.env.ONLINE_PAYMENTS_VERIFIED = 'true';
  process.env.CARD_PROVIDER_WEBHOOK_SECRET = webhookSecret;

  const schoolAId = new ObjectId();
  const schoolBId = new ObjectId();
  const branchAId = new ObjectId();
  const parentId = new ObjectId();
  const studentDocId = new ObjectId();

  const schoolAMerchant = {
    cardCheckoutUrl: 'https://cards.merchant.example/session',
    cardStatusUrl: 'https://cards.merchant.example/status',
    cardMerchantId: 'sch-merchant-A',
    cardApiKey: 'sch-api-key-A',
    cardConfirmedStatus: 'CAPTURED',
    cardFailedStatuses: 'FAILED,DECLINED',
  };

  function makeStore() {
    const paymentId1 = new ObjectId();
    const paymentId2 = new ObjectId();
    return {
      schools: [
        { _id: schoolAId, name: 'Greenwood A', isActive: true, status: 'active', cardMerchantConfig: schoolAMerchant },
        { _id: schoolBId, name: 'Greenwood B', isActive: true, status: 'active', cardMerchantConfig: { ...schoolAMerchant, cardMerchantId: 'sch-merchant-B' } },
      ],
      branches: [
        { _id: branchAId, id: branchAId.toHexString(), schoolId: schoolAId, isActive: true, active: true },
      ],
      users: [
        { _id: parentId, id: 'parent-1', role: 'parent', active: true, isActive: true, schoolId: schoolAId.toHexString(), branchId: branchAId.toHexString() },
      ],
      students: [
        { _id: studentDocId, id: 'stu-1', schoolId: schoolAId.toHexString(), branchId: branchAId.toHexString(), fullName: 'Sara Khan' },
      ],
      parentChildLinks: [
        { parentUserId: 'parent-1', studentId: 'stu-1', schoolId: schoolAId.toHexString(), status: 'verified', verified: true, revokedAt: null },
      ],
      invoices: [
        { _id: new ObjectId(), id: 'INV-101', studentId: 'stu-1', schoolId: schoolAId.toHexString(), branchId: branchAId.toHexString(), amount: 500, paidAmount: 0, pendingPaymentAmount: 0, balanceDue: 500, currency: 'PKR', status: 'due' },
        { _id: new ObjectId(), id: 'INV-102', studentId: 'stu-1', schoolId: schoolAId.toHexString(), branchId: branchAId.toHexString(), amount: 300, paidAmount: 0, pendingPaymentAmount: 0, balanceDue: 300, currency: 'PKR', status: 'due' },
      ],
      parentOnlinePayments: [
        {
          _id: paymentId1,
          parentUserId: 'parent-1',
          studentId: 'stu-1',
          invoiceId: 'INV-101',
          schoolId: schoolAId,
          branchId: branchAId.toHexString(),
          merchantId: 'sch-merchant-A',
          provider: 'hosted_card',
          method: 'card',
          orderRef: 'FEE-CARD-ORDER-1',
          providerTransactionId: 'CARD-TX-101',
          amount: 500,
          currency: 'PKR',
          status: 'pending',
          activeKey: 'active',
          createdAt: new Date(),
        },
        {
          _id: paymentId2,
          parentUserId: 'parent-1',
          studentId: 'stu-1',
          invoiceId: 'INV-102',
          schoolId: schoolAId,
          branchId: branchAId.toHexString(),
          merchantId: 'sch-merchant-A',
          provider: 'hosted_card',
          method: 'card',
          orderRef: 'FEE-CARD-ORDER-2',
          providerTransactionId: 'CARD-TX-102',
          amount: 300,
          currency: 'PKR',
          status: 'pending',
          activeKey: 'active',
          createdAt: new Date(),
        },
      ],
      parentBatchPayments: [],
      payments: [],
    };
  }

  const store = makeStore();

  function matches(doc, query = {}) {
    if (!query || Object.keys(query).length === 0) return true;
    return Object.entries(query).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (k === '$and') return v.every(sub => matches(doc, sub));
      if (v && typeof v === 'object' && !(v instanceof ObjectId) && !(v instanceof Date)) {
        if (v.$exists !== undefined) return v.$exists ? doc[k] !== undefined : doc[k] === undefined;
        if (v.$in) return v.$in.some(x => String(doc[k]) === String(x));
        if (v.$ne !== undefined) return String(doc[k]) !== String(v.$ne);
      }
      if (k.includes('.')) {
        const parts = k.split('.');
        let cur = doc;
        for (const p of parts) cur = cur?.[p];
        return String(cur) === String(v);
      }
      if (v === null) return doc[k] == null;
      return String(doc[k]) === String(v);
    });
  }

  const fakeDb = {
    collection(name) {
      const rows = store[name] || (store[name] = []);
      return {
        createIndex: async () => 'ok',
        findOne: async query => rows.find(r => matches(r, query)) || null,
        find: query => {
          const filtered = rows.filter(r => matches(r, query));
          return {
            limit: n => ({ toArray: async () => filtered.slice(0, n) }),
            toArray: async () => filtered,
          };
        },
        insertOne: async doc => {
          const record = { _id: doc._id || new ObjectId(), ...doc };
          rows.push(record);
          return { insertedId: record._id };
        },
        updateOne: async (query, update) => {
          const row = rows.find(r => matches(r, query));
          if (!row) return { matchedCount: 0, modifiedCount: 0 };
          if (update.$set) Object.assign(row, update.$set);
          if (update.$unset) {
            for (const key of Object.keys(update.$unset)) delete row[key];
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },
        findOneAndUpdate: async (query, update) => {
          const row = rows.find(r => matches(r, query));
          if (!row) return null;
          if (update.$set) Object.assign(row, update.$set);
          return row;
        },
        aggregate: pipeline => ({
          toArray: async () => {
            if (name === 'payments') {
              const confirmed = rows.filter(r => r.status === 'confirmed');
              return [{ paidAmount: confirmed.reduce((s, r) => s + Number(r.amount || 0), 0), pendingAmount: 0 }];
            }
            if (name === 'parentOnlinePayments') {
              return [{ reservedAmount: 0 }];
            }
            return [];
          },
        }),
      };
    },
  };

  const paymentRoutesPath = require.resolve('./parentPaymentRoutes');
  const savedPaymentRoutesCache = require.cache[paymentRoutesPath];
  delete require.cache[paymentRoutesPath];
  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
      getDatabase: () => fakeDb,
      getClient: () => ({
        startSession: () => ({
          withTransaction: async fn => fn(),
          endSession: async () => {},
        }),
      }),
    },
  };

  try {
    const paymentRouter = require('./parentPaymentRoutes');
    const {
      assertNoClientSettlementParams,
      handleCardWebhook,
      resolveProviderForMethod,
      publicGatewayConfiguration,
    } = paymentRouter.__test;

    // 1. Public gateway config includes 'card' when school card merchant is configured
    const pubConfig = publicGatewayConfiguration(process.env, store.schools[0]);
    assert.equal(pubConfig.enabled, true);
    assert.ok(pubConfig.methods.includes('card'));
    assert.equal(pubConfig.cardProvider.mode, 'hosted_tokenized');

    // 2. resolveProviderForMethod returns per-school hosted_card provider for 'card'
    const resolvedCard = resolveProviderForMethod('card', store.schools[0], process.env);
    assert.equal(resolvedCard.enabled, true);
    assert.equal(resolvedCard.provider, 'hosted_card');
    assert.equal(resolvedCard.merchantId, 'sch-merchant-A');

    // 3. Client redirect settlement parameters are rejected
    assert.throws(
      () => assertNoClientSettlementParams({ query: { paymentStatus: 'PAID' }, body: {} }),
      /Client redirect parameters cannot confirm/,
    );
    assert.throws(
      () => assertNoClientSettlementParams({ query: {}, body: { settled: true } }),
      /Client redirect parameters cannot confirm/,
    );

    async function callWebhook(payloadObj, signatureOverride = null) {
      const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
      const sig =
        signatureOverride ??
        `sha256=${crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
      let statusCode = 200;
      let responseBody = null;
      const req = {
        rawBody,
        body: payloadObj,
        get: header =>
          String(header).toLowerCase() === 'x-card-webhook-signature' ? sig : undefined,
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          responseBody = payload;
          return this;
        },
      };
      await handleCardWebhook(req, res, err => {
        if (err) throw err;
      });
      return { status: statusCode, body: responseBody };
    }

    // 4. Invalid signature is rejected with 403
    const badSigRes = await callWebhook(
      {
        event: 'payment.captured',
        merchantId: 'sch-merchant-A',
        orderRef: 'FEE-CARD-ORDER-1',
        transactionId: 'CARD-TX-101',
        status: 'CAPTURED',
        amount: 500,
        currency: 'PKR',
      },
      `sha256=${'0'.repeat(64)}`,
    );
    assert.equal(badSigRes.status, 403);

    // 5. Cross-school webhook attempt is rejected with 403
    const crossSchoolRes = await callWebhook({
      event: 'payment.captured',
      merchantId: 'sch-merchant-A',
      orderRef: 'FEE-CARD-ORDER-1',
      transactionId: 'CARD-TX-101',
      status: 'CAPTURED',
      amount: 500,
      currency: 'PKR',
      schoolId: schoolBId.toHexString(),
    });
    assert.equal(crossSchoolRes.status, 403);

    // 6. Pending webhook event preserves reservation and returns 202
    const pendingRes = await callWebhook({
      event: 'payment.pending',
      merchantId: 'sch-merchant-A',
      orderRef: 'FEE-CARD-ORDER-1',
      transactionId: 'CARD-TX-101',
      status: 'PROCESSING',
      amount: 500,
      currency: 'PKR',
      invoiceId: 'INV-101',
      studentId: 'stu-1',
    });
    assert.equal(pendingRes.status, 202);
    assert.equal(pendingRes.body.data.status, 'pending');
    assert.equal(store.parentOnlinePayments[0].activeKey, 'active');

    // 7. Capture webhook settles invoice atomically and issues receipt
    const capturedRes = await callWebhook({
      event: 'payment.captured',
      merchantId: 'sch-merchant-A',
      orderRef: 'FEE-CARD-ORDER-1',
      transactionId: 'CARD-TX-101',
      status: 'CAPTURED',
      amount: 500,
      currency: 'PKR',
      invoiceId: 'INV-101',
      studentId: 'stu-1',
      schoolId: schoolAId.toHexString(),
    });
    assert.equal(capturedRes.status, 200);
    assert.equal(capturedRes.body.data.status, 'confirmed');
    assert.ok(capturedRes.body.data.receipt?.receiptNumber);
    assert.equal(store.invoices[0].status, 'paid');
    assert.equal(store.invoices[0].balanceDue, 0);
    assert.equal(store.payments.length, 1);

    // 8. Duplicate capture webhook callback is idempotent and does not double-settle
    const dupRes = await callWebhook({
      event: 'payment.captured',
      merchantId: 'sch-merchant-A',
      orderRef: 'FEE-CARD-ORDER-1',
      transactionId: 'CARD-TX-101',
      status: 'CAPTURED',
      amount: 500,
      currency: 'PKR',
      invoiceId: 'INV-101',
      studentId: 'stu-1',
    });
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.body.duplicate, true);
    assert.equal(store.payments.length, 1);

    // 9. Failure webhook on second payment releases active reservation without settling
    const failedRes = await callWebhook({
      event: 'payment.failed',
      merchantId: 'sch-merchant-A',
      orderRef: 'FEE-CARD-ORDER-2',
      transactionId: 'CARD-TX-102',
      status: 'DECLINED',
      amount: 300,
      currency: 'PKR',
      invoiceId: 'INV-102',
      studentId: 'stu-1',
    });
    assert.equal(failedRes.status, 200);
    assert.equal(failedRes.body.data.status, 'failed');
    assert.equal(store.parentOnlinePayments[1].activeKey, undefined);
    assert.equal(store.invoices[1].status, 'due');
  } finally {
    if (previousDbCache) require.cache[databasePath] = previousDbCache;
    else delete require.cache[databasePath];
    if (savedPaymentRoutesCache) require.cache[paymentRoutesPath] = savedPaymentRoutesCache;
    else delete require.cache[paymentRoutesPath];
    if (prevVerified === undefined) delete process.env.ONLINE_PAYMENTS_VERIFIED;
    else process.env.ONLINE_PAYMENTS_VERIFIED = prevVerified;
    if (prevSecret === undefined) delete process.env.CARD_PROVIDER_WEBHOOK_SECRET;
    else process.env.CARD_PROVIDER_WEBHOOK_SECRET = prevSecret;
  }
});


