import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { Business } from '../src/models/Business.js';
import { CleaningAgency } from '../src/models/CleaningAgency.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { AgencyMembership } from '../src/models/AgencyMembership.js';
import { BusinessPayment } from '../src/models/BusinessPayment.js';
import { Transaction } from '../src/models/Transaction.js';
import { listAgencyPayments } from '../src/services/paymentService.js';

describe('agency payment list', () => {
  let owner;
  let outsider;
  let agency;

  before(async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/trade_booking_test_agency_payments';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      CleaningAgency.deleteMany({}),
      CleaningRequest.deleteMany({}),
      AgencyMembership.deleteMany({}),
      BusinessPayment.deleteMany({}),
      Transaction.deleteMany({}),
    ]);

    owner = await User.create({
      name: 'Owner',
      email: 'pay-owner@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    outsider = await User.create({
      name: 'Outsider',
      email: 'pay-outsider@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    const client = await User.create({
      name: 'Ada Client',
      email: 'pay-client@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'client',
    });
    const business = await Business.create({
      name: 'Offer Demo Ltd',
      phone: '+440200000666',
      address: '22 Business Row, London',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: client._id,
    });
    agency = await CleaningAgency.create({
      name: 'Pay Agency',
      phone: '+440200000444',
      address: '4 Test Street, London',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: owner._id,
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: owner._id,
      memberRole: 'owner',
    });

    const paidJob = await CleaningRequest.create({
      clientId: client._id,
      businessId: business._id,
      serviceDetails: 'Paid lobby',
      scheduleStart: new Date('2026-12-01T09:00:00Z'),
      scheduleEnd: new Date('2026-12-01T17:00:00Z'),
      address: '1 Paid Street',
      latitude: 51.5,
      longitude: -0.12,
      status: 'completed',
      assignedAgencyId: agency._id,
    });
    const paidTx = await Transaction.create({
      requestId: paidJob._id,
      amount: 112,
      currency: 'GBP',
      status: 'paid',
      paidAt: new Date('2026-12-02T10:00:00Z'),
    });
    await BusinessPayment.create({
      businessId: business._id,
      requestId: paidJob._id,
      transactionId: paidTx._id,
      payRatePerHour: 14,
      minimumWagePerHour: 12.71,
      durationHours: 8,
    });

    const unpaidJob = await CleaningRequest.create({
      clientId: client._id,
      businessId: business._id,
      serviceDetails: 'Unpaid kitchen',
      scheduleStart: new Date('2026-12-03T09:00:00Z'),
      scheduleEnd: new Date('2026-12-03T17:00:00Z'),
      address: '2 Unpaid Street',
      latitude: 51.5,
      longitude: -0.12,
      status: 'assigned',
      assignedAgencyId: agency._id,
    });
    const unpaidTx = await Transaction.create({
      requestId: unpaidJob._id,
      amount: 56,
      currency: 'GBP',
      status: 'unpaid',
    });
    await BusinessPayment.create({
      businessId: business._id,
      requestId: unpaidJob._id,
      transactionId: unpaidTx._id,
      payRatePerHour: 14,
      minimumWagePerHour: 12.71,
      durationHours: 4,
    });

    await CleaningRequest.create({
      clientId: client._id,
      serviceDetails: 'Personal hallway',
      scheduleStart: new Date('2026-12-04T09:00:00Z'),
      scheduleEnd: new Date('2026-12-04T12:00:00Z'),
      address: '3 Home Lane',
      latitude: 51.5,
      longitude: -0.12,
      status: 'assigned',
      assignedAgencyId: agency._id,
    });

    const otherAgency = await CleaningAgency.create({
      name: 'Other Agency',
      phone: '+440200000555',
      address: '5 Test Street, London',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: outsider._id,
    });
    await CleaningRequest.create({
      clientId: client._id,
      businessId: business._id,
      serviceDetails: 'Someone else job',
      scheduleStart: new Date('2026-12-05T09:00:00Z'),
      scheduleEnd: new Date('2026-12-05T17:00:00Z'),
      address: '9 Other Road',
      latitude: 51.5,
      longitude: -0.12,
      status: 'assigned',
      assignedAgencyId: otherAgency._id,
    });
  });

  after(async () => {
    await disconnectDb();
  });

  it('lists paid business payments, unpaid business payments, and personal jobs', async () => {
    const rows = await listAgencyPayments({ id: owner._id, role: 'cleaning_agency' }, agency._id);
    const byJob = Object.fromEntries(rows.map((row) => [row.jobLabel, row]));
    assert.equal(rows.length, 3);
    assert.equal(byJob['Paid lobby'].status, 'paid');
    assert.equal(byJob['Paid lobby'].amount, 112);
    assert.equal(byJob['Paid lobby'].payerName, 'Offer Demo Ltd');
    assert.equal(byJob['Paid lobby'].payerKind, 'business');
    assert.equal(byJob['Unpaid kitchen'].status, 'unpaid');
    assert.equal(byJob['Personal hallway'].status, 'none');
    assert.equal(byJob['Personal hallway'].payerName, 'Ada Client');
    assert.equal(byJob['Personal hallway'].payerKind, 'client');
    assert.equal(byJob['Personal hallway'].amount, null);
    assert.equal(byJob['Someone else job'], undefined);
  });

  it('rejects an agency owner who does not belong to this agency', async () => {
    await assert.rejects(
      () => listAgencyPayments({ id: outsider._id, role: 'cleaning_agency' }, agency._id),
      /Forbidden/
    );
  });
});
