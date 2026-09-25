/**
 * Negative tests for notification goals in quick-update.md.
 * Unexpected / invalid use — not service outages.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Notification } from '../src/models/Notification.js';
import { NotificationJob } from '../src/models/NotificationJob.js';
import { PushDevice } from '../src/models/PushDevice.js';
import { notify, notifyMany } from '../src/services/notify.js';
import {
  flushDeliveryQueue,
  enqueueDeliveries,
} from '../src/services/deliveryQueue.js';
import {
  emitNotificationToUser,
  _attachTestSocket,
  _resetRealtimeForTests,
} from '../src/services/realtime.js';
import { signToken } from '../src/middleware/auth.js';
import notificationsRouter from '../src/routes/notifications.js';
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

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
      });
    });
  });
}

async function api(base, path, { method = 'GET', token, body, timeoutMs } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = timeoutMs ? new AbortController() : null;
  const timer =
    timeoutMs &&
    setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('notification negative use (quick-update.md)', () => {
  let cleaner;
  let business;
  let client;
  let otherCleaner;
  let base;
  let server;

  before(async () => {
    process.env.MONGO_URI =
      process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trade_booking_test';
    config.mongoUri = process.env.MONGO_URI;
    config.notify.emailFallbackSeconds = 1;
    await connectDb();
    ({ server, base } = await startApp());
  });

  after(async () => {
    await new Promise((r) => server.close(r));
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
      email: 'neg-cleaner@test.com',
      role: 'cleaner',
    });
    business = await makeUser({
      name: 'Biz',
      email: 'neg-biz@test.com',
      role: 'business',
    });
    client = await makeUser({
      name: 'Client',
      email: 'neg-client@test.com',
      role: 'client',
    });
    otherCleaner = await makeUser({
      name: 'Other',
      email: 'neg-other@test.com',
      role: 'cleaner',
    });
  });

  // --- 1. Inbox source of truth ---

  it('rejects inbox list with no auth', async () => {
    const res = await api(base, '/api/notifications');
    assert.equal(res.status, 401);
  });

  it('rejects marking another user notification as read', async () => {
    const note = await notify(cleaner._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'Body',
    });
    const token = signToken(otherCleaner);
    const res = await api(base, `/api/notifications/${note._id}/read`, {
      method: 'POST',
      token,
    });
    assert.equal(res.status, 404);
    const still = await Notification.findById(note._id);
    assert.equal(still.read, false);
  });

  it('rejects mark-read with garbage id (must respond, not hang)', async () => {
    const token = signToken(cleaner);
    const res = await api(base, '/api/notifications/not-an-objectid/read', {
      method: 'POST',
      token,
      timeoutMs: 3000,
    });
    assert.equal(res.status, 400);
  });

  it('mark-read twice stays read (idempotent)', async () => {
    const note = await notify(cleaner._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'Body',
    });
    const token = signToken(cleaner);
    const first = await api(base, `/api/notifications/${note._id}/read`, {
      method: 'POST',
      token,
    });
    const second = await api(base, `/api/notifications/${note._id}/read`, {
      method: 'POST',
      token,
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.json.read, true);
  });

  it('notify with empty title fails validation and does not enqueue', async () => {
    await assert.rejects(
      () =>
        notify(cleaner._id, {
          type: 'new_offer',
          title: '',
          body: 'Body',
        }),
      /validation|required|Path `title`/i
    );
    assert.equal(await Notification.countDocuments(), 0);
    assert.equal(await NotificationJob.countDocuments(), 0);
  });

  it('notifyMany with empty list is a no-op', async () => {
    const docs = await notifyMany([], {
      type: 'cancelled',
      title: 'Cancelled',
      body: 'Gone',
    });
    assert.deepEqual(docs, []);
    assert.equal(await Notification.countDocuments(), 0);
    assert.equal(await NotificationJob.countDocuments(), 0);
  });

  it('enqueueDeliveries(null) does not throw', async () => {
    await enqueueDeliveries(null);
    await enqueueDeliveries([]);
    assert.equal(await NotificationJob.countDocuments(), 0);
  });

  // --- 2. Live WebSocket ---

  it('closed socket does not count as live delivery', async () => {
    const fakeWs = {
      readyState: 3, // CLOSED
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
      close() {},
    };
    const detach = _attachTestSocket(cleaner._id, fakeWs);
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
    assert.equal(deliver.result.live, false);
    assert.equal(fakeWs.sent.length, 0);
    const fallback = await NotificationJob.findOne({
      kind: 'email_fallback',
      notificationId: doc._id,
    });
    assert.ok(fallback, 'offline closed socket should still get email fallback path');
    detach();
  });

  it('socket that throws on send does not crash delivery', async () => {
    const fakeWs = {
      readyState: 1,
      send() {
        throw new Error('boom');
      },
      close() {},
    };
    const detach = _attachTestSocket(cleaner._id, fakeWs);
    assert.equal(emitNotificationToUser(cleaner._id, { title: 'x' }), false);
    const doc = await notify(cleaner._id, {
      type: 'assigned',
      title: 'Assigned',
      body: 'You got it',
    });
    await flushDeliveryQueue();
    const deliver = await NotificationJob.findOne({
      kind: 'deliver',
      notificationId: doc._id,
    });
    assert.equal(deliver.status, 'done');
    assert.equal(deliver.result.live, false);
    detach();
  });

  // --- 3. Device / browser push registration ---

  it('client role cannot register a push device', async () => {
    const token = signToken(client);
    const res = await api(base, '/api/notifications/devices', {
      method: 'POST',
      token,
      body: { token: 'tok-client', platform: 'web' },
    });
    assert.equal(res.status, 403);
    assert.equal(await PushDevice.countDocuments(), 0);
  });

  it('rejects device register with empty token', async () => {
    const token = signToken(cleaner);
    const res = await api(base, '/api/notifications/devices', {
      method: 'POST',
      token,
      body: { token: '   ', platform: 'web' },
    });
    assert.equal(res.status, 400);
  });

  it('rejects device register with bad platform', async () => {
    const token = signToken(cleaner);
    const res = await api(base, '/api/notifications/devices', {
      method: 'POST',
      token,
      body: { token: 'tok-1', platform: 'ios' },
    });
    assert.equal(res.status, 400);
  });

  it('rejects device register with no auth', async () => {
    const res = await api(base, '/api/notifications/devices', {
      method: 'POST',
      body: { token: 'tok-1', platform: 'web' },
    });
    assert.equal(res.status, 401);
  });

  it('same FCM token re-registered by second user is rejected', async () => {
    const tokA = signToken(cleaner);
    const tokB = signToken(otherCleaner);
    const first = await api(base, '/api/notifications/devices', {
      method: 'POST',
      token: tokA,
      body: { token: 'shared-fcm-token', platform: 'web' },
    });
    assert.equal(first.status, 200);
    const second = await api(base, '/api/notifications/devices', {
      method: 'POST',
      token: tokB,
      body: { token: 'shared-fcm-token', platform: 'android' },
    });
    assert.equal(second.status, 409);
    const devices = await PushDevice.find({ token: 'shared-fcm-token' });
    assert.equal(devices.length, 1);
    assert.equal(String(devices[0].userId), String(cleaner._id));
    assert.equal(devices[0].platform, 'web');
  });

  it('delete device without token is rejected', async () => {
    const token = signToken(cleaner);
    const res = await api(base, '/api/notifications/devices', {
      method: 'DELETE',
      token,
    });
    assert.equal(res.status, 400);
  });

  it('user cannot deactivate another users token via delete', async () => {
    await PushDevice.create({
      userId: cleaner._id,
      token: 'cleaner-only-tok',
      platform: 'web',
      active: true,
    });
    const token = signToken(otherCleaner);
    const res = await api(base, '/api/notifications/devices?token=cleaner-only-tok', {
      method: 'DELETE',
      token,
    });
    assert.equal(res.status, 200);
    const device = await PushDevice.findOne({ token: 'cleaner-only-tok' });
    assert.equal(device.active, true, 'other user delete must not deactivate');
  });

  it('non-urgent type does not schedule push email fallback', async () => {
    const doc = await notify(cleaner._id, {
      type: 'matching_started',
      title: 'Matching',
      body: 'Looking',
    });
    await flushDeliveryQueue();
    const deliver = await NotificationJob.findOne({
      kind: 'deliver',
      notificationId: doc._id,
    });
    assert.equal(deliver.status, 'done');
    assert.equal(deliver.result.push, false);
    const fallback = await NotificationJob.findOne({
      kind: 'email_fallback',
      notificationId: doc._id,
    });
    assert.equal(fallback, null);
  });

  // --- 4. Queue odd use ---

  it('duplicate notify creates two inbox rows and two deliver jobs', async () => {
    await notify(cleaner._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'One',
    });
    await notify(cleaner._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'One',
    });
    assert.equal(await Notification.countDocuments({ userId: cleaner._id }), 2);
    assert.equal(
      await NotificationJob.countDocuments({ kind: 'deliver', userId: cleaner._id }),
      2
    );
  });

  it('rapid double flush does not leave jobs stuck', async () => {
    await notify(cleaner._id, {
      type: 'cancelled',
      title: 'Cancelled',
      body: 'Stopped',
    });
    await Promise.all([flushDeliveryQueue(), flushDeliveryQueue()]);
    const pending = await NotificationJob.countDocuments({ status: 'pending', kind: 'deliver' });
    assert.equal(pending, 0);
  });

  // --- 5. Email role / fallback ---

  it('client user urgent notify gets inbox but no email fallback job', async () => {
    const doc = await notify(client._id, {
      type: 'new_offer',
      title: 'Offer',
      body: 'Should not email client as cleaner alert',
    });
    await flushDeliveryQueue();
    const inbox = await Notification.findById(doc._id);
    assert.ok(inbox);
    const deliver = await NotificationJob.findOne({
      kind: 'deliver',
      notificationId: doc._id,
    });
    assert.equal(deliver.status, 'done');
    assert.equal(deliver.result.push, false);
    const fallback = await NotificationJob.findOne({
      kind: 'email_fallback',
      notificationId: doc._id,
    });
    assert.equal(fallback, null);
  });

  it('business can register push; spam re-register is upsert not duplicate', async () => {
    const token = signToken(business);
    for (let i = 0; i < 5; i++) {
      const res = await api(base, '/api/notifications/devices', {
        method: 'POST',
        token,
        body: { token: 'biz-tok', platform: 'web' },
      });
      assert.equal(res.status, 200);
    }
    assert.equal(await PushDevice.countDocuments({ token: 'biz-tok' }), 1);
  });
});
