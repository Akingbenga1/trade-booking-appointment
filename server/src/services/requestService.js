import { User } from '../models/User.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { Notification } from '../models/Notification.js';
import { BusinessPayment } from '../models/BusinessPayment.js';
import { Transaction } from '../models/Transaction.js';
import { RequestOffer } from '../models/RequestOffer.js';
import { AgencyJobInterest } from '../models/AgencyJobInterest.js';
import { JobAssignment } from '../models/JobAssignment.js';
import { StaffJobPay } from '../models/StaffJobPay.js';
import { CleaningAgency } from '../models/CleaningAgency.js';
import { AgencyMembership } from '../models/AgencyMembership.js';
import { config } from '../config.js';
import { distanceKm } from './geo.js';
import { notify, notifyMany } from './notify.js';
import { isBusinessMember } from './businessService.js';
import {
  getAgencyMemberUserIds,
  isAgencyMember,
  isAgencyOwnerOrAdmin,
} from './agencyService.js';
import { parseScheduleRange } from './schedule.js';
import {
  attachPayToRequests,
  createJobPayForRequest,
  MINIMUM_WAGE_PER_HOUR,
  parseJobPay,
  syncJobPayForRequest,
} from './jobPay.js';
import { listRequestEvents, recordRequestEvent } from './requestEvents.js';

/** Mongo filter: exclude soft-deleted requests. */
export const notDeletedFilter = { deletedAt: null };

/** Poster hub: exclude deleted and archived. */
export const activeForPosterFilter = { deletedAt: null, archivedAt: null };

function assertNotDeleted(request) {
  if (request?.deletedAt) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
}

function assertNotArchived(request) {
  if (request?.archivedAt) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
}

async function isRequestPaid(requestId) {
  const ownership = await BusinessPayment.findOne({ requestId });
  if (!ownership) return false;
  const transaction = await Transaction.findById(ownership.transactionId);
  return Boolean(transaction && transaction.status === 'paid');
}

