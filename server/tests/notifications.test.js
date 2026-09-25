/**
 * Notification delivery tests — inbox + durable queue + live/push/email paths.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Notification } from '../src/models/Notification.js';
import { NotificationJob } from '../src/models/NotificationJob.js';
import { PushDevice } from '../src/models/PushDevice.js';
import { notify, notifyMany } from '../src/services/notify.js';
import {
  flushDeliveryQueue,
  URGENT_TYPES,
} from '../src/services/deliveryQueue.js';
import {
  emitNotificationToUser,
  isUserLive,
  _attachTestSocket,
  _resetRealtimeForTests,
} from '../src/services/realtime.js';
import { config } from '../src/config.js';
import bcrypt from 'bcryptjs';

async function makeUser(overrides) {
  return User.create({
    name: overrides.name,
    email: overrides.email,
    passwordHash: await bcrypt.hash('x', 8),
    role: overrides.role,
  });
}

describe('notification delivery', () => {
  let cleaner;
  let business;

  before(async () => {
    process.env.MONGO_URI =
      process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trade_booking_test';
    config.mongoUri = process.env.MONGO_URI;
    config.notify.emailFallbackSeconds = 1;
    await connectDb();
  });

  after(async () => {
    await disconnectDb();
  });

  beforeEach(async () => {
    await flushDeliveryQueue();
    _resetRealtimeForTests();
    await Promise.all([
      User.deleteMany({}),
      Notification.deleteMany({}),
      NotificationJob.deleteMany({}),
      PushDevice.deleteMany({}),
    ]);
    cleaner = await makeUser({
      name: 'Cleaner',
      email: 'del-cleaner@test.com',
      role: 'cleaner',
    });
    business = await makeUser({
      name: 'Biz',
      email: 'del-biz@test.com',
      role: 'business',
    });
  });

  it('keeps inbox as source of truth and enqueues delivery jobs', async () => {
    const doc = await notify(cleaner._id, {
      type: 'new_offer',
      title: 'New offer',
      body: 'Nearby job',
    });
    assert.ok(doc._id);
    const inbox = await Notification.find({ userId: cleaner._id });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].title, 'New offer');

    const jobs = await NotificationJob.find({ notificationId: doc._id });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, 'deliver');
    assert.equal(jobs[0].status, 'pending');
  });

  it('marks live delivery when a socket is registered', async () => {
    const fakeWs = {
      readyState: 1,
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
      close() {},
    };
    const detach = _attachTestSocket(cleaner._id, fakeWs);
    assert.equal(isUserLive(cleaner._id), true);

    const doc = await notify(cleaner._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'Body',
    });
    await flushDeliveryQueue();

    const deliver = await NotificationJob.findOne({
      kind: 'deliver',
      notificationId: doc._id,
    });
    assert.equal(deliver.status, 'done');
    assert.equal(deliver.result.live, true);
    assert.ok(fakeWs.sent.length >= 1);

    const fallback = await NotificationJob.findOne({
      kind: 'email_fallback',
      notificationId: doc._id,
    });
    assert.equal(fallback, null, 'no email fallback when live delivered');
    detach();
  });

  it('schedules email fallback when offline and push misses', async () => {
    assert.equal(isUserLive(cleaner._id), false);
    assert.equal(emitNotificationToUser(cleaner._id, { title: 'x' }), false);

    const doc = await notify(cleaner._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'Body',
    });
    await flushDeliveryQueue();
    const deliver = await NotificationJob.findOne({
      kind: 'deliver',
      notificationId: doc._id,
    });
    assert.equal(deliver.status, 'done');
    assert.equal(deliver.result.live, false);
    assert.equal(deliver.result.push, false);

    const fallback = await NotificationJob.findOne({
      kind: 'email_fallback',
      notificationId: doc._id,
    });
    assert.ok(fallback, 'email fallback scheduled when live+push miss');
    assert.equal(fallback.status, 'pending');
  });

  it('notifyMany creates one inbox row and one deliver job per user', async () => {
    const docs = await notifyMany([cleaner._id, business._id], {
      type: 'cancelled',
      title: 'Cancelled',
      body: 'Job cancelled',
    });
    assert.equal(docs.length, 2);
    assert.equal(await Notification.countDocuments(), 2);
    assert.equal(await NotificationJob.countDocuments({ kind: 'deliver' }), 2);
  });

  it('treats new_offer, assigned, cancelled as urgent', () => {
    assert.ok(URGENT_TYPES.has('new_offer'));
    assert.ok(URGENT_TYPES.has('assigned'));
    assert.ok(URGENT_TYPES.has('cancelled'));
    assert.equal(URGENT_TYPES.has('matching_started'), false);
  });

  it('registers push devices for cleaner/business tokens', async () => {
    const device = await PushDevice.findOneAndUpdate(
      { token: 'tok-web-1' },
      {
        userId: cleaner._id,
        token: 'tok-web-1',
        platform: 'web',
        active: true,
        lastSeenAt: new Date(),
      },
      { upsert: true, new: true }
    );
    assert.equal(device.platform, 'web');
    assert.equal(String(device.userId), String(cleaner._id));
  });
});
