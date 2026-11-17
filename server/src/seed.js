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
import { BoardTool } from './models/BoardTool.js';
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
      BoardTool.deleteMany({}),
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
  await seedBoardTools();
}

const BOARD_TOOLS = [
  ['Everyday tools', 'Vacuum cleaner', 'Lifts dust from carpets, rugs, and hard floors.'],
  ['Everyday tools', 'Mop and bucket with a wringer', 'Washes tile, vinyl, and laminate without leaving the floor soaked.'],
  ['Everyday tools', 'Colour-coded microfibre cloths', 'One colour for the kitchen, one for the bathroom, one for general surfaces, and one for glass.'],
  ['Everyday tools', 'Broom and dustpan', 'Sweeps loose dirt, including corners a vacuum misses, before you mop.'],
  ['Everyday tools', 'Scrub brush', 'Works on grout, skirting boards, and marks a cloth will not shift.'],
  ['Everyday tools', 'Squeegee', 'Clears water from glass, mirrors, and wet floors without streaks.'],
  ['Everyday tools', 'Cleaning caddy or trolley', 'Carries bottles, cloths, and bags from room to room.'],
  ['Everyday tools', 'Labelled spray bottles', 'Hold diluted cleaner. A label on every bottle stops the wrong product being used.'],
  ['Everyday tools', 'High-level duster', 'Reaches cobwebs, vents, and the tops of cupboards.'],
  ['Machines for larger sites', 'Steam cleaner', 'Hot steam loosens grease and stains on tiles, cookers, and upholstery.'],
  ['Machines for larger sites', 'Floor buffer', 'Puts a shine on hard floors in corridors and receptions.'],
  ['Machines for larger sites', 'Backpack vacuum', 'Lets a cleaner move quickly through stairs and a large office.'],
  ['Cleaning products', 'Multi-surface cleaner', 'The everyday cleaner for desks, doors, and most indoor surfaces.'],
  ['Cleaning products', 'Disinfectant', 'For handles, switches, and other places people touch often.'],
  ['Cleaning products', 'Bathroom cleaner', 'Cuts soap scum and limescale on sinks, showers, and tiles.'],
  ['Cleaning products', 'Toilet cleaner', 'Stays on the bowl long enough to clean it. Keep it off other surfaces.'],
  ['Cleaning products', 'Glass cleaner', 'For windows and mirrors.'],
  ['Cleaning products', 'Degreaser', 'For kitchen hobs, splashbacks, and greasy floors.'],
  ['Cleaning products', 'Floor cleaner for that floor', 'Match the product to wood, tile, or vinyl so the finish is not damaged.'],
  ['Safety gear', 'Nitrile gloves', 'For day-to-day cleaning and for handling products.'],
  ['Safety gear', 'Chemical-resistant gloves', 'When the label says the liquid is stronger than a normal spray.'],
  ['Safety gear', 'Safety glasses', 'When you dilute or spray a product that can splash.'],
  ['Safety gear', 'Mask', 'When the job is dusty, or the product label says to cover your nose and mouth.'],
  ['Safety gear', 'Non-slip shoes', 'Floors are wet while you mop. Closed shoes with a grip reduce falls.'],
  ['Safety gear', 'Apron', 'Keeps clothes dry during wet work.'],
  ['Safety gear', 'Wet floor sign', 'Put it out before the floor is wet, and leave it until the floor is dry.'],
  ['Safety gear', 'Spill kit', 'Absorbent material, gloves, and bags for a chemical spill.'],
  ['Safety gear', 'First aid kit', 'For cuts and splashes on the job.'],
  ['Items you replace', 'Bin liners', 'In the sizes the sites you clean actually use.'],
  ['Items you replace', 'Spare mop heads and cloths', 'Replace them when they stay dirty after washing.'],
  ['Items you replace', 'Paper roll', 'For spills, glass, and wiping up before a disinfectant.'],
  ['Items you replace', 'Washroom restock', 'Hand soap and paper towels, when the job includes keeping the washroom stocked.'],
];

const TOOL_CONTACTS = {
  'Everyday tools': {
    contactName: 'Ada Supplies',
    email: 'ada.supplies@example.com',
    phone: '+44 20 7946 0101',
  },
  'Machines for larger sites': {
    contactName: 'Ben Machines',
    email: 'ben.machines@example.com',
    phone: '+44 20 7946 0202',
  },
  'Cleaning products': {
    contactName: 'Cara Chemicals',
    email: 'cara.chemicals@example.com',
    phone: '+44 20 7946 0303',
  },
  'Safety gear': {
    contactName: 'Dan Safety',
    email: 'dan.safety@example.com',
    phone: '+44 20 7946 0404',
  },
  'Items you replace': {
    contactName: 'Eve Restock',
    email: 'eve.restock@example.com',
    phone: '+44 20 7946 0505',
  },
};

export async function seedBoardTools() {
  await BoardTool.deleteMany({});
  const newest = Date.now();
  await BoardTool.insertMany(
    BOARD_TOOLS.map(([category, name, detail], index) => ({
      category,
      name,
      detail,
      ...TOOL_CONTACTS[category],
      createdAt: new Date(newest - index * 1000),
    }))
  );
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
