/**
 * Negative tests: business adding a cleaning need (POST /api/requests).
 * Invalid / forbidden use — expects clear rejection, no orphan request.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { Business } from '../src/models/Business.js';
import { BusinessMembership } from '../src/models/BusinessMembership.js';
import { BusinessPayment } from '../src/models/BusinessPayment.js';
import { Transaction } from '../src/models/Transaction.js';
import { Notification } from '../src/models/Notification.js';
import { RequestOffer } from '../src/models/RequestOffer.js';
import { RequestEvent } from '../src/models/RequestEvent.js';
import { MINIMUM_WAGE_PER_HOUR } from '../src/services/jobPay.js';
import { signToken } from '../src/middleware/auth.js';
import requestsRouter from '../src/routes/requests.js';
import { config } from '../src/config.js';
import bcrypt from 'bcryptjs';

const hub = { lat: 51.5074, lng: -0.1278 };

async function makeBusinessUser(label) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await User.create({
    name: `${label} Owner`,
    email: `${label}-${stamp}@test.com`,
    passwordHash: await bcrypt.hash('x', 8),
    role: 'business',
  });
  const business = await Business.create({
    name: `${label} Co`,
    phone: '+441234567890',
    address: `1 ${label} Street, London`,
    latitude: hub.lat,
    longitude: hub.lng,
    createdBy: user._id,
  });
  await BusinessMembership.create({
    businessId: business._id,
    userId: user._id,
    memberRole: 'owner',
  });
  return { user, business };
}

function futureSchedule(hoursFromNow = 24, durationHours = 8) {
  const scheduleStart = new Date(Date.now() + hoursFromNow * 3600_000);
  scheduleStart.setMinutes(0, 0, 0);
  const scheduleEnd = new Date(scheduleStart.getTime() + durationHours * 3600_000);
  return {
    scheduleStart: scheduleStart.toISOString(),
    scheduleEnd: scheduleEnd.toISOString(),
  };
}

function validBody(businessId, overrides = {}) {
  return {
    serviceDetails: 'Office deep clean',
    ...futureSchedule(),
    address: '10 Downing Street, London',
    latitude: hub.lat,
    longitude: hub.lng,
    businessId: String(businessId),
    payRatePerHour: MINIMUM_WAGE_PER_HOUR,
    ...overrides,
  };
}

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
  app.use('/api/requests', requestsRouter);
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

async function api(base, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

describe('business add cleaning need — negative', () => {
  let base;
  let server;
  let businessUser;
  let business;
  let otherBusiness;
  let cleaner;
  let bizToken;
  let cleanerToken;

  before(async () => {
    process.env.MONGO_URI =
      process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trade_booking_test_bizneg';
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    ({ server, base } = await startApp());
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await disconnectDb();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      CleaningRequest.deleteMany({}),
      Business.deleteMany({}),
      BusinessMembership.deleteMany({}),
      BusinessPayment.deleteMany({}),
      Transaction.deleteMany({}),
      Notification.deleteMany({}),
      RequestOffer.deleteMany({}),
      RequestEvent.deleteMany({}),
    ]);

    const mine = await makeBusinessUser('biz-neg');
    businessUser = mine.user;
    business = mine.business;

    const other = await makeBusinessUser('other-neg');
    otherBusiness = other.business;

    cleaner = await makeUser({
      name: 'Cleaner',
      email: `cleaner-neg-${Date.now()}@test.com`,
      role: 'cleaner',
    });

    bizToken = signToken(businessUser);
    cleanerToken = signToken(cleaner);
  });

  async function assertNoRequestCreated() {
    const count = await CleaningRequest.countDocuments({});
    assert.equal(count, 0, 'rejected post must not leave a cleaning request');
    const payCount = await BusinessPayment.countDocuments({});
    assert.equal(payCount, 0, 'rejected post must not leave a pay record');
  }

  it('rejects unauthenticated post', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      body: validBody(business._id),
    });
    assert.equal(res.status, 401);
    await assertNoRequestCreated();
  });

  it('rejects cleaner role', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: cleanerToken,
      body: validBody(business._id),
    });
    assert.equal(res.status, 403);
    await assertNoRequestCreated();
  });

  it('rejects missing businessId', async () => {
    const body = validBody(business._id);
    delete body.businessId;
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /businessId/i);
    await assertNoRequestCreated();
  });

  it('rejects businessId the user does not belong to', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(otherBusiness._id),
    });
    assert.equal(res.status, 403);
    assert.match(String(res.json?.error || ''), /member/i);
    await assertNoRequestCreated();
  });

  it('rejects missing serviceDetails', async () => {
    const body = validBody(business._id);
    delete body.serviceDetails;
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /serviceDetails/i);
    await assertNoRequestCreated();
  });

  it('rejects missing address', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { address: '' }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /address/i);
    await assertNoRequestCreated();
  });

  it('rejects non-numeric coordinates', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { latitude: 'north', longitude: 'east' }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /latitude|longitude/i);
    await assertNoRequestCreated();
  });

  it('rejects null coordinates (must not coerce to 0,0)', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { latitude: null, longitude: null }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /latitude|longitude/i);
    await assertNoRequestCreated();
  });

  it('rejects blank-string coordinates (must not coerce to 0,0)', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { latitude: '', longitude: '  ' }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /latitude|longitude/i);
    await assertNoRequestCreated();
  });

  it('rejects coordinates out of range', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { latitude: 999, longitude: 0 }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /range/i);
    await assertNoRequestCreated();
  });

  it('rejects missing schedule', async () => {
    const body = validBody(business._id);
    delete body.scheduleStart;
    delete body.scheduleEnd;
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /schedule/i);
    await assertNoRequestCreated();
  });

  it('rejects invalid schedule dates', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, {
        scheduleStart: 'not-a-date',
        scheduleEnd: 'also-bad',
      }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /Invalid schedule/i);
    await assertNoRequestCreated();
  });

  it('rejects scheduleEnd before scheduleStart', async () => {
    const start = new Date(Date.now() + 48 * 3600_000);
    const end = new Date(start.getTime() - 3600_000);
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, {
        scheduleStart: start.toISOString(),
        scheduleEnd: end.toISOString(),
      }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /after scheduleStart/i);
    await assertNoRequestCreated();
  });

  it('rejects scheduleStart in the past', async () => {
    const start = new Date(Date.now() - 2 * 3600_000);
    const end = new Date(Date.now() + 2 * 3600_000);
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, {
        scheduleStart: start.toISOString(),
        scheduleEnd: end.toISOString(),
      }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /past/i);
    await assertNoRequestCreated();
  });

  it('rejects missing payRatePerHour', async () => {
    const body = validBody(business._id);
    delete body.payRatePerHour;
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /payRatePerHour/i);
    await assertNoRequestCreated();
  });

  it('rejects non-numeric payRatePerHour', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { payRatePerHour: 'cheap' }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /number/i);
    await assertNoRequestCreated();
  });

  it('rejects payRatePerHour below minimum wage', async () => {
    const res = await api(base, '/api/requests', {
      method: 'POST',
      token: bizToken,
      body: validBody(business._id, { payRatePerHour: MINIMUM_WAGE_PER_HOUR - 0.01 }),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /at least/i);
    await assertNoRequestCreated();
  });

  it('rejects zero / negative payRatePerHour', async () => {
    for (const rate of [0, -5]) {
      const res = await api(base, '/api/requests', {
        method: 'POST',
        token: bizToken,
        body: validBody(business._id, { payRatePerHour: rate }),
      });
      assert.equal(res.status, 400, `rate ${rate} should be rejected`);
    }
    await assertNoRequestCreated();
  });
});
