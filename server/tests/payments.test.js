/**
 * Payment transactions list + provider-neutral payment core / Stripe adapter.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { Business } from '../src/models/Business.js';
import { BusinessPayment } from '../src/models/BusinessPayment.js';
import { Transaction } from '../src/models/Transaction.js';
import { PaymentProviderEvent } from '../src/models/PaymentProviderEvent.js';
import { createCleaningRequest } from '../src/services/requestService.js';
import { listBusinessTransactions } from '../src/services/paymentService.js';
import { applyPaymentStatus } from '../src/services/payments/core.js';
import { mapStripeEvent } from '../src/services/payments/stripeAdapter.js';
import { registerBusinessRepresentative } from '../src/services/businessService.js';
import { config } from '../src/config.js';

const hub = { lat: 51.5074, lng: -0.1278 };

describe('payment transactions + webhook core', () => {
  before(async () => {
    process.env.MONGO_URI =
      process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trade_booking_test';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      CleaningRequest.deleteMany({}),
      Business.deleteMany({}),
      BusinessPayment.deleteMany({}),
      Transaction.deleteMany({}),
      PaymentProviderEvent.deleteMany({}),
    ]);
  });

  after(async () => {
    await disconnectDb();
  });

  it('mapStripeEvent maps checkout completed/expired/failed to neutral statuses', () => {
    const paid = mapStripeEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          id: 'cs_test_1',
          payment_status: 'paid',
          payment_intent: 'pi_1',
          metadata: { requestId: 'r1', transactionId: 't1' },
        },
      },
    });
    assert.equal(paid.status, 'paid');
    assert.equal(paid.checkoutSessionId, 'cs_test_1');
    assert.equal(paid.providerPaymentId, 'pi_1');
    assert.equal(paid.transactionId, 't1');

    const cancelled = mapStripeEvent({
      type: 'checkout.session.expired',
      data: {
        object: {
          object: 'checkout.session',
          id: 'cs_test_2',
          metadata: { requestId: 'r2', transactionId: 't2' },
        },
      },
    });
    assert.equal(cancelled.status, 'cancelled');

    const failed = mapStripeEvent({
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          object: 'checkout.session',
          id: 'cs_test_3',
          metadata: { requestId: 'r3', transactionId: 't3' },
        },
      },
    });
    assert.equal(failed.status, 'failed');

    assert.equal(
      mapStripeEvent({ type: 'customer.created', data: { object: {} } }),
      null
    );
  });

  it('applyPaymentStatus updates transactions and listBusinessTransactions joins ownership', async () => {
    const { user, business } = await registerBusinessRepresentative({
      name: 'Pay Biz Owner',
      email: `pay-biz-${Date.now()}@test.com`,
      businessName: 'Pay Biz Co',
      address: '2 Pay Street, London',
      latitude: hub.lat,
      longitude: hub.lng,
      phone: '+44111111111',
    });

    const scheduleStart = new Date(Date.now() + 86400000);
    scheduleStart.setHours(9, 0, 0, 0);
    const scheduleEnd = new Date(scheduleStart);
    scheduleEnd.setHours(17, 0, 0, 0);

    const req = await createCleaningRequest({
      clientId: user._id,
      businessId: business._id,
      serviceDetails: 'Lobby clean',
      scheduleStart,
      scheduleEnd,
      address: 'Lobby',
      latitude: hub.lat,
      longitude: hub.lng,
      payRatePerHour: 12.71,
    });

    const ownership = await BusinessPayment.findOne({ requestId: req._id });
    assert.ok(ownership);
    assert.equal(String(ownership.businessId), String(business._id));

    const tx = await Transaction.findById(ownership.transactionId);
    assert.ok(tx);
    assert.equal(tx.status, 'unpaid');

    await applyPaymentStatus({
      transactionId: tx._id,
      status: 'pending',
      provider: 'stripe',
      checkoutSessionIdToStore: 'cs_list_1',
    });

    await applyPaymentStatus({
      transactionId: tx._id,
      status: 'paid',
      provider: 'stripe',
      providerPaymentId: 'pi_list_1',
      receiptUrl: 'https://pay.example/receipt/1',
      paidAt: new Date('2026-01-15T12:00:00Z'),
    });

    const actor = { id: user._id.toString(), role: 'business' };
    const rows = await listBusinessTransactions(actor, business._id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'paid');
    assert.equal(rows[0].amount, tx.amount);
    assert.equal(rows[0].jobLabel, 'Lobby clean');
    assert.equal(rows[0].providerId, 'pi_list_1');
    assert.equal(rows[0].receiptUrl, 'https://pay.example/receipt/1');
    assert.ok(rows[0].date);

    // Paid is terminal — failed must not overwrite
    const blocked = await applyPaymentStatus({
      transactionId: tx._id,
      status: 'failed',
    });
    assert.equal(blocked.alreadyPaid, true);
    assert.equal((await Transaction.findById(tx._id)).status, 'paid');

    await assert.rejects(
      () => listBusinessTransactions(actor, '000000000000000000000000'),
      (err) => err.status === 403
    );
  });

  it('stores raw provider events uniquely by providerEventId', async () => {
    await PaymentProviderEvent.create({
      provider: 'stripe',
      providerEventId: 'evt_unique_1',
      providerEventType: 'checkout.session.completed',
      mappedStatus: 'paid',
      payload: { id: 'evt_unique_1' },
      processingStatus: 'processed',
      processedAt: new Date(),
    });

    await assert.rejects(
      () =>
        PaymentProviderEvent.create({
          provider: 'stripe',
          providerEventId: 'evt_unique_1',
          providerEventType: 'checkout.session.completed',
          payload: { id: 'evt_unique_1' },
          processingStatus: 'received',
        }),
      (err) => err.code === 11000
    );
  });
});
