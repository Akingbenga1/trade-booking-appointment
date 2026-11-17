import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { Business } from '../src/models/Business.js';
import { BusinessMembership } from '../src/models/BusinessMembership.js';
import { CleaningAgency } from '../src/models/CleaningAgency.js';
import { AgencyMembership } from '../src/models/AgencyMembership.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { AgencyJobInterest } from '../src/models/AgencyJobInterest.js';
import { listAgenciesForBusiness } from '../src/services/businessAgencies.js';

describe('business agency board', () => {
  let owner;
  let other;
  let business;
  let otherBusiness;

  before(async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/trade_booking_test_agencies';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      BusinessMembership.deleteMany({}),
      CleaningAgency.deleteMany({}),
      AgencyMembership.deleteMany({}),
      CleaningRequest.deleteMany({}),
      AgencyJobInterest.deleteMany({}),
    ]);

    owner = await User.create({
      name: 'Biz Owner',
      email: 'agencies-biz@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'business',
    });
    other = await User.create({
      name: 'Other Biz',
      email: 'agencies-other@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'business',
    });
    const agencyOwner = await User.create({
      name: 'Agency Owner',
      email: 'agencies-agency@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });

    business = await Business.create({
      name: 'Near Ltd',
      phone: '+440200000111',
      address: '1 High Street',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: owner._id,
    });
    otherBusiness = await Business.create({
      name: 'Other Ltd',
      phone: '+440200000222',
      address: '9 Other Road',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: other._id,
    });
    await BusinessMembership.create({ businessId: business._id, userId: owner._id, memberRole: 'owner' });
    await BusinessMembership.create({
      businessId: otherBusiness._id,
      userId: other._id,
      memberRole: 'owner',
    });

    const near = await CleaningAgency.create({
      name: 'Near Agency',
      phone: '+440200000301',
      address: '2 High Street',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: agencyOwner._id,
    });
    const far = await CleaningAgency.create({
      name: 'Far Agency',
      phone: '+440200000302',
      address: 'Far Away',
      latitude: 53.5,
      longitude: -2.2,
      createdBy: agencyOwner._id,
    });
    const idle = await CleaningAgency.create({
      name: 'Idle Agency',
      phone: '+440200000303',
      address: 'Next Door',
      latitude: 51.501,
      longitude: -0.121,
      createdBy: agencyOwner._id,
    });

    const onDuty = await User.create({
      name: 'On Duty',
      email: 'agencies-staff@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'agency_staff',
      isAvailable: true,
      currentLocation: { lat: 51.5, lng: -0.12, updatedAt: new Date() },
    });
    const offDuty = await User.create({
      name: 'Off Duty',
      email: 'agencies-off@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'agency_staff',
      isAvailable: false,
      currentLocation: { lat: 51.501, lng: -0.121, updatedAt: new Date() },
    });
    const farStaff = await User.create({
      name: 'Far Staff',
      email: 'agencies-far-staff@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'agency_staff',
      isAvailable: true,
      currentLocation: { lat: 53.5, lng: -2.2, updatedAt: new Date() },
    });
    await AgencyMembership.create({ agencyId: near._id, userId: onDuty._id, memberRole: 'staff' });
    await AgencyMembership.create({ agencyId: idle._id, userId: offDuty._id, memberRole: 'staff' });
    await AgencyMembership.create({ agencyId: far._id, userId: farStaff._id, memberRole: 'staff' });

    const start = new Date(Date.now() + 86400000);
    const job = await CleaningRequest.create({
      clientId: owner._id,
      businessId: business._id,
      serviceDetails: 'Lobby clean',
      scheduleStart: start,
      scheduleEnd: new Date(start.getTime() + 4 * 3600000),
      address: business.address,
      latitude: business.latitude,
      longitude: business.longitude,
      status: 'open',
    });
    const otherJob = await CleaningRequest.create({
      clientId: other._id,
      businessId: otherBusiness._id,
      serviceDetails: 'Other lobby',
      scheduleStart: start,
      scheduleEnd: new Date(start.getTime() + 4 * 3600000),
      address: otherBusiness.address,
      latitude: otherBusiness.latitude,
      longitude: otherBusiness.longitude,
      status: 'open',
    });
    await AgencyJobInterest.create({
      requestId: job._id,
      agencyId: near._id,
      status: 'interested',
      expressedAt: new Date(),
    });
    await AgencyJobInterest.create({
      requestId: otherJob._id,
      agencyId: far._id,
      status: 'interested',
      expressedAt: new Date(),
    });
  });

  after(async () => {
    await disconnectDb();
  });

  it('splits available, nearby, and interested agencies for that business', async () => {
    const board = await listAgenciesForBusiness(
      { id: owner._id, role: 'business' },
      business._id
    );

    assert.deepEqual(
      board.available.map((row) => row.name).sort(),
      ['Far Agency', 'Near Agency']
    );
    assert.equal(board.available.find((row) => row.name === 'Near Agency').availableStaff, 1);
    assert.equal(board.available.some((row) => row.name === 'Idle Agency'), false);

    assert.deepEqual(
      board.nearby.map((row) => row.name).sort(),
      ['Idle Agency', 'Near Agency']
    );
    assert.equal(board.nearby.some((row) => row.name === 'Far Agency'), false);

    assert.equal(board.interested.length, 1);
    assert.equal(board.interested[0].name, 'Near Agency');
    assert.equal(board.interested[0].jobLabel, 'Lobby clean');
    assert.equal(board.interested[0].status, 'interested');
    assert.equal(board.interested[0].phone, '+440200000301');
    assert.equal('bankAccountNumber' in board.interested[0], false);

    await assert.rejects(
      () => listAgenciesForBusiness({ id: other._id, role: 'business' }, business._id),
      /Forbidden/
    );
  });
});
