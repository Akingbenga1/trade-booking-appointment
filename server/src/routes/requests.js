import { Router } from 'express';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { RequestOffer } from '../models/RequestOffer.js';
import { JobAssignment } from '../models/JobAssignment.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createCleaningRequest,
  respondToOffer,
  advanceBooking,
  cancelRequest,
  removeCancelledRequest,
  archiveRequest,
  updateOpenRequest,
  notDeletedFilter,
  activeForPosterFilter,
  hydrateRequest,
  expressAgencyInterest,
  pickAgencyForRequest,
  agencyAcceptRequest,
  assignAgencyStaff,
  assignAgencyStaffMany,
  removeAgencyStaff,
  reassignAgencyStaff,
  staffRespondToAssignment,
  listInterestsForRequest,
} from '../services/requestService.js';
import { isBusinessMember, listBusinessesForUser } from '../services/businessService.js';
import { isAgencyMember } from '../services/agencyService.js';
import { attachPayToRequests } from '../services/jobPay.js';
import { parsePlaceFields } from '../services/place.js';

const router = Router();

async function posterOwnershipFilter(user) {
  if (user.role === 'business') {
    const businesses = await listBusinessesForUser(user.id);
    const ids = businesses.map((b) => b._id);
    return { businessId: { $in: ids } };
  }
  return { clientId: user.id };
}

