/**
 * Agency booking path: interest → company pick → accept → assign staff → confirm.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { Notification } from '../src/models/Notification.js';
import { CleaningAgency } from '../src/models/CleaningAgency.js';
import { Business } from '../src/models/Business.js';
import { AgencyMembership } from '../src/models/AgencyMembership.js';
import { RequestOffer } from '../src/models/RequestOffer.js';
import { RequestEvent } from '../src/models/RequestEvent.js';
import { AgencyJobInterest } from '../src/models/AgencyJobInterest.js';
import { JobAssignment } from '../src/models/JobAssignment.js';
import { StaffJobPay } from '../src/models/StaffJobPay.js';
import {
  createCleaningRequest,
  expressAgencyInterest,
  pickAgencyForRequest,
  agencyAcceptRequest,
  assignAgencyStaff,
  assignAgencyStaffMany,
  removeAgencyStaff,
  staffRespondToAssignment,
  advanceBooking,
} from '../src/services/requestService.js';
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

describe('cleaning agency booking', () => {
  let client;
  let owner;
  let staff;
  let agency;

  before(async () => {
    process.env.MONGO_URI =
      process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trade_booking_test_agency';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      CleaningRequest.deleteMany({}),
      Notification.deleteMany({}),
      CleaningAgency.deleteMany({}),
      AgencyMembership.deleteMany({}),
      RequestOffer.deleteMany({}),
      RequestEvent.deleteMany({}),
      AgencyJobInterest.deleteMany({}),
      JobAssignment.deleteMany({}),
      StaffJobPay.deleteMany({}),
    ]);

    client = await makeUser({ name: 'Client', email: 'ag-client@test.com', role: 'client' });
    owner = await makeUser({
      name: 'Owner',
      email: 'ag-owner@test.com',
      role: 'cleaning_agency',
    });
    staff = await makeUser({
      name: 'Staff',
      email: 'ag-staff@test.com',
      role: 'agency_staff',
      isAvailable: true,
      currentLocation: { lat: hub.lat, lng: hub.lng, updatedAt: new Date() },
    });
    agency = await CleaningAgency.create({
      name: 'Test Agency',
      phone: '07000000001',
      address: '1 Agency St',
      latitude: hub.lat,
      longitude: hub.lng,
      createdBy: owner._id,
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: owner._id,
      memberRole: 'owner',
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: staff._id,
      memberRole: 'staff',
    });
  });

  after(async () => {
    await new Promise((r) => setTimeout(r, 750));
    await disconnectDb();
  });

  it('notifies nearby agency; company picks; agency locks; staff confirms; agency progresses', async () => {
    const scheduleStart = new Date(Date.now() + 86400000);
    scheduleStart.setHours(9, 0, 0, 0);
    const scheduleEnd = new Date(scheduleStart);
    scheduleEnd.setDate(scheduleEnd.getDate() + 1);
    scheduleEnd.setHours(17, 0, 0, 0);

    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Agency job',
      scheduleStart,
      scheduleEnd,
      address: '1 Job St',
      latitude: hub.lat,
      longitude: hub.lng,
    });
    assert.ok(req.notifiedAgencyCount >= 1);
    const agencyOffer = await RequestOffer.findOne({
      requestId: req._id,
      kind: 'agency',
      agencyId: agency._id,
    });
    assert.ok(agencyOffer);
    assert.equal(agencyOffer.status, 'pending');

    await expressAgencyInterest(req._id, agency._id, owner._id);
    await pickAgencyForRequest(req._id, agency._id, {
      id: client._id.toString(),
      role: 'client',
    });
    const locked = await agencyAcceptRequest(req._id, agency._id, owner._id);
    assert.equal(locked.status, 'assigned');
    assert.equal(String(locked.assignedAgencyId), String(agency._id));

    await assignAgencyStaff(req._id, agency._id, owner._id, {
      staffUserId: staff._id,
      payRatePerHour: 14,
      allocatedHours: 16,
    });
    const pay = await StaffJobPay.findOne({ requestId: req._id, staffUserId: staff._id });
    assert.ok(pay);
    assert.equal(pay.payRatePerHour, 14);
    assert.equal(pay.durationHours, 16);
    assert.equal(pay.totalAmount, 224);

    await staffRespondToAssignment(req._id, staff._id, 'confirm');
    const assignment = await JobAssignment.findOne({
      requestId: req._id,
      staffUserId: staff._id,
    });
    assert.equal(assignment.confirmStatus, 'confirmed');

    const progressed = await advanceBooking(
      req._id,
      { id: owner._id.toString(), role: 'cleaning_agency' },
      'en_route'
    );
    assert.equal(progressed.status, 'en_route');

    await assert.rejects(
      () =>
        advanceBooking(req._id, { id: staff._id.toString(), role: 'agency_staff' }, 'on_site'),
      /Only the assigned agency/i
    );
  });

  it('assigns several staff, pays each for the job hours, and recalculates when one is removed', async () => {
    const staffB = await makeUser({
      name: 'Staff B',
      email: 'ag-staff-b@test.com',
      role: 'agency_staff',
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: staffB._id,
      memberRole: 'staff',
    });

    const scheduleStart = new Date(Date.now() + 2 * 86400000);
    scheduleStart.setHours(9, 0, 0, 0);
    const scheduleEnd = new Date(scheduleStart);
    scheduleEnd.setHours(13, 0, 0, 0);
    const req = await createCleaningRequest({
      clientId: client._id,
      serviceDetails: 'Crew job',
      scheduleStart,
      scheduleEnd,
      address: '2 Job St',
      latitude: hub.lat,
      longitude: hub.lng,
    });
    await expressAgencyInterest(req._id, agency._id, owner._id);
    await pickAgencyForRequest(req._id, agency._id, {
      id: client._id.toString(),
      role: 'client',
    });
    await agencyAcceptRequest(req._id, agency._id, owner._id);

    await assert.rejects(
      () =>
        assignAgencyStaff(req._id, agency._id, owner._id, {
          staffUserId: staff._id,
          payRatePerHour: 13,
          allocatedHours: 5,
        }),
      /Only 4 hours are left/
    );

    const assigned = await assignAgencyStaffMany(req._id, agency._id, owner._id, [
      { staffUserId: staff._id, payRatePerHour: 13, allocatedHours: 3 },
      { staffUserId: staffB._id, payRatePerHour: 15, allocatedDays: 0.125 },
    ]);
    assert.equal(assigned.assignments.length, 2);
    const byName = Object.fromEntries(
      assigned.assignments.map((row) => [row.staffUserId.name, row.pay.totalAmount])
    );
    assert.equal(byName.Staff, 39);
    assert.equal(byName['Staff B'], 15);
    assert.equal(assigned.crewPayTotal, 54);
    assert.equal(assigned.hoursRemaining, 0);

    const left = await removeAgencyStaff(req._id, agency._id, owner._id, staff._id);
    assert.equal(left.assignments.length, 1);
    assert.equal(left.assignments[0].pay.totalAmount, 15);
    assert.equal(left.crewPayTotal, 15);
    assert.equal(left.hoursRemaining, 3);
    const removedPay = await StaffJobPay.findOne({
      requestId: req._id,
      staffUserId: staff._id,
    });
    assert.equal(removedPay, null);
  });

  it('creates business jobs as a fixed hour total, an open-ended repeat, or a repeat until a date', async () => {
    const business = await Business.create({
      name: 'Hours Co',
      phone: '07000000002',
      address: '1 Hour St',
      latitude: hub.lat,
      longitude: hub.lng,
      createdBy: owner._id,
    });
    const start = new Date(Date.now() + 3 * 86400000);
    start.setHours(9, 0, 0, 0);
    const until = new Date(start);
    until.setDate(until.getDate() + 14);
    const common = {
      clientId: owner._id,
      businessId: business._id,
      scheduleStart: start,
      address: '1 Hour St',
      latitude: hub.lat,
      longitude: hub.lng,
      payRatePerHour: 13,
    };

    const fixed = await createCleaningRequest({
      ...common,
      serviceDetails: 'Fixed days',
      jobType: 'fixed',
      durationDays: 1,
      durationExtraHours: 2,
    });
    assert.equal(fixed.totalHours, 10);
    assert.equal(fixed.pay.durationHours, 10);
    assert.equal(fixed.pay.totalAmount, 130);

    const forever = await createCleaningRequest({
      ...common,
      serviceDetails: 'Forever clean',
      jobType: 'recurring_indefinite',
      durationDays: 1,
      durationExtraHours: 0,
    });
    assert.equal(forever.visitHours, 8);
    assert.equal(forever.visitCount, null);
    assert.equal(forever.totalHours, 8);
    assert.equal(forever.pay.totalAmount, 104);

    const untilJob = await createCleaningRequest({
      ...common,
      serviceDetails: 'Until clean',
      jobType: 'recurring_until',
      durationDays: 1,
      durationExtraHours: 0,
      recurrenceUntil: until,
    });
    assert.equal(untilJob.visitCount, 3);
    assert.equal(untilJob.totalHours, 24);
    assert.equal(untilJob.pay.totalAmount, 312);
  });
});
