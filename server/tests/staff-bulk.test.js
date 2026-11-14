import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { CleaningAgency } from '../src/models/CleaningAgency.js';
import { AgencyMembership } from '../src/models/AgencyMembership.js';
import { createAgencyStaffMany } from '../src/services/agencyService.js';
import { _takeRecordedEmails } from '../src/services/emailQueue.js';

describe('bulk agency staff creation', () => {
  let owner;
  let outsider;
  let agency;

  before(async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/trade_booking_test_staff_bulk';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      CleaningAgency.deleteMany({}),
      AgencyMembership.deleteMany({}),
    ]);

    owner = await User.create({
      name: 'Owner',
      email: 'bulk-owner@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    outsider = await User.create({
      name: 'Outsider',
      email: 'bulk-outsider@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    const client = await User.create({
      name: 'Client',
      email: 'bulk-client@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'client',
    });
    const existingStaff = await User.create({
      name: 'Existing Staff',
      email: 'bulk-existing@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'agency_staff',
    });
    agency = await CleaningAgency.create({
      name: 'Bulk Agency',
      phone: '+440200000111',
      address: '1 Test Street, London',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: owner._id,
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: owner._id,
      memberRole: 'owner',
    });
    assert.ok(client._id);
    assert.ok(existingStaff._id);
  });

  after(async () => {
    await disconnectDb();
  });

  it('creates new staff, links an existing staff account, and reports bad rows', async () => {
    _takeRecordedEmails();
    const result = await createAgencyStaffMany(owner._id, agency._id, [
      { name: 'Ada Cleaner', email: 'Ada.Cleaner@test.com', password: 'password123' },
      { name: 'Existing Staff', email: 'bulk-existing@test.com', password: 'password123' },
      { name: 'Client', email: 'bulk-client@test.com', password: 'password123' },
      { name: '', email: 'nobody@test.com', password: 'password123' },
    ]);

    assert.equal(result.created, 1);
    assert.equal(result.linked, 1);
    assert.equal(result.failed, 2);
    assert.equal(result.results[0].status, 'created');
    assert.equal(result.results[0].email, 'ada.cleaner@test.com');
    assert.equal(result.results[1].status, 'linked');
    assert.match(result.results[2].error, /another account type/i);
    assert.match(result.results[3].error, /name, email, and password/i);

    const membership = await AgencyMembership.findOne({
      agencyId: agency._id,
      userId: (await User.findOne({ email: 'ada.cleaner@test.com' }))._id,
    });
    assert.equal(membership.memberRole, 'staff');

    const welcome = _takeRecordedEmails().filter((mail) => mail.kind === 'staff_welcome');
    assert.equal(welcome.length, 1);
    assert.equal(welcome[0].to, 'ada.cleaner@test.com');
    assert.match(welcome[0].text, /Bulk Agency/);
    assert.match(welcome[0].text, /Sign-in email: ada.cleaner@test.com/);
    assert.equal(welcome[0].text.includes('password123'), false);
    assert.equal(welcome[0].html.includes('password123'), false);
  });

  it('rejects a person who is not an agency owner', async () => {
    await assert.rejects(
      () =>
        createAgencyStaffMany(outsider._id, agency._id, [
          { name: 'Nope', email: 'nope@test.com', password: 'password123' },
        ]),
      /Forbidden/
    );
  });

  it('rejects more than 100 rows before creating anyone', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      name: `Person ${index}`,
      email: `person${index}@test.com`,
      password: 'password123',
    }));
    await assert.rejects(
      () => createAgencyStaffMany(owner._id, agency._id, rows),
      /at most 100/i
    );
    const extra = await User.findOne({ email: 'person0@test.com' });
    assert.equal(extra, null);
  });
});
