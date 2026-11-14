import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { CleaningAgency } from '../src/models/CleaningAgency.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { AgencyMembership } from '../src/models/AgencyMembership.js';
import { JobAssignment } from '../src/models/JobAssignment.js';
import { StaffJobPay } from '../src/models/StaffJobPay.js';
import { createAgencyStaff } from '../src/services/agencyService.js';
import { assignAgencyStaff } from '../src/services/requestService.js';
import { _takeRecordedEmails } from '../src/services/emailQueue.js';

describe('agency staff emails', () => {
  let owner;
  let agency;
  let request;

  before(async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/trade_booking_test_staff_email';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      CleaningAgency.deleteMany({}),
      CleaningRequest.deleteMany({}),
      AgencyMembership.deleteMany({}),
      JobAssignment.deleteMany({}),
      StaffJobPay.deleteMany({}),
    ]);

    owner = await User.create({
      name: 'Owner',
      email: 'mail-owner@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    agency = await CleaningAgency.create({
      name: 'Mail Agency',
      phone: '+440200000222',
      address: '2 Test Street, London',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: owner._id,
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: owner._id,
      memberRole: 'owner',
    });
    request = await CleaningRequest.create({
      clientId: owner._id,
      serviceDetails: 'Office windows',
      scheduleStart: new Date('2026-12-01T09:00:00Z'),
      scheduleEnd: new Date('2026-12-01T17:00:00Z'),
      address: '22 Business Row, London',
      latitude: 51.5,
      longitude: -0.12,
      status: 'assigned',
      assignedAgencyId: agency._id,
      jobType: 'fixed',
      durationDays: 1,
      totalHours: 8,
      visitHours: 8,
    });
  });

  after(async () => {
    await disconnectDb();
  });

  it('emails a new staff profile and a job assignment, without the password', async () => {
    _takeRecordedEmails();
    const created = await createAgencyStaff(owner._id, agency._id, {
      name: 'Ada Cleaner',
      email: 'ada.mail@test.com',
      password: 'SecretPass99',
    });
    assert.equal(created.linkedExisting, false);

    const welcome = _takeRecordedEmails();
    assert.equal(welcome.length, 1);
    assert.equal(welcome[0].kind, 'staff_welcome');
    assert.equal(welcome[0].to, 'ada.mail@test.com');
    assert.match(welcome[0].subject, /Mail Agency created your staff profile/);
    assert.match(welcome[0].text, /Name: Ada Cleaner/);
    assert.match(welcome[0].text, /Agency: Mail Agency/);
    assert.equal(welcome[0].text.includes('SecretPass99'), false);
    assert.equal(welcome[0].html.includes('SecretPass99'), false);

    await assignAgencyStaff(request._id, agency._id, owner._id, {
      staffUserId: created.user.id,
      payRatePerHour: 13,
      allocatedHours: 4,
    });

    const assigned = _takeRecordedEmails();
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].kind, 'staff_assigned');
    assert.equal(assigned[0].to, 'ada.mail@test.com');
    assert.match(assigned[0].text, /Office windows/);
    assert.match(assigned[0].text, /22 Business Row, London/);
    assert.match(assigned[0].text, /Your hours: 4/);
    assert.match(assigned[0].text, /£13\.00 per hour, £52\.00 in total/);
    assert.match(assigned[0].text, /Confirm or decline/);
    assert.equal(assigned[0].text.includes('SecretPass99'), false);
  });

  it('does not email when an existing staff account is only linked', async () => {
    const other = await CleaningAgency.create({
      name: 'Other Agency',
      phone: '+440200000333',
      address: '3 Test Street, London',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: owner._id,
    });
    await AgencyMembership.create({
      agencyId: other._id,
      userId: owner._id,
      memberRole: 'owner',
    });
    _takeRecordedEmails();
    const linked = await createAgencyStaff(owner._id, other._id, {
      name: 'Ada Cleaner',
      email: 'ada.mail@test.com',
      password: 'SecretPass99',
    });
    assert.equal(linked.linkedExisting, true);
    assert.equal(_takeRecordedEmails().length, 0);
  });
});
