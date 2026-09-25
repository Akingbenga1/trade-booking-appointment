import { User } from '../models/User.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { Notification } from '../models/Notification.js';
import { BusinessPayment } from '../models/BusinessPayment.js';
import { Transaction } from '../models/Transaction.js';
import { config } from '../config.js';
import { distanceKm } from './geo.js';
import { notify, notifyMany } from './notify.js';
import { isBusinessMember } from './businessService.js';
import { parseScheduleRange } from './schedule.js';
import {
  attachPayToRequests,
  createJobPayForRequest,
  syncJobPayForRequest,
} from './jobPay.js';

/** Mongo filter: exclude soft-deleted requests. */
export const notDeletedFilter = { deletedAt: null };

/** Poster hub: exclude deleted and archived. */
export const activeForPosterFilter = { deletedAt: null, archivedAt: null };

function pushHistory(request, status, by, note) {
  request.statusHistory.push({ status, by, note, at: new Date() });
}

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
  // Offers stay open for the full matching window so accept remains possible until unmatched.
  const matchingExpiresAt = new Date(now.getTime() + config.matchingWindowSeconds * 1000);
  const offerExpiresAt = matchingExpiresAt;

  const nearby = await findNearbyAvailableCleaners(latitude, longitude);

  const request = new CleaningRequest({
    clientId,
    businessId: businessId || undefined,
    serviceDetails,
    scheduleStart: schedule.scheduleStart,
    scheduleEnd: schedule.scheduleEnd,
    address,
    latitude,
    longitude,
    status: nearby.length ? 'open' : 'unmatched',
    matchingExpiresAt,
    notifiedCleanerCount: nearby.length,
    offers: nearby.map(({ cleaner, distanceKm: d }) => ({
      cleanerId: cleaner._id,
      distanceKm: Math.round(d * 100) / 100,
      status: 'pending',
      notifiedAt: now,
      expiresAt: offerExpiresAt,
    })),
    statusHistory: [
      {
        status: nearby.length ? 'open' : 'unmatched',
        at: now,
        by: 'system',
        note: nearby.length
          ? `Notified ${nearby.length} nearby cleaner(s)`
          : 'No available cleaners nearby',
      },
    ],
  });

  await request.save();

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
    await notify(clientId, {
      type: 'matching_started',
      title: 'Nearby cleaners notified',
      body: `${nearby.length} cleaner(s) were notified about your request.`,
      requestId: request._id,
    });
  } else {
    await notify(clientId, {
      type: 'unmatched',
      title: 'No cleaners nearby',
      body: 'No available cleaners were found near your location.',
      requestId: request._id,
    });
  }

  const plain = request.toObject();
  await attachPayToRequests(plain);
  return plain;
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
      request.assignedCleanerId
        ? 'Job is no longer available'
        : 'Request is no longer open'
    );
    err.status = 409;
    throw err;
  }

  const offer = request.offers.find(
    (o) => String(o.cleanerId) === String(cleanerId) && o.status === 'pending'
  );
  if (!offer) {
    const err = new Error('No pending offer for this cleaner');
    err.status = 409;
    throw err;
  }

  if (offer.expiresAt.getTime() < Date.now()) {
    offer.status = 'ignored';
    offer.respondedAt = new Date();
    await request.save();
    const err = new Error('Offer has expired');
    err.status = 409;
    throw err;
  }

  if (action === 'reject') {
    offer.status = 'rejected';
    offer.respondedAt = new Date();
    await request.save();
    return request;
  }

  if (action === 'ignore') {
    offer.status = 'ignored';
    offer.respondedAt = new Date();
    await request.save();
    return request;
  }

  if (action !== 'accept') {
    const err = new Error('Invalid action');
    err.status = 400;
    throw err;
  }

  // Race-safe first accept: only one updater can flip open → assigned
  const claimed = await CleaningRequest.findOneAndUpdate(
    { _id: requestId, status: 'open' },
    {
      $set: { status: 'assigned', assignedCleanerId: cleanerId },
      $push: {
        statusHistory: {
          status: 'assigned',
          at: new Date(),
          by: `cleaner:${cleanerId}`,
          note: 'Cleaner accepted',
        },
      },
    },
    { new: true }
  );

  if (!claimed) {
    const err = new Error('Job is no longer available');
    err.status = 409;
    throw err;
  }

  for (const o of claimed.offers) {
    if (String(o.cleanerId) === String(cleanerId)) {
      o.status = 'accepted';
      o.respondedAt = new Date();
    } else if (o.status === 'pending') {
      o.status = 'closed';
      o.respondedAt = new Date();
    }
  }
  await claimed.save();

  await notify(claimed.clientId, {
    type: 'assigned',
    title: 'Cleaner assigned',
    body: 'A cleaner accepted your cleaning request.',
    requestId: claimed._id,
  });

  // Only cleaners whose pending offer was closed — not prior reject/ignore
  const closedCleanerIds = claimed.offers
    .filter(
      (o) =>
        String(o.cleanerId) !== String(cleanerId) && o.status === 'closed'
    )
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

  return claimed;
}

const PROGRESS_ORDER = ['assigned', 'en_route', 'on_site', 'in_progress', 'completed'];