export async function findNearbyAvailableCleaners(lat, lng, radiusKm = config.matchRadiusKm) {
  const cleaners = await User.find({
    role: 'cleaner',
    isAvailable: true,
    isDisabled: { $ne: true },
    'currentLocation.lat': { $ne: null },
    'currentLocation.lng': { $ne: null },
  });

  return cleaners
    .map((c) => ({
      cleaner: c,
      distanceKm: distanceKm(lat, lng, c.currentLocation.lat, c.currentLocation.lng),
    }))
    .filter((x) => x.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Nearby = agency HQ in range, or any available agency_staff member of that agency in range.
 */
export async function findNearbyAgencies(lat, lng, radiusKm = config.matchRadiusKm) {
  const agencies = await CleaningAgency.find({});
  const staffMemberships = await AgencyMembership.find({ memberRole: 'staff' });
  const staffIds = [...new Set(staffMemberships.map((m) => String(m.userId)))];
  const staffUsers = staffIds.length
    ? await User.find({
        _id: { $in: staffIds },
        role: 'agency_staff',
        isAvailable: true,
        isDisabled: { $ne: true },
        'currentLocation.lat': { $ne: null },
        'currentLocation.lng': { $ne: null },
      })
    : [];
  const staffById = new Map(staffUsers.map((u) => [String(u._id), u]));
  const staffByAgency = new Map();
  for (const m of staffMemberships) {
    const key = String(m.agencyId);
    if (!staffByAgency.has(key)) staffByAgency.set(key, []);
    const user = staffById.get(String(m.userId));
    if (user) staffByAgency.get(key).push(user);
  }

  const results = [];
  for (const agency of agencies) {
    const hqDist = distanceKm(lat, lng, agency.latitude, agency.longitude);
    let best = hqDist;
    for (const staff of staffByAgency.get(String(agency._id)) || []) {
      const d = distanceKm(lat, lng, staff.currentLocation.lat, staff.currentLocation.lng);
      if (d < best) best = d;
    }
    if (best <= radiusKm) {
      results.push({ agency, distanceKm: Math.round(best * 100) / 100 });
    }
  }
  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

async function createOffersForRequest(requestId, nearbyCleaners, nearbyAgencies, expiresAt, now) {
  const docs = [
    ...nearbyCleaners.map(({ cleaner, distanceKm: d }) => ({
      requestId,
      kind: 'cleaner',
      cleanerId: cleaner._id,
      distanceKm: Math.round(d * 100) / 100,
      status: 'pending',
      notifiedAt: now,
      expiresAt,
    })),
    ...nearbyAgencies.map(({ agency, distanceKm: d }) => ({
      requestId,
      kind: 'agency',
      agencyId: agency._id,
      distanceKm: d,
      status: 'pending',
      notifiedAt: now,
      expiresAt,
    })),
  ];
  if (docs.length) await RequestOffer.insertMany(docs);
}

async function notifyAgencyOwners(agencyIds, payload) {
  const userIds = [];
  for (const agencyId of agencyIds) {
    const ids = await getAgencyMemberUserIds(agencyId, ['owner', 'admin']);
    userIds.push(...ids);
  }
  if (userIds.length) await notifyMany(userIds, payload);
}

export async function hydrateRequest(
  request,
  { includeOffers = false, includeEvents = false, populateOffers = false } = {}
) {
  const plain =
    request && typeof request.toObject === 'function' ? request.toObject() : { ...request };
  if (includeOffers) {
    let q = RequestOffer.find({ requestId: plain._id });
    if (populateOffers) {
      q = q.populate('cleanerId', 'name email').populate('agencyId', 'name');
    }
    plain.offers = await q.lean();
  }
  if (includeEvents) {
    plain.statusHistory = await listRequestEvents(plain._id);
  }
  const assignments = await JobAssignment.find({
    requestId: plain._id,
    confirmStatus: { $in: ['pending', 'confirmed'] },
  })
    .populate('staffUserId', 'name email')
    .lean();
  plain.assignments = assignments;
  if (plain.assignedAgencyId) {
    plain.assignedAgency =
      (await CleaningAgency.findById(plain.assignedAgencyId).select('name phone').lean()) || null;
  }
  await attachPayToRequests(plain);
  return plain;
}

export async function createCleaningRequest({
  clientId,
  businessId,
  serviceDetails,
  scheduleStart,
  scheduleEnd,
  address,
  latitude,
  longitude,
  payRatePerHour,
}) {
  const schedule = parseScheduleRange(scheduleStart, scheduleEnd);
  const now = new Date();
  const matchingExpiresAt = new Date(now.getTime() + config.matchingWindowSeconds * 1000);
  const offerExpiresAt = matchingExpiresAt;

  const nearby = await findNearbyAvailableCleaners(latitude, longitude);
  const nearbyAgencies = await findNearbyAgencies(latitude, longitude);
  const anyTargets = nearby.length + nearbyAgencies.length > 0;

  const request = new CleaningRequest({
    clientId,
    businessId: businessId || undefined,
    serviceDetails,
    scheduleStart: schedule.scheduleStart,
    scheduleEnd: schedule.scheduleEnd,
    address,
    latitude,
    longitude,
    status: anyTargets ? 'open' : 'unmatched',
    matchingExpiresAt,
    notifiedCleanerCount: nearby.length,
    notifiedAgencyCount: nearbyAgencies.length,
  });

  await request.save();
  await createOffersForRequest(request._id, nearby, nearbyAgencies, offerExpiresAt, now);
  await recordRequestEvent(
    request._id,
    request.status,
    'system',
    anyTargets
      ? `Notified ${nearby.length} cleaner(s) and ${nearbyAgencies.length} agency(ies)`
      : 'No available cleaners or agencies nearby'
  );

  if (businessId) {
    try {
      await createJobPayForRequest({
        requestId: request._id,
        businessId,
        payRatePerHour,
        scheduleStart: schedule.scheduleStart,
        scheduleEnd: schedule.scheduleEnd,
      });
    } catch (err) {
      await RequestOffer.deleteMany({ requestId: request._id });
      await CleaningRequest.deleteOne({ _id: request._id });
      throw err;
    }
  }

  if (nearby.length) {
    await notifyMany(
      nearby.map((n) => n.cleaner._id),
      {
        type: 'new_offer',
        title: 'New cleaning request nearby',
        body: serviceDetails,
        requestId: request._id,
      }
    );
  }
  if (nearbyAgencies.length) {
    await notifyAgencyOwners(
      nearbyAgencies.map((n) => n.agency._id),
      {
        type: 'new_offer',
        title: 'New cleaning request nearby',
        body: serviceDetails,
        requestId: request._id,
      }
    );
  }
  if (anyTargets) {
    await notify(clientId, {
      type: 'matching_started',
      title: 'Nearby providers notified',
      body: `${nearby.length} cleaner(s) and ${nearbyAgencies.length} agency(ies) were notified.`,
      requestId: request._id,
    });
  } else {
    await notify(clientId, {
      type: 'unmatched',
      title: 'No providers nearby',
      body: 'No available cleaners or agencies were found near your location.',
      requestId: request._id,
    });
  }

  return hydrateRequest(request, { includeOffers: true });
}

export async function respondToOffer(requestId, cleanerId, action) {
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);

  if (request.status !== 'open') {
    const err = new Error(
      request.assignedCleanerId || request.assignedAgencyId
        ? 'Job is no longer available'
        : 'Request is no longer open'
    );
    err.status = 409;
    throw err;
  }

  const offer = await RequestOffer.findOne({
    requestId,
    kind: 'cleaner',
    cleanerId,
    status: 'pending',
  });
  if (!offer) {
    const err = new Error('No pending offer for this cleaner');
    err.status = 409;
    throw err;
  }

  if (offer.expiresAt.getTime() < Date.now()) {
    offer.status = 'ignored';
    offer.respondedAt = new Date();
    await offer.save();
    const err = new Error('Offer has expired');
    err.status = 409;
    throw err;
  }

  if (action === 'reject' || action === 'ignore') {
    offer.status = action === 'reject' ? 'rejected' : 'ignored';
    offer.respondedAt = new Date();
    await offer.save();
    return hydrateRequest(request, { includeOffers: true });
  }

  if (action !== 'accept') {
    const err = new Error('Invalid action');
    err.status = 400;
    throw err;
  }

  const claimed = await CleaningRequest.findOneAndUpdate(
    { _id: requestId, status: 'open' },
    {
      $set: {
        status: 'assigned',
        assignedCleanerId: cleanerId,
        selectedAgencyId: null,
        assignedAgencyId: null,
        assignedStaffIds: [],
      },
    },
    { new: true }
  );

  if (!claimed) {
    const err = new Error('Job is no longer available');
    err.status = 409;
    throw err;
  }

  await recordRequestEvent(claimed._id, 'assigned', `cleaner:${cleanerId}`, 'Cleaner accepted');

  offer.status = 'accepted';
  offer.respondedAt = new Date();
  await offer.save();

  const closed = await RequestOffer.find({
    requestId,
    status: 'pending',
    _id: { $ne: offer._id },
  });
  if (closed.length) {
    await RequestOffer.updateMany(
      { _id: { $in: closed.map((c) => c._id) } },
      { $set: { status: 'closed', respondedAt: new Date() } }
    );
  }
  await AgencyJobInterest.updateMany(
    { requestId, status: { $in: ['interested', 'selected'] } },
    { $set: { status: 'rejected', decidedAt: new Date() } }
  );

  await notify(claimed.clientId, {
    type: 'assigned',
    title: 'Cleaner assigned',
    body: 'A cleaner accepted your cleaning request.',
    requestId: claimed._id,
  });

  const closedCleanerIds = closed
    .filter((o) => o.kind === 'cleaner' && o.cleanerId)
    .map((o) => o.cleanerId);
  if (closedCleanerIds.length) {
    await notifyMany(closedCleanerIds, {
      type: 'unavailable',
      title: 'Request no longer available',
      body: 'Another cleaner accepted this request.',
      requestId: claimed._id,
    });
  }

  await notify(cleanerId, {
    type: 'accept_success',
    title: 'You got the job',
    body: 'Request assigned to you. Update progress as you work.',
    requestId: claimed._id,
  });

  return hydrateRequest(claimed, { includeOffers: true });
}

/** Agency expresses interest (company-pick path; does not lock the job). */
export async function expressAgencyInterest(requestId, agencyId, actorUserId) {
  if (!(await isAgencyOwnerOrAdmin(actorUserId, agencyId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  if (request.status !== 'open') {
    const err = new Error('Request is no longer open');
    err.status = 409;
    throw err;
  }
  const offer = await RequestOffer.findOne({
    requestId,
    kind: 'agency',
    agencyId,
    status: 'pending',
  });
  if (!offer) {
    const err = new Error('No pending agency offer for this job');
    err.status = 409;
    throw err;
  }

  const interest = await AgencyJobInterest.findOneAndUpdate(
    { requestId, agencyId },
    {
      requestId,
      agencyId,
      status: 'interested',
      expressedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await recordRequestEvent(
    requestId,
    'open',
    `agency:${agencyId}`,
    'Agency expressed interest'
  );

  await notify(request.clientId, {
    type: 'agency_interest',
    title: 'Agency interested',
    body: 'A cleaning agency is interested in your request.',
    requestId,
  });

  return interest;
}

/** Poster picks one interested agency. */
export async function pickAgencyForRequest(requestId, agencyId, actor) {
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  assertNotArchived(request);

  const isPersonOwner = String(request.clientId) === String(actor.id);
  const isBusinessOwner =
    request.businessId && (await isBusinessMember(actor.id, request.businessId));
  if (!isPersonOwner && !isBusinessOwner && actor.role !== 'admin') {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (request.status !== 'open') {
    const err = new Error('Request is no longer open');
    err.status = 409;
    throw err;
  }

  const interest = await AgencyJobInterest.findOne({
    requestId,
    agencyId,
    status: 'interested',
  });
  if (!interest) {
    const err = new Error('Agency has not expressed interest');
    err.status = 409;
    throw err;
  }

  await AgencyJobInterest.updateMany(
    { requestId, agencyId: { $ne: agencyId }, status: 'interested' },
    { $set: { status: 'rejected', decidedAt: new Date() } }
  );
  interest.status = 'selected';
  interest.decidedAt = new Date();
  await interest.save();

  request.selectedAgencyId = agencyId;
  await request.save();
  await recordRequestEvent(
    requestId,
    'open',
    `${actor.role}:${actor.id}`,
    'Company selected agency'
  );

  await notifyAgencyOwners([agencyId], {
    type: 'agency_selected',
    title: 'Selected for job',
    body: 'The client selected your agency. Accept to lock the job, then assign staff.',
    requestId,
  });

  return hydrateRequest(request);
}

/** Selected agency accepts and locks the job (then assigns staff). */
export async function agencyAcceptRequest(requestId, agencyId, actorUserId) {
  if (!(await isAgencyOwnerOrAdmin(actorUserId, agencyId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  if (request.status !== 'open') {
    const err = new Error('Request is no longer open');
    err.status = 409;
    throw err;
  }
  if (
    request.selectedAgencyId &&
    String(request.selectedAgencyId) !== String(agencyId)
  ) {
    const err = new Error('Another agency was selected for this job');
    err.status = 409;
    throw err;
  }
  const interest = await AgencyJobInterest.findOne({
    requestId,
    agencyId,
    status: { $in: ['interested', 'selected'] },
  });
  if (!interest && !request.selectedAgencyId) {
    const err = new Error('Express interest and wait for client selection first');
    err.status = 409;
    throw err;
  }
  if (String(request.selectedAgencyId || '') !== String(agencyId)) {
    const err = new Error('Client has not selected your agency yet');
    err.status = 409;
    throw err;
  }

  const claimed = await CleaningRequest.findOneAndUpdate(
    { _id: requestId, status: 'open', selectedAgencyId: agencyId },
    {
      $set: {
        status: 'assigned',
        assignedAgencyId: agencyId,
        assignedCleanerId: null,
        assignedStaffIds: [],
      },
    },
    { new: true }
  );
  if (!claimed) {
    const err = new Error('Job is no longer available');
    err.status = 409;
    throw err;
  }

  await recordRequestEvent(claimed._id, 'assigned', `agency:${agencyId}`, 'Agency accepted');
  await RequestOffer.updateMany(
    { requestId, status: 'pending' },
    { $set: { status: 'closed', respondedAt: new Date() } }
  );
  await RequestOffer.updateOne(
    { requestId, kind: 'agency', agencyId },
    { $set: { status: 'accepted', respondedAt: new Date() } }
  );

  await notify(claimed.clientId, {
    type: 'assigned',
    title: 'Agency assigned',
    body: 'A cleaning agency accepted your request and will assign staff.',
    requestId: claimed._id,
  });

  return hydrateRequest(claimed);
}

export async function assignAgencyStaff(
  requestId,
  agencyId,
  actorUserId,
  { staffUserId, payRatePerHour }
) {
  if (!(await isAgencyOwnerOrAdmin(actorUserId, agencyId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  if (String(request.assignedAgencyId) !== String(agencyId)) {
    const err = new Error('Agency is not assigned to this request');
    err.status = 403;
    throw err;
  }
  if (request.status === 'completed' || request.status === 'cancelled') {
    const err = new Error('Cannot assign staff on a finished request');
    err.status = 409;
    throw err;
  }
  if (!(await isAgencyMember(staffUserId, agencyId, ['staff']))) {
    const err = new Error('User is not staff of this agency');
    err.status = 400;
    throw err;
  }

  const payFields = parseJobPay(
    payRatePerHour,
    request.scheduleStart,
    request.scheduleEnd
  );
  if (payFields.payRatePerHour < MINIMUM_WAGE_PER_HOUR) {
    const err = new Error(`Staff pay must be at least £${MINIMUM_WAGE_PER_HOUR} / hour`);
    err.status = 400;
    throw err;
  }

  const existingActive = await JobAssignment.findOne({
    requestId,
    staffUserId,
    confirmStatus: { $in: ['pending', 'confirmed'] },
  });
  if (existingActive) {
    const err = new Error('Staff already assigned to this job');
    err.status = 409;
    throw err;
  }

  const assignment = await JobAssignment.create({
    requestId,
    agencyId,
    staffUserId,
    confirmStatus: 'pending',
    assignedAt: new Date(),
  });
  await StaffJobPay.create({
    requestId,
    agencyId,
    staffUserId,
    assignmentId: assignment._id,
    payRatePerHour: payFields.payRatePerHour,
    minimumWagePerHour: payFields.minimumWagePerHour,
    durationHours: payFields.durationHours,
    currency: payFields.currency,
  });

  const staffIds = new Set((request.assignedStaffIds || []).map(String));
  staffIds.add(String(staffUserId));
  request.assignedStaffIds = [...staffIds];
  await request.save();
  await recordRequestEvent(
    requestId,
    request.status,
    `agency:${agencyId}`,
    `Assigned staff ${staffUserId}`
  );

  await notify(staffUserId, {
    type: 'staff_assigned',
    title: 'Assigned to a job',
    body: 'Your agency assigned you to a cleaning job. Please confirm or decline.',
    requestId,
  });

  return hydrateRequest(request);
}

export async function reassignAgencyStaff(
  requestId,
  agencyId,
  actorUserId,
  { fromStaffUserId, toStaffUserId, payRatePerHour }
) {
  if (!(await isAgencyOwnerOrAdmin(actorUserId, agencyId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  if (request.status === 'completed' || request.status === 'cancelled') {
    const err = new Error('Cannot reassign on a finished request');
    err.status = 409;
    throw err;
  }
  if (String(request.assignedAgencyId) !== String(agencyId)) {
    const err = new Error('Agency is not assigned to this request');
    err.status = 403;
    throw err;
  }

  const prior = await JobAssignment.findOne({
    requestId,
    agencyId,
    staffUserId: fromStaffUserId,
    confirmStatus: { $in: ['pending', 'confirmed'] },
  });
  if (!prior) {
    const err = new Error('No active assignment for that staff member');
    err.status = 404;
    throw err;
  }
  prior.confirmStatus = 'reassigned';
  prior.respondedAt = new Date();
  await prior.save();

  request.assignedStaffIds = (request.assignedStaffIds || []).filter(
    (id) => String(id) !== String(fromStaffUserId)
  );
  await request.save();

  await notify(fromStaffUserId, {
    type: 'staff_reassigned',
    title: 'Removed from job',
    body: 'Your agency reassigned this job to someone else.',
    requestId,
  });

  return assignAgencyStaff(requestId, agencyId, actorUserId, {
    staffUserId: toStaffUserId,
    payRatePerHour,
  });
}

export async function staffRespondToAssignment(requestId, staffUserId, action) {
  if (!['confirm', 'decline'].includes(action)) {
    const err = new Error('action must be confirm or decline');
    err.status = 400;
    throw err;
  }
  const assignment = await JobAssignment.findOne({
    requestId,
    staffUserId,
    confirmStatus: 'pending',
  });
  if (!assignment) {
    const err = new Error('No pending assignment');
    err.status = 409;
    throw err;
  }
  assignment.confirmStatus = action === 'confirm' ? 'confirmed' : 'declined';
  assignment.respondedAt = new Date();
  await assignment.save();

  const request = await CleaningRequest.findById(requestId);
  if (action === 'decline' && request) {
    request.assignedStaffIds = (request.assignedStaffIds || []).filter(
      (id) => String(id) !== String(staffUserId)
    );
    await request.save();
  }
  await recordRequestEvent(
    requestId,
    request?.status || 'assigned',
    `staff:${staffUserId}`,
    action === 'confirm' ? 'Staff confirmed' : 'Staff declined'
  );

  const owners = await getAgencyMemberUserIds(assignment.agencyId, ['owner', 'admin']);
  await notifyMany(owners, {
    type: action === 'confirm' ? 'staff_confirmed' : 'staff_declined',
    title: action === 'confirm' ? 'Staff confirmed' : 'Staff declined',
    body:
      action === 'confirm'
        ? 'A staff member confirmed the assignment.'
        : 'A staff member declined — please assign someone else.',
    requestId,
  });

  return assignment;
}

const PROGRESS_ORDER = ['assigned', 'en_route', 'on_site', 'in_progress', 'completed'];

export async function advanceBooking(requestId, actor, nextStatus) {
  if (!PROGRESS_ORDER.includes(nextStatus) || nextStatus === 'assigned') {
    const err = new Error('Invalid progress status');
    err.status = 400;
    throw err;
  }

  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);

  if (request.assignedAgencyId) {
    if (
      actor.role !== 'cleaning_agency' ||
      !(await isAgencyOwnerOrAdmin(actor.id, request.assignedAgencyId))
    ) {
      const err = new Error('Only the assigned agency can update progress');
      err.status = 403;
      throw err;
    }
  } else if (String(request.assignedCleanerId) !== String(actor.id)) {
    const err = new Error('Only the assigned cleaner can update progress');
    err.status = 403;
    throw err;
  }

  const currentIdx = PROGRESS_ORDER.indexOf(request.status);
  const nextIdx = PROGRESS_ORDER.indexOf(nextStatus);
  if (currentIdx < 0 || nextIdx !== currentIdx + 1) {
    const err = new Error(`Cannot move from ${request.status} to ${nextStatus}`);
    err.status = 409;
    throw err;
  }

  request.status = nextStatus;
  await request.save();
  await recordRequestEvent(
    request._id,
    nextStatus,
    `${actor.role}:${actor.id}`,
    'Progress update'
  );

  await notify(request.clientId, {
    type: 'progress',
    title: 'Booking progress updated',
    body: `Status is now ${nextStatus.replace('_', ' ')}.`,
    requestId: request._id,
  });

  return hydrateRequest(request);
}

export async function cancelRequest(requestId, actor) {
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  assertNotArchived(request);

  const isAdmin = actor.role === 'admin';
  const isPersonOwner = String(request.clientId) === String(actor.id);
  const isBusinessOwner =
    request.businessId && (await isBusinessMember(actor.id, request.businessId));

  if (!isAdmin && !isPersonOwner && !isBusinessOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (await isRequestPaid(request._id)) {
    const err = new Error('Cannot cancel a paid job. Hide it to archive instead.');
    err.status = 409;
    throw err;
  }

  if (!isAdmin && !['open', 'unmatched'].includes(request.status)) {
    const err = new Error('Can only cancel before a cleaner is locked in');
    err.status = 409;
    throw err;
  }

  if (['completed', 'cancelled'].includes(request.status)) {
    const err = new Error('Request already finished');
    err.status = 409;
    throw err;
  }

  request.status = 'cancelled';
  await request.save();
  await RequestOffer.updateMany(
    { requestId, status: 'pending' },
    { $set: { status: 'closed', respondedAt: new Date() } }
  );
  await recordRequestEvent(request._id, 'cancelled', `${actor.role}:${actor.id}`, 'Cancelled');

  const recipients = [request.clientId];
  if (request.assignedCleanerId) recipients.push(request.assignedCleanerId);
  if (request.assignedAgencyId) {
    const agencyUsers = await getAgencyMemberUserIds(request.assignedAgencyId, [
      'owner',
      'admin',
    ]);
    recipients.push(...agencyUsers);
  }
  if (request.assignedStaffIds?.length) recipients.push(...request.assignedStaffIds);

  await notifyMany(recipients, {
    type: 'cancelled',
    title: 'Request cancelled',
    body: 'This cleaning request was cancelled.',
    requestId: request._id,
  });

  return hydrateRequest(request);
}

export async function removeCancelledRequest(requestId, actor) {
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  assertNotArchived(request);

  const isAdmin = actor.role === 'admin';
  const isPersonOwner = String(request.clientId) === String(actor.id);
  const isBusinessOwner =
    request.businessId && (await isBusinessMember(actor.id, request.businessId));

  if (!isAdmin && !isPersonOwner && !isBusinessOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (request.status !== 'cancelled') {
    const err = new Error('Only cancelled requests can be removed');
    err.status = 409;
    throw err;
  }

  request.deletedAt = new Date();
  await request.save();
  await recordRequestEvent(
    request._id,
    'cancelled',
    `${actor.role}:${actor.id}`,
    'Removed (soft-deleted)'
  );
  await Notification.deleteMany({ requestId: request._id });
  return request;
}

export async function archiveRequest(requestId, actor) {
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  assertNotArchived(request);

  const isAdmin = actor.role === 'admin';
  const isPersonOwner = String(request.clientId) === String(actor.id);
  const isBusinessOwner =
    request.businessId && (await isBusinessMember(actor.id, request.businessId));

  if (!isAdmin && !isPersonOwner && !isBusinessOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (!(await isRequestPaid(request._id))) {
    const err = new Error('Only paid jobs can be archived. Cancel unpaid jobs instead.');
    err.status = 409;
    throw err;
  }

  request.archivedAt = new Date();
  await request.save();
  await recordRequestEvent(
    request._id,
    request.status,
    `${actor.role}:${actor.id}`,
    'Archived (hidden from My requests)'
  );
  return request;
}

export async function updateOpenRequest(requestId, actorId, patch) {
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  assertNotArchived(request);
  const isPersonOwner = String(request.clientId) === String(actorId);
  const isBusinessOwner =
    request.businessId && (await isBusinessMember(actorId, request.businessId));
  if (!isPersonOwner && !isBusinessOwner) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const clientId = actorId;
  if (!['open', 'unmatched'].includes(request.status)) {
    const err = new Error('Can only update while request is open or unmatched');
    err.status = 409;
    throw err;
  }

  const wasUnmatched = request.status === 'unmatched';
  if (patch.serviceDetails) request.serviceDetails = patch.serviceDetails;
  let scheduleTouched = false;
  if (patch.scheduleStart != null || patch.scheduleEnd != null) {
    const schedule = parseScheduleRange(
      patch.scheduleStart ?? request.scheduleStart,
      patch.scheduleEnd ?? request.scheduleEnd
    );
    request.scheduleStart = schedule.scheduleStart;
    request.scheduleEnd = schedule.scheduleEnd;
    scheduleTouched = true;
  }
  if (patch.address != null || patch.latitude != null || patch.longitude != null) {
    request.address = patch.address ?? request.address;
    request.latitude = patch.latitude ?? request.latitude;
    request.longitude = patch.longitude ?? request.longitude;
  }

  if (wasUnmatched) {
    const now = new Date();
    const matchingExpiresAt = new Date(now.getTime() + config.matchingWindowSeconds * 1000);
    const nearby = await findNearbyAvailableCleaners(request.latitude, request.longitude);
    const nearbyAgencies = await findNearbyAgencies(request.latitude, request.longitude);
    const anyTargets = nearby.length + nearbyAgencies.length > 0;
    request.matchingExpiresAt = matchingExpiresAt;
    request.notifiedCleanerCount = nearby.length;
    request.notifiedAgencyCount = nearbyAgencies.length;
    request.status = anyTargets ? 'open' : 'unmatched';
    await request.save();
    await RequestOffer.deleteMany({ requestId: request._id });
    await createOffersForRequest(request._id, nearby, nearbyAgencies, matchingExpiresAt, now);
    await recordRequestEvent(
      request._id,
      request.status,
      `client:${clientId}`,
      anyTargets
        ? `Client adjusted; notified ${nearby.length} cleaner(s) and ${nearbyAgencies.length} agency(ies)`
        : 'Client adjusted; still no nearby providers'
    );

    if (request.businessId && (scheduleTouched || patch.payRatePerHour != null)) {
      await syncJobPayForRequest(request, { payRatePerHour: patch.payRatePerHour });
    }

    if (nearby.length) {
      await notifyMany(
        nearby.map((n) => n.cleaner._id),
        {
          type: 'new_offer',
          title: 'New cleaning request nearby',
          body: request.serviceDetails,
          requestId: request._id,
        }
      );
    }
    if (nearbyAgencies.length) {
      await notifyAgencyOwners(
        nearbyAgencies.map((n) => n.agency._id),
        {
          type: 'new_offer',
          title: 'New cleaning request nearby',
          body: request.serviceDetails,
          requestId: request._id,
        }
      );
    }
    if (anyTargets) {
      await notify(clientId, {
        type: 'matching_started',
        title: 'Nearby providers notified',
        body: `${nearby.length} cleaner(s) and ${nearbyAgencies.length} agency(ies) were notified.`,
        requestId: request._id,
      });
    } else {
      await notify(clientId, {
        type: 'unmatched',
        title: 'No providers nearby',
        body: 'No available cleaners or agencies were found near your location.',
        requestId: request._id,
      });
    }
    return hydrateRequest(request);
  }

  await request.save();
  await recordRequestEvent(request._id, 'open', `client:${clientId}`, 'Client updated request');

  if (request.businessId && (scheduleTouched || patch.payRatePerHour != null)) {
    await syncJobPayForRequest(request, { payRatePerHour: patch.payRatePerHour });
  }

  return hydrateRequest(request);
}

export async function forceAssign(requestId, cleanerId, adminId) {
  const cleaner = await User.findOne({ _id: cleanerId, role: 'cleaner' });
  if (!cleaner) {
    const err = new Error('Cleaner not found');
    err.status = 404;
    throw err;
  }

  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  if (['completed', 'cancelled'].includes(request.status)) {
    const err = new Error('Cannot assign a finished request');
    err.status = 409;
    throw err;
  }

  const pending = await RequestOffer.find({ requestId, status: 'pending' });
  const closedCleanerIds = pending
    .filter((o) => o.kind === 'cleaner' && String(o.cleanerId) !== String(cleanerId))
    .map((o) => o.cleanerId);
  await RequestOffer.updateMany(
    { requestId, status: 'pending' },
    { $set: { status: 'closed', respondedAt: new Date() } }
  );

  let offer = await RequestOffer.findOne({ requestId, kind: 'cleaner', cleanerId });
  if (!offer) {
    await RequestOffer.create({
      requestId,
      kind: 'cleaner',
      cleanerId,
      distanceKm: 0,
      status: 'accepted',
      notifiedAt: new Date(),
      expiresAt: new Date(),
      respondedAt: new Date(),
    });
  } else {
    offer.status = 'accepted';
    offer.respondedAt = new Date();
    await offer.save();
  }

  request.status = 'assigned';
  request.assignedCleanerId = cleanerId;
  request.assignedAgencyId = null;
  request.selectedAgencyId = null;
  request.assignedStaffIds = [];
  await request.save();
  await recordRequestEvent(request._id, 'assigned', `admin:${adminId}`, 'Admin force-assigned');

  await notify(request.clientId, {
    type: 'assigned',
    title: 'Cleaner assigned',
    body: 'An admin assigned a cleaner to your request.',
    requestId: request._id,
  });
  await notify(cleanerId, {
    type: 'force_assigned',
    title: 'Assigned by admin',
    body: 'You were assigned to a cleaning request.',
    requestId: request._id,
  });
  if (closedCleanerIds.length) {
    await notifyMany(closedCleanerIds, {
      type: 'unavailable',
      title: 'Request no longer available',
      body: 'An admin assigned this request to another cleaner.',
      requestId: request._id,
    });
  }

  return hydrateRequest(request, { includeOffers: true });
}

/** Admin force-assigns to an agency; agency then picks staff. */
export async function forceAssignAgency(requestId, agencyId, adminId) {
  const agency = await CleaningAgency.findById(agencyId);
  if (!agency) {
    const err = new Error('Agency not found');
    err.status = 404;
    throw err;
  }
  const request = await CleaningRequest.findById(requestId);
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  assertNotDeleted(request);
  if (['completed', 'cancelled'].includes(request.status)) {
    const err = new Error('Cannot assign a finished request');
    err.status = 409;
    throw err;
  }

  await RequestOffer.updateMany(
    { requestId, status: 'pending' },
    { $set: { status: 'closed', respondedAt: new Date() } }
  );
  await AgencyJobInterest.findOneAndUpdate(
    { requestId, agencyId },
    {
      requestId,
      agencyId,
      status: 'selected',
      expressedAt: new Date(),
      decidedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  request.status = 'assigned';
  request.selectedAgencyId = agencyId;
  request.assignedAgencyId = agencyId;
  request.assignedCleanerId = null;
  request.assignedStaffIds = [];
  await request.save();
  await recordRequestEvent(
    request._id,
    'assigned',
    `admin:${adminId}`,
    'Admin force-assigned agency'
  );

  await notify(request.clientId, {
    type: 'assigned',
    title: 'Agency assigned',
    body: 'An admin assigned a cleaning agency to your request.',
    requestId: request._id,
  });
  await notifyAgencyOwners([agencyId], {
    type: 'force_assigned',
    title: 'Assigned by admin',
    body: 'An admin assigned your agency to a job. Assign staff next.',
    requestId: request._id,
  });

  return hydrateRequest(request);
}

export async function processExpiries() {
  const now = new Date();

  const expiredOffers = await RequestOffer.find({
    status: 'pending',
    expiresAt: { $lte: now },
  });
  if (expiredOffers.length) {
    await RequestOffer.updateMany(
      { _id: { $in: expiredOffers.map((o) => o._id) } },
      { $set: { status: 'ignored', respondedAt: now } }
    );
  }

  const expiredMatching = await CleaningRequest.find({
    ...notDeletedFilter,
    status: 'open',
    matchingExpiresAt: { $lte: now },
  });

  for (const request of expiredMatching) {
    await RequestOffer.updateMany(
      { requestId: request._id, status: 'pending' },
      { $set: { status: 'ignored', respondedAt: now } }
    );
    request.status = 'unmatched';
    await request.save();
    await recordRequestEvent(request._id, 'unmatched', 'system', 'Matching window ended');
    await notify(request.clientId, {
      type: 'unmatched',
      title: 'No cleaner accepted',
      body: 'Matching ended without an accept. You can repost or adjust details.',
      requestId: request._id,
    });
  }
}

export async function listInterestsForRequest(requestId) {
  return AgencyJobInterest.find({ requestId })
    .populate('agencyId', 'name phone address')
    .sort({ expressedAt: 1 })
    .lean();
}