router.post('/', requireAuth, requireRole('client', 'business'), async (req, res) => {
  try {
    const {
      serviceDetails,
      scheduleStart,
      scheduleEnd,
      address,
      latitude,
      longitude,
      businessId,
      payRatePerHour,
    } = req.body;
    if (!serviceDetails) {
      return res.status(400).json({ error: 'serviceDetails required' });
    }

    let place;
    try {
      place = parsePlaceFields({ address, latitude, longitude });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    let ownerBusinessId;
    if (req.user.role === 'business') {
      if (!businessId) {
        return res.status(400).json({ error: 'businessId required for business posts' });
      }
      const member = await isBusinessMember(req.user.id, businessId);
      if (!member) return res.status(403).json({ error: 'Not a member of that business' });
      ownerBusinessId = businessId;
    }

    const request = await createCleaningRequest({
      clientId: req.user.id,
      businessId: ownerBusinessId,
      serviceDetails,
      scheduleStart,
      scheduleEnd,
      ...place,
      payRatePerHour: ownerBusinessId ? payRatePerHour : undefined,
    });
    res.status(201).json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/mine', requireAuth, requireRole('client', 'business'), async (req, res) => {
  const filter = await posterOwnershipFilter(req.user);
  const list = await CleaningRequest.find({ ...filter, ...activeForPosterFilter })
    .sort({ createdAt: -1 })
    .populate('assignedCleanerId', 'name email')
    .populate('assignedAgencyId', 'name')
    .populate('assignedStaffIds', 'name email')
    .populate('businessId', 'name');
  const plain = [];
  for (const d of list) {
    plain.push(await hydrateRequest(d));
  }
  res.json(plain);
});

router.get('/archived', requireAuth, requireRole('client', 'business'), async (req, res) => {
  const filter = await posterOwnershipFilter(req.user);
  const list = await CleaningRequest.find({
    ...filter,
    deletedAt: null,
    archivedAt: { $ne: null },
  })
    .sort({ archivedAt: -1 })
    .populate('assignedCleanerId', 'name email')
    .populate('assignedAgencyId', 'name')
    .populate('assignedStaffIds', 'name email')
    .populate('businessId', 'name');
  const plain = [];
  for (const d of list) {
    plain.push(await hydrateRequest(d));
  }
  res.json(plain);
});

router.get('/offers', requireAuth, requireRole('cleaner'), async (req, res) => {
  const offers = await RequestOffer.find({
    kind: 'cleaner',
    cleanerId: req.user.id,
  }).sort({ createdAt: -1 });

  const requestIds = offers.map((o) => o.requestId);
  const requests = await CleaningRequest.find({
    _id: { $in: requestIds },
    ...notDeletedFilter,
  })
    .populate('clientId', 'name email')
    .populate('businessId', 'name');
  const byId = new Map(requests.map((r) => [String(r._id), r]));

  const shaped = [];
  for (const offer of offers) {
    const doc = byId.get(String(offer.requestId));
    if (!doc) continue;
    const plain = doc.toObject();
    await attachPayToRequests(plain);
    shaped.push({
      request: {
        id: doc._id,
        serviceDetails: doc.serviceDetails,
        scheduleStart: doc.scheduleStart,
        scheduleEnd: doc.scheduleEnd,
        preferredTime: doc.preferredTime,
        address: doc.address,
        latitude: doc.latitude,
        longitude: doc.longitude,
        status: doc.status,
        assignedCleanerId: doc.assignedCleanerId,
        client: doc.clientId,
        business: doc.businessId,
        createdAt: doc.createdAt,
        pay: plain.pay || null,
      },
      offer: {
        id: offer._id,
        status: offer.status,
        distanceKm: offer.distanceKm,
        expiresAt: offer.expiresAt,
        notifiedAt: offer.notifiedAt,
        respondedAt: offer.respondedAt,
      },
    });
  }
  res.json(shaped);
});

router.get('/assigned', requireAuth, requireRole('cleaner', 'agency_staff'), async (req, res) => {
  let list;
  if (req.user.role === 'agency_staff') {
    const assignments = await JobAssignment.find({
      staffUserId: req.user.id,
      confirmStatus: { $in: ['pending', 'confirmed'] },
    });
    const ids = assignments.map((a) => a.requestId);
    list = await CleaningRequest.find({
      ...notDeletedFilter,
      _id: { $in: ids },
      status: { $in: ['assigned', 'en_route', 'on_site', 'in_progress', 'completed'] },
    }).sort({ updatedAt: -1 });
    const plain = [];
    for (const d of list) {
      const h = await hydrateRequest(d);
      h.myAssignment = assignments.find((a) => String(a.requestId) === String(d._id));
      plain.push(h);
    }
    return res.json(plain);
  }

  list = await CleaningRequest.find({
    ...notDeletedFilter,
    assignedCleanerId: req.user.id,
    status: { $in: ['assigned', 'en_route', 'on_site', 'in_progress', 'completed'] },
  }).sort({ updatedAt: -1 });
  const plain = [];
  for (const d of list) {
    plain.push(await hydrateRequest(d));
  }
  res.json(plain);
});

router.get('/:id/interests', requireAuth, requireRole('client', 'business', 'admin'), async (req, res) => {
  try {
    const doc = await CleaningRequest.findById(req.params.id);
    if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });
    const isAdmin = req.user.role === 'admin';
    const isClient = String(doc.clientId) === req.user.id;
    const isBiz =
      doc.businessId && (await isBusinessMember(req.user.id, doc.businessId));
    if (!isAdmin && !isClient && !isBiz) return res.status(403).json({ error: 'Forbidden' });
    res.json(await listInterestsForRequest(doc._id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const doc = await CleaningRequest.findById(req.params.id)
    .populate('clientId', 'name email')
    .populate('assignedCleanerId', 'name email')
    .populate('assignedAgencyId', 'name phone')
    .populate('assignedStaffIds', 'name email')
    .populate('businessId', 'name');
  if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  const isClient = String(doc.clientId._id || doc.clientId) === req.user.id;
  const isBizMember =
    doc.businessId &&
    (await isBusinessMember(req.user.id, doc.businessId._id || doc.businessId));
  const isAssignedCleaner =
    doc.assignedCleanerId &&
    String(doc.assignedCleanerId._id || doc.assignedCleanerId) === req.user.id;
  const offer = await RequestOffer.findOne({
    requestId: doc._id,
    kind: 'cleaner',
    cleanerId: req.user.id,
  });
  const agencyOffer = await RequestOffer.findOne({
    requestId: doc._id,
    kind: 'agency',
  });
  let isAgencySide = false;
  if (doc.assignedAgencyId || agencyOffer) {
    const agencyId = doc.assignedAgencyId?._id || doc.assignedAgencyId || agencyOffer?.agencyId;
    if (agencyId) {
      isAgencySide = await isAgencyMember(req.user.id, agencyId);
    }
  }
  const staffAssignment = await JobAssignment.findOne({
    requestId: doc._id,
    staffUserId: req.user.id,
  });

  if (
    !isAdmin &&
    !isClient &&
    !isBizMember &&
    !isAssignedCleaner &&
    !offer &&
    !isAgencySide &&
    !staffAssignment
  ) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const plain = await hydrateRequest(doc, {
    includeOffers: isAdmin,
    includeEvents: isAdmin,
  });

  if ((isClient || isBizMember) && !isAdmin) {
    plain.offers = undefined;
    plain.notifiedCleanerCount = doc.notifiedCleanerCount;
    plain.notifiedAgencyCount = doc.notifiedAgencyCount;
  }
  res.json(plain);
});

router.post('/:id/respond', requireAuth, requireRole('cleaner'), async (req, res) => {
  try {
    const { action } = req.body;
    if (!['accept', 'reject', 'ignore'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept, reject, or ignore' });
    }
    const request = await respondToOffer(req.params.id, req.user.id, action);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/progress', requireAuth, requireRole('cleaner', 'cleaning_agency'), async (req, res) => {
  try {
    const { status } = req.body;
    const request = await advanceBooking(req.params.id, req.user, status);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post(
  '/:id/agency-interest',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      const { agencyId } = req.body;
      if (!agencyId) return res.status(400).json({ error: 'agencyId required' });
      const interest = await expressAgencyInterest(req.params.id, agencyId, req.user.id);
      res.json(interest);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:id/pick-agency',
  requireAuth,
  requireRole('client', 'business', 'admin'),
  async (req, res) => {
    try {
      const { agencyId } = req.body;
      if (!agencyId) return res.status(400).json({ error: 'agencyId required' });
      const request = await pickAgencyForRequest(req.params.id, agencyId, req.user);
      res.json(request);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:id/agency-accept',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      const { agencyId } = req.body;
      if (!agencyId) return res.status(400).json({ error: 'agencyId required' });
      const request = await agencyAcceptRequest(req.params.id, agencyId, req.user.id);
      res.json(request);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:id/assign-staff',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      const { agencyId, staffUserId, payRatePerHour } = req.body;
      const many = Array.isArray(req.body.staff);
      if (!agencyId || (!many && (!staffUserId || payRatePerHour == null))) {
        return res
          .status(400)
          .json({ error: 'agencyId, staffUserId, and payRatePerHour required' });
      }
      const request = Array.isArray(req.body.staff)
        ? await assignAgencyStaffMany(req.params.id, agencyId, req.user.id, req.body.staff)
        : await assignAgencyStaff(req.params.id, agencyId, req.user.id, {
            staffUserId,
            payRatePerHour,
          });
      res.json(request);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:id/remove-staff',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      const { agencyId, staffUserId } = req.body;
      if (!agencyId || !staffUserId) {
        return res.status(400).json({ error: 'agencyId and staffUserId required' });
      }
      const request = await removeAgencyStaff(
        req.params.id,
        agencyId,
        req.user.id,
        staffUserId
      );
      res.json(request);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:id/reassign-staff',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      const { agencyId, fromStaffUserId, toStaffUserId, payRatePerHour } = req.body;
      if (!agencyId || !fromStaffUserId || !toStaffUserId || payRatePerHour == null) {
        return res.status(400).json({
          error: 'agencyId, fromStaffUserId, toStaffUserId, and payRatePerHour required',
        });
      }
      const request = await reassignAgencyStaff(req.params.id, agencyId, req.user.id, {
        fromStaffUserId,
        toStaffUserId,
        payRatePerHour,
      });
      res.json(request);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:id/staff-respond',
  requireAuth,
  requireRole('agency_staff'),
  async (req, res) => {
    try {
      const { action } = req.body;
      const assignment = await staffRespondToAssignment(req.params.id, req.user.id, action);
      res.json(assignment);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.patch('/:id', requireAuth, requireRole('client', 'business'), async (req, res) => {
  try {
    const patch = { ...req.body };
    if (patch.address != null || patch.latitude != null || patch.longitude != null) {
      Object.assign(
        patch,
        parsePlaceFields({
          address: patch.address,
          latitude: patch.latitude,
          longitude: patch.longitude,
        })
      );
    }
    const request = await updateOpenRequest(req.params.id, req.user.id, patch);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/cancel', requireAuth, requireRole('client', 'business', 'admin'), async (req, res) => {
  try {
    const request = await cancelRequest(req.params.id, req.user);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/remove', requireAuth, requireRole('client', 'business', 'admin'), async (req, res) => {
  try {
    const request = await removeCancelledRequest(req.params.id, req.user);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/archive', requireAuth, requireRole('client', 'business', 'admin'), async (req, res) => {
  try {
    const request = await archiveRequest(req.params.id, req.user);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