export async function advanceBooking(requestId, cleanerId, nextStatus) {
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
  if (String(request.assignedCleanerId) !== String(cleanerId)) {
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
  pushHistory(request, nextStatus, `cleaner:${cleanerId}`, 'Progress update');
  await request.save();

  await notify(request.clientId, {
    type: 'progress',
    title: 'Booking progress updated',
    body: `Status is now ${nextStatus.replace('_', ' ')}.`,
    requestId: request._id,
  });

  return request;
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
  for (const offer of request.offers) {
    if (offer.status === 'pending') {
      offer.status = 'closed';
      offer.respondedAt = new Date();
    }
  }
  pushHistory(request, 'cancelled', `${actor.role}:${actor.id}`, 'Cancelled');
  await request.save();

  const recipients = [request.clientId];
  if (request.assignedCleanerId) recipients.push(request.assignedCleanerId);
  await notifyMany(recipients, {
    type: 'cancelled',
    title: 'Request cancelled',
    body: 'This cleaning request was cancelled.',
    requestId: request._id,
  });

  return request;
}

/**
 * Soft-delete a cancelled request and hard-delete all notifications for it
 * (cleaners, admin, poster — every Notification with this requestId).
 */
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
  pushHistory(request, 'cancelled', `${actor.role}:${actor.id}`, 'Removed (soft-deleted)');
  await request.save();

  await Notification.deleteMany({ requestId: request._id });

  return request;
}

/**
 * Archive (hide) a request from the poster's active list. Job stays active for cleaners.
 */
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
  pushHistory(request, request.status, `${actor.role}:${actor.id}`, 'Archived (hidden from My requests)');
  await request.save();
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

  // Adjusting an unmatched request re-runs nearby matching
  if (wasUnmatched) {
    const now = new Date();
    const matchingExpiresAt = new Date(now.getTime() + config.matchingWindowSeconds * 1000);
    const nearby = await findNearbyAvailableCleaners(
      request.latitude,
      request.longitude
    );
    request.matchingExpiresAt = matchingExpiresAt;
    request.notifiedCleanerCount = nearby.length;
    request.offers = nearby.map(({ cleaner, distanceKm: d }) => ({
      cleanerId: cleaner._id,
      distanceKm: Math.round(d * 100) / 100,
      status: 'pending',
      notifiedAt: now,
      expiresAt: matchingExpiresAt,
    }));
    request.status = nearby.length ? 'open' : 'unmatched';
    pushHistory(
      request,
      request.status,
      `client:${clientId}`,
      nearby.length
        ? `Client adjusted; notified ${nearby.length} cleaner(s)`
        : 'Client adjusted; still no nearby cleaners'
    );
    await request.save();

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
      await notify(clientId, {
        type: 'matching_started',
        title: 'Nearby cleaners notified',
        body: `${nearby.length} cleaner(s) were notified about your request.`,
        requestId: request._id,
      });
    } else {
      await notify(clientId, {
        type: 'unmatched',
        title: 'No cleaners nearby',
        body: 'No available cleaners were found near your location.',
        requestId: request._id,
      });
    }
    const plain = request.toObject();
    await attachPayToRequests(plain);
    return plain;
  }

  pushHistory(request, 'open', `client:${clientId}`, 'Client updated request');
  await request.save();

  if (request.businessId && (scheduleTouched || patch.payRatePerHour != null)) {
    await syncJobPayForRequest(request, { payRatePerHour: patch.payRatePerHour });
  }

  const plain = request.toObject();
  await attachPayToRequests(plain);
  return plain;
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

  const closedCleanerIds = [];
  for (const offer of request.offers) {
    if (offer.status === 'pending') {
      offer.status = 'closed';
      offer.respondedAt = new Date();
      if (String(offer.cleanerId) !== String(cleanerId)) {
        closedCleanerIds.push(offer.cleanerId);
      }
    }
  }

  let offer = request.offers.find((o) => String(o.cleanerId) === String(cleanerId));
  if (!offer) {
    offer = {
      cleanerId,
      distanceKm: 0,
      status: 'accepted',
      notifiedAt: new Date(),
      expiresAt: new Date(),
      respondedAt: new Date(),
    };
    request.offers.push(offer);
  } else {
    offer.status = 'accepted';
    offer.respondedAt = new Date();
  }

  request.status = 'assigned';
  request.assignedCleanerId = cleanerId;
  pushHistory(request, 'assigned', `admin:${adminId}`, 'Admin force-assigned');
  await request.save();

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

  return request;
}

export async function processExpiries() {
  const now = new Date();

  // Expire individual pending offers → ignored
  const withPending = await CleaningRequest.find({
    ...notDeletedFilter,
    status: 'open',
    offers: { $elemMatch: { status: 'pending', expiresAt: { $lte: now } } },
  });

  for (const request of withPending) {
    let changed = false;
    for (const offer of request.offers) {
      if (offer.status === 'pending' && offer.expiresAt <= now) {
        offer.status = 'ignored';
        offer.respondedAt = now;
        changed = true;
      }
    }
    if (changed) await request.save();
  }

  // Matching window ended with no accept → unmatched
  const expiredMatching = await CleaningRequest.find({
    ...notDeletedFilter,
    status: 'open',
    matchingExpiresAt: { $lte: now },
  });

  for (const request of expiredMatching) {
    for (const offer of request.offers) {
      if (offer.status === 'pending') {
        offer.status = 'ignored';
        offer.respondedAt = now;
      }
    }
    request.status = 'unmatched';
    pushHistory(request, 'unmatched', 'system', 'Matching window ended');
    await request.save();
    await notify(request.clientId, {
      type: 'unmatched',
      title: 'No cleaner accepted',
      body: 'Matching ended without an accept. You can repost or adjust details.',
      requestId: request._id,
    });
  }
}
