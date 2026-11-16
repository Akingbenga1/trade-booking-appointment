import bcrypt from 'bcryptjs';
import { User } from './models/User.js';
import { CleaningRequest } from './models/CleaningRequest.js';
import { Notification } from './models/Notification.js';
import { NotificationJob } from './models/NotificationJob.js';
import { PushDevice } from './models/PushDevice.js';
import { Business } from './models/Business.js';
import { BusinessMembership } from './models/BusinessMembership.js';
import { CleaningAgency } from './models/CleaningAgency.js';
import { AgencyMembership } from './models/AgencyMembership.js';
import { RequestOffer } from './models/RequestOffer.js';
import { RequestEvent } from './models/RequestEvent.js';
import { AgencyJobInterest } from './models/AgencyJobInterest.js';
import { JobAssignment } from './models/JobAssignment.js';
import { StaffJobPay } from './models/StaffJobPay.js';
import { BusinessPayment } from './models/BusinessPayment.js';
import { Transaction } from './models/Transaction.js';
import {
  agencyAcceptRequest,
  assignAgencyStaff,
  createCleaningRequest,
  expressAgencyInterest,
  pickAgencyForRequest,
} from './services/requestService.js';

const password = 'password123';

async function upsertUser({ name, email, role, isAvailable, currentLocation }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.findOneAndUpdate(
    { email },
    {
      name,
      email,
      role,
      passwordHash,
      isDisabled: false,
      mustSetPassword: false,
      isAvailable: Boolean(isAvailable),
      currentLocation: currentLocation || undefined,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function seedDemo({ reset = true } = {}) {
  if (reset) {
    await Promise.all([
      CleaningRequest.deleteMany({}),
      Notification.deleteMany({}),
      NotificationJob.deleteMany({}),
      PushDevice.deleteMany({}),
      Business.deleteMany({}),
      BusinessMembership.deleteMany({}),
      CleaningAgency.deleteMany({}),
      AgencyMembership.deleteMany({}),
      RequestOffer.deleteMany({}),
      RequestEvent.deleteMany({}),
      AgencyJobInterest.deleteMany({}),
      JobAssignment.deleteMany({}),
      StaffJobPay.deleteMany({}),
      BusinessPayment.deleteMany({}),
      Transaction.deleteMany({}),
      User.deleteMany({}),
    ]);
  }

  const hub = { lat: 51.5074, lng: -0.1278 };

  await upsertUser({
    name: 'Ada Client',
    email: 'client@demo.com',
    role: 'client',
  });
  await upsertUser({
    name: 'Cleaner One',
    email: 'cleaner1@demo.com',
    role: 'cleaner',
    isAvailable: true,
    currentLocation: { lat: hub.lat + 0.01, lng: hub.lng + 0.01, updatedAt: new Date() },
  });
  await upsertUser({
    name: 'Cleaner Two',
    email: 'cleaner2@demo.com',
    role: 'cleaner',
    isAvailable: true,
    currentLocation: { lat: hub.lat - 0.008, lng: hub.lng + 0.005, updatedAt: new Date() },
  });
  await upsertUser({
    name: 'Cleaner Far',
    email: 'cleaner-far@demo.com',
    role: 'cleaner',
    isAvailable: true,
    currentLocation: { lat: 51.9, lng: -0.5, updatedAt: new Date() },
  });
  await upsertUser({
    name: 'Admin User',
    email: 'admin@demo.com',
    role: 'admin',
  });

  const agencyOwner = await upsertUser({
    name: 'Agency Owner',
    email: 'agency@demo.com',
    role: 'cleaning_agency',
  });
  const agency = await CleaningAgency.create({
    name: 'Demo Cleaning Agency',
    phone: '+440200000000',
    address: '10 Agency Road, London',
    latitude: hub.lat,
    longitude: hub.lng,
    createdBy: agencyOwner._id,
  });
  await AgencyMembership.create({
    agencyId: agency._id,
    userId: agencyOwner._id,
    memberRole: 'owner',
  });

  const staff = await upsertUser({
    name: 'Agency Staff One',
    email: 'staff1@demo.com',
    role: 'agency_staff',
    isAvailable: true,
    currentLocation: { lat: hub.lat + 0.005, lng: hub.lng - 0.005, updatedAt: new Date() },
  });
  await AgencyMembership.create({
    agencyId: agency._id,
    userId: staff._id,
    memberRole: 'staff',
  });

  const staffTwo = await upsertUser({
    name: 'Agency Staff Two',
    email: 'staff2@demo.com',
    role: 'agency_staff',
    isAvailable: true,
    currentLocation: { lat: hub.lat + 0.004, lng: hub.lng + 0.004, updatedAt: new Date() },
  });
  await AgencyMembership.create({
    agencyId: agency._id,
    userId: staffTwo._id,
    memberRole: 'staff',
  });

  const bizUser = await upsertUser({
    name: 'Offer Biz Owner',
    email: 'biz-offers@demo.com',
    role: 'business',
  });
  const business = await Business.create({
    name: 'Offer Demo Ltd',
    phone: '+440200000111',
    address: '22 Business Row, London',
    latitude: hub.lat,
    longitude: hub.lng,
    createdBy: bizUser._id,
  });
  await BusinessMembership.create({
    businessId: business._id,
    userId: bizUser._id,
    memberRole: 'owner',
  });

  await seedAssignedJobs({ business, bizUser, agency, owner: agencyOwner, staff });
}

function futureAt(daysAhead, hour) {
  const when = new Date();
  when.setDate(when.getDate() + daysAhead);
  when.setHours(hour, 0, 0, 0);
  return when;
}

/** Business jobs of each type, locked to the demo agency, with one staff shift on the calendar. */
async function seedAssignedJobs({ business, bizUser, agency, owner, staff }) {
  const actor = { id: bizUser._id.toString(), role: 'business' };
  const specs = [
    {
      serviceDetails: 'Fixed office clean',
      jobType: 'fixed',
      durationDays: 1,
      durationExtraHours: 0,
      scheduleStart: futureAt(10, 9),
    },
    {
      serviceDetails: 'Weekly lobby clean',
      jobType: 'recurring_indefinite',
      durationDays: 1,
      durationExtraHours: 0,
      scheduleStart: futureAt(12, 9),
    },
    {
      serviceDetails: 'Weekly kitchen until date',
      jobType: 'recurring_until',
      durationDays: 1,
      durationExtraHours: 0,
      scheduleStart: futureAt(16, 9),
      recurrenceUntil: futureAt(37, 0),
    },
  ];

  for (const spec of specs) {
    const created = await createCleaningRequest({
      clientId: bizUser._id,
      businessId: business._id,
      serviceDetails: spec.serviceDetails,
      jobType: spec.jobType,
      durationDays: spec.durationDays,
      durationExtraHours: spec.durationExtraHours,
      scheduleStart: spec.scheduleStart,
      recurrenceUntil: spec.recurrenceUntil,
      address: business.address,
      latitude: business.latitude,
      longitude: business.longitude,
      payRatePerHour: 14,
    });
    await expressAgencyInterest(created._id, agency._id, owner._id);
    await pickAgencyForRequest(created._id, agency._id, actor);
    await agencyAcceptRequest(created._id, agency._id, owner._id);
    const workStart = new Date(spec.scheduleStart);
    const workEnd = new Date(workStart.getTime() + 4 * 3600000);
    await assignAgencyStaff(created._id, agency._id, owner._id, {
      staffUserId: staff._id,
      payRatePerHour: 14,
      workStart,
      workEnd,
    });
  }
}

async function runCli() {
  const { connectDb, disconnectDb } = await import('./db.js');
  await connectDb();
  await seedDemo({ reset: true });
  console.log('Seeded users (password for all: password123)');
  console.log('  client@demo.com');
  console.log('  cleaner1@demo.com / cleaner2@demo.com (nearby, available)');
  console.log('  cleaner-far@demo.com (available but far)');
  console.log('  admin@demo.com');
  console.log('  agency@demo.com (cleaning agency)');
  console.log('  staff1@demo.com / staff2@demo.com (agency staff)');
  console.log('  biz-offers@demo.com (business with fixed, weekly, and until-date jobs)');
  await disconnectDb();
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed.js')) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
