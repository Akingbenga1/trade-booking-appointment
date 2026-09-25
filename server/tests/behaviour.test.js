/**
 * Behaviour tests mapped to system-behviour.md
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { Notification } from '../src/models/Notification.js';
import { Business } from '../src/models/Business.js';
import { BusinessPayment } from '../src/models/BusinessPayment.js';
import { Transaction } from '../src/models/Transaction.js';
import {
  createCleaningRequest,
  respondToOffer,
  advanceBooking,
  cancelRequest,
  removeCancelledRequest,
  archiveRequest,
  forceAssign,
  processExpiries,
} from '../src/services/requestService.js';
import {
  consumeMagicLink,
  createMagicToken,
  hashToken,
  registerBusinessRepresentative,
} from '../src/services/businessService.js';
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';

const hub = { lat: 51.5074, lng: -0.1278 };

async function makeUser(overrides) {
  return User.create({
    name: overrides.name,
    email: overrides.email,
    passwordHash: await bcrypt.hash('x', 8),
    role: overrides.role,
    isAvailable: overrides.isAvailable ?? false,
    currentLocation: overrides.currentLocation,
  });
}

describe('system-behviour.md core rules', () => {
  let client;
  let cleanerA;
  let cleanerB;
  let cleanerFar;
  let admin;

  before(async () => {
    // Real MongoDB only — uses a dedicated test database
    process.env.MONGO_URI =
      process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trade_booking_test';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      CleaningRequest.deleteMany({}),
      Notification.deleteMany({}),
      Business.deleteMany({}),
      BusinessPayment.deleteMany({}),
      Transaction.deleteMany({}),
    ]);

    client = await makeUser({ name: 'Client', email: 't-client@test.com', role: 'client' });
    cleanerA = await makeUser({
      name: 'A',
      email: 't-a@test.com',
      role: 'cleaner',
      isAvailable: true,
      currentLocation: { lat: hub.lat + 0.01, lng: hub.lng, updatedAt: new Date() },
    });
    cleanerB = await makeUser({
      name: 'B',
      email: 't-b@test.com',
      role: 'cleaner',
      isAvailable: true,
      currentLocation: { lat: hub.lat - 0.01, lng: hub.lng, updatedAt: new Date() },
    });
    cleanerFar = await makeUser({
      name: 'Far',
      email: 't-far@test.com',
      role: 'cleaner',
      isAvailable: true,
      currentLocation: { lat: 52.5, lng: -1.5, updatedAt: new Date() },
    });
    admin = await makeUser({ name: 'Admin', email: 't-admin@test.com', role: 'admin' });
  });

  after(async () => {
    await disconnectDb();
  });

  it('posts need as Open and blasts nearby available cleaners together', async () => {
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Office deep clean',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '1 Demo St', latitude: hub.lat, longitude: hub.lng,
    });

    assert.equal(req.status, 'open');
    assert.equal(req.notifiedCleanerCount, 2);
    const ids = req.offers.map((o) => String(o.cleanerId)).sort();
    assert.deepEqual(ids, [String(cleanerA._id), String(cleanerB._id)].sort());
    assert.ok(!ids.includes(String(cleanerFar._id)));
    assert.ok(req.offers.every((o) => o.status === 'pending'));

    const notes = await Notification.find({ type: 'new_offer', requestId: req._id });
    assert.equal(notes.length, 2);
  });

  it('unmatches when no nearby available cleaners', async () => {
    await User.updateMany({ role: 'cleaner' }, { $set: { isAvailable: false } });
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Empty area clean',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '2 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    assert.equal(req.status, 'unmatched');
    assert.equal(req.notifiedCleanerCount, 0);
    await User.updateMany(
      { _id: { $in: [cleanerA._id, cleanerB._id, cleanerFar._id] } },
      { $set: { isAvailable: true } }
    );
  });

  it('first accept wins; others closed; reject/ignore keep request open', async () => {
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Race clean',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '3 Demo St', latitude: hub.lat, longitude: hub.lng,
    });

    await respondToOffer(req._id, cleanerB._id, 'reject');
    let fresh = await CleaningRequest.findById(req._id);
    assert.equal(fresh.status, 'open');
    const bOffer = fresh.offers.find((o) => String(o.cleanerId) === String(cleanerB._id));
    assert.equal(bOffer.status, 'rejected');

    await respondToOffer(req._id, cleanerA._id, 'accept');
    fresh = await CleaningRequest.findById(req._id);
    assert.equal(fresh.status, 'assigned');
    assert.equal(String(fresh.assignedCleanerId), String(cleanerA._id));
    assert.equal(
      fresh.offers.find((o) => String(o.cleanerId) === String(cleanerA._id)).status,
      'accepted'
    );
    assert.equal(
      fresh.offers.find((o) => String(o.cleanerId) === String(cleanerB._id)).status,
      'rejected'
    );

    await assert.rejects(
      () => respondToOffer(req._id, cleanerB._id, 'accept'),
      /no longer available|no pending offer/i
    );
  });

  it('blocks second accept after assignment', async () => {
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Double accept',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '4 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    await respondToOffer(req._id, cleanerA._id, 'accept');
    await assert.rejects(
      () => respondToOffer(req._id, cleanerB._id, 'accept'),
      /no longer available/i
    );
    const fresh = await CleaningRequest.findById(req._id);
    assert.equal(String(fresh.assignedCleanerId), String(cleanerA._id));
  });

  it('client can cancel only while open; assigned cleaner advances lifecycle', async () => {
    const openReq = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Cancel me',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '5 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    await cancelRequest(openReq._id, { id: client._id.toString(), role: 'client' });
    assert.equal((await CleaningRequest.findById(openReq._id)).status, 'cancelled');

    const notesBefore = await Notification.countDocuments({ requestId: openReq._id });
    assert.ok(notesBefore >= 1);
    await removeCancelledRequest(openReq._id, { id: client._id.toString(), role: 'client' });
    const removed = await CleaningRequest.findById(openReq._id);
    assert.ok(removed.deletedAt);
    assert.equal(await Notification.countDocuments({ requestId: openReq._id }), 0);
    await assert.rejects(
      () => removeCancelledRequest(openReq._id, { id: client._id.toString(), role: 'client' }),
      /not found/i
    );

    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Progress job',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '6 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    await respondToOffer(req._id, cleanerA._id, 'accept');
    await assert.rejects(
      () => cancelRequest(req._id, { id: client._id.toString(), role: 'client' }),
      /before a cleaner is locked in/i
    );

    let r = await advanceBooking(req._id, cleanerA._id, 'en_route');
    assert.equal(r.status, 'en_route');
    r = await advanceBooking(req._id, cleanerA._id, 'on_site');
    r = await advanceBooking(req._id, cleanerA._id, 'in_progress');
    r = await advanceBooking(req._id, cleanerA._id, 'completed');
    assert.equal(r.status, 'completed');

    await assert.rejects(
      () => advanceBooking(req._id, cleanerB._id, 'en_route'),
      /Only the assigned cleaner/i
    );
  });

  it('admin force-assign and cancel work', async () => {
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Admin intervene',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '7 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    const assigned = await forceAssign(req._id, cleanerB._id, admin._id);
    assert.equal(assigned.status, 'assigned');
    assert.equal(String(assigned.assignedCleanerId), String(cleanerB._id));
    assert.ok(assigned.offers.every((o) => o.status !== 'pending'));

    const cancelled = await cancelRequest(req._id, {
      id: admin._id.toString(),
      role: 'admin',
    });
    assert.equal(cancelled.status, 'cancelled');
  });

  it('matching window expiry marks request unmatched and pending offers ignored', async () => {
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Expire matching',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '8 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    await CleaningRequest.updateOne(
      { _id: req._id },
      { $set: { matchingExpiresAt: new Date(Date.now() - 1000) } }
    );
    await processExpiries();
    const fresh = await CleaningRequest.findById(req._id);
    assert.equal(fresh.status, 'unmatched');
    assert.ok(fresh.offers.every((o) => o.status === 'ignored' || o.status === 'closed'));
  });

  it('offer timer expiry marks offer ignored while request can stay open', async () => {
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Expire offer',
      scheduleStart: new Date(Date.now() + 86400000),
      scheduleEnd: new Date(Date.now() + 2 * 86400000),
      address: '9 Demo St', latitude: hub.lat, longitude: hub.lng,
    });
    // Keep matching window alive; expire only cleanerA offer
    await CleaningRequest.updateOne(
      { _id: req._id },
      {
        $set: {
          matchingExpiresAt: new Date(Date.now() + 600_000),
          'offers.$[a].expiresAt': new Date(Date.now() - 1000),
        },
      },
      { arrayFilters: [{ 'a.cleanerId': cleanerA._id }] }
    );
    await processExpiries();
    const fresh = await CleaningRequest.findById(req._id);
    assert.equal(fresh.status, 'open');
    assert.equal(
      fresh.offers.find((o) => String(o.cleanerId) === String(cleanerA._id)).status,
      'ignored'
    );
  });

  it('business self-onboarding creates person + Business; jobs owned by Business', async () => {
    const { user, business } = await registerBusinessRepresentative({
      name: 'Rep One',
      email: 'biz-rep@test.com',
      businessName: 'Acme Clean HQ',
      address: '1 Business Way, London',
      latitude: hub.lat,
      longitude: hub.lng,
      phone: '+44000000000',
    });
    assert.equal(user.role, 'business');
    assert.equal(user.mustSetPassword, true);
    assert.ok(!user.passwordHash);
    assert.equal(business.name, 'Acme Clean HQ');
    assert.ok(business.latitude != null);

    const magic = createMagicToken();
    user.magicLinkTokenHash = hashToken(magic.token);
    user.magicLinkExpiresAt = magic.expiresAt;
    await user.save();

    const verified = await consumeMagicLink(magic.token);
    assert.equal(String(verified._id), String(user._id));
    assert.ok(!verified.magicLinkTokenHash);

    const scheduleStart = new Date(Date.now() + 86400000);
    scheduleStart.setHours(9, 0, 0, 0);
    const scheduleEnd = new Date(scheduleStart);
    scheduleEnd.setDate(scheduleEnd.getDate() + 1);
    scheduleEnd.setHours(17, 0, 0, 0);

    const req = await createCleaningRequest({
      clientId: user._id,
      businessId: business._id,
      serviceDetails: 'Business office clean',
      scheduleStart,
      scheduleEnd,
      address: 'Biz site', latitude: hub.lat, longitude: hub.lng,
      payRatePerHour: 12.71,
    });
    assert.equal(String(req.businessId), String(business._id));
    assert.equal(String(req.clientId), String(user._id));
    assert.ok(req.pay);
    assert.equal(req.pay.payRatePerHour, 12.71);
    assert.equal(req.pay.currency, 'GBP');
    // 8h/day × 2 days
    assert.equal(req.pay.durationHours, 16);
    assert.equal(req.pay.totalAmount, Math.round(12.71 * 16 * 100) / 100);
    const ownership = await BusinessPayment.findOne({ requestId: req._id });
    assert.ok(ownership);
    assert.equal(String(ownership.businessId), String(business._id));
    const tx = await Transaction.findById(ownership.transactionId);
    assert.ok(tx);
    assert.equal(tx.amount, req.pay.totalAmount);
    assert.equal(tx.status, 'unpaid');

    await assert.rejects(
      () =>
        createCleaningRequest({
          clientId: user._id,
          businessId: business._id,
          serviceDetails: 'Too low',
          scheduleStart,
          scheduleEnd,
          address: 'Biz site', latitude: hub.lat, longitude: hub.lng,
          payRatePerHour: 10,
        }),
      (err) => err.status === 400
    );

    await cancelRequest(req._id, { id: user._id.toString(), role: 'business' });
    assert.equal((await CleaningRequest.findById(req._id)).status, 'cancelled');
  });

  it('paid jobs cannot be cancelled; they can be archived (hidden)', async () => {
    const user = await makeUser({
      name: 'Biz Paid',
      email: 'biz-paid-archive@test.com',
      role: 'business',
    });
    const business = await Business.create({
      name: 'Paid Archive Co',
      phone: '07000000099',
      address: '1 Archive St',
      latitude: hub.lat,
      longitude: hub.lng,
      memberIds: [user._id],
      createdBy: user._id,
    });
    const scheduleStart = new Date('2030-06-01T09:00:00.000Z');
    const scheduleEnd = new Date('2030-06-02T17:00:00.000Z');
    const req = await createCleaningRequest({
      clientId: user._id,
      businessId: business._id,
      serviceDetails: 'Paid then hide',
      scheduleStart,
      scheduleEnd,
      address: 'Biz site',
      latitude: hub.lat,
      longitude: hub.lng,
      payRatePerHour: 12.71,
    });
    const ownership = await BusinessPayment.findOne({ requestId: req._id });
    const tx = await Transaction.findById(ownership.transactionId);
    tx.status = 'paid';
    tx.paidAt = new Date();
    await tx.save();

    await assert.rejects(
      () => cancelRequest(req._id, { id: user._id.toString(), role: 'business' }),
      (err) => err.status === 409 && /paid/i.test(err.message)
    );
    assert.equal((await CleaningRequest.findById(req._id)).status, 'open');

    const archived = await archiveRequest(req._id, {
      id: user._id.toString(),
      role: 'business',
    });
    assert.ok(archived.archivedAt);
    assert.equal((await CleaningRequest.findById(req._id)).status, 'open');

    await assert.rejects(
      () => archiveRequest(req._id, { id: user._id.toString(), role: 'business' }),
      (err) => err.status === 404
    );
  });
});
