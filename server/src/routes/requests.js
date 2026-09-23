import { Router } from 'express';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createCleaningRequest,
  respondToOffer,
  advanceBooking,
  cancelRequest,
  removeCancelledRequest,
  updateOpenRequest,
  notDeletedFilter,
} from '../services/requestService.js';
import { isBusinessMember, listBusinessesForUser } from '../services/businessService.js';
import { attachPayToRequests } from '../services/jobPay.js';
import { parsePlaceFields } from '../services/place.js';

const router = Router();

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
  let filter;
  if (req.user.role === 'business') {
    const businesses = await listBusinessesForUser(req.user.id);
    const ids = businesses.map((b) => b._id);
    filter = { businessId: { $in: ids } };
  } else {
    filter = { clientId: req.user.id };
  }
  const list = await CleaningRequest.find({ ...filter, ...notDeletedFilter })
    .sort({ createdAt: -1 })
    .populate('assignedCleanerId', 'name email')
    .populate('businessId', 'name');
  const plain = list.map((d) => d.toObject());
  await attachPayToRequests(plain);
  res.json(plain);
});

router.get('/offers', requireAuth, requireRole('cleaner'), async (req, res) => {
  const list = await CleaningRequest.find({
    ...notDeletedFilter,
    'offers.cleanerId': req.user.id,
  })
    .sort({ createdAt: -1 })
    .populate('clientId', 'name email')
    .populate('businessId', 'name');

  const plainDocs = list.map((doc) => doc.toObject());
  await attachPayToRequests(plainDocs);

  const shaped = plainDocs.map((doc) => {
    const offer = doc.offers.find((o) => String(o.cleanerId) === req.user.id);
    return {
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
        pay: doc.pay || null,
      },
      offer: offer
        ? {
            id: offer._id,
            status: offer.status,
            distanceKm: offer.distanceKm,
            expiresAt: offer.expiresAt,
            notifiedAt: offer.notifiedAt,
            respondedAt: offer.respondedAt,
          }
        : null,
    };
  });
  res.json(shaped);
});

router.get('/assigned', requireAuth, requireRole('cleaner'), async (req, res) => {
  const list = await CleaningRequest.find({
    ...notDeletedFilter,
    assignedCleanerId: req.user.id,
    status: { $in: ['assigned', 'en_route', 'on_site', 'in_progress', 'completed'] },
  }).sort({ updatedAt: -1 });
  const plain = list.map((d) => d.toObject());
  await attachPayToRequests(plain);
  res.json(plain);
});

router.get('/:id', requireAuth, async (req, res) => {
  const doc = await CleaningRequest.findById(req.params.id)
    .populate('clientId', 'name email')
    .populate('assignedCleanerId', 'name email')
    .populate('offers.cleanerId', 'name email')
    .populate('businessId', 'name');
  if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  const isClient = String(doc.clientId._id || doc.clientId) === req.user.id;
  const isBizMember =
    doc.businessId &&
    (await isBusinessMember(req.user.id, doc.businessId._id || doc.businessId));
  const isAssigned =
    doc.assignedCleanerId &&
    String(doc.assignedCleanerId._id || doc.assignedCleanerId) === req.user.id;
  const isOffered = doc.offers.some(
    (o) => String(o.cleanerId._id || o.cleanerId) === req.user.id
  );

  if (!isAdmin && !isClient && !isBizMember && !isAssigned && !isOffered) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const plain = doc.toObject();
  await attachPayToRequests(plain);

  // Poster / business members see summary without full offer trail unless admin
  if ((isClient || isBizMember) && !isAdmin) {
    return res.json({
      ...plain,
      offers: undefined,
      notifiedCleanerCount: doc.notifiedCleanerCount,
    });
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

router.post('/:id/progress', requireAuth, requireRole('cleaner'), async (req, res) => {
  try {
    const { status } = req.body;
    const request = await advanceBooking(req.params.id, req.user.id, status);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

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

export default router;
