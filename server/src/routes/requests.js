import { Router } from 'express';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createCleaningRequest,
  respondToOffer,
  advanceBooking,
  cancelRequest,
  updateOpenRequest,
} from '../services/requestService.js';

const router = Router();

router.post('/', requireAuth, requireRole('client', 'business'), async (req, res) => {
  try {
    const { serviceDetails, preferredTime, location } = req.body;
    if (!serviceDetails || !preferredTime || !location?.address) {
      return res.status(400).json({ error: 'serviceDetails, preferredTime, location required' });
    }
    if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return res.status(400).json({ error: 'location.lat and location.lng required' });
    }
    const request = await createCleaningRequest({
      clientId: req.user.id,
      serviceDetails,
      preferredTime,
      location,
    });
    res.status(201).json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/mine', requireAuth, requireRole('client', 'business'), async (req, res) => {
  const list = await CleaningRequest.find({ clientId: req.user.id })
    .sort({ createdAt: -1 })
    .populate('assignedCleanerId', 'name email');
  res.json(list);
});

router.get('/offers', requireAuth, requireRole('cleaner'), async (req, res) => {
  const list = await CleaningRequest.find({
    'offers.cleanerId': req.user.id,
  })
    .sort({ createdAt: -1 })
    .populate('clientId', 'name email');

  const shaped = list.map((doc) => {
    const offer = doc.offers.find((o) => String(o.cleanerId) === req.user.id);
    return {
      request: {
        id: doc._id,
        serviceDetails: doc.serviceDetails,
        preferredTime: doc.preferredTime,
        location: doc.location,
        status: doc.status,
        assignedCleanerId: doc.assignedCleanerId,
        client: doc.clientId,
        createdAt: doc.createdAt,
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
    assignedCleanerId: req.user.id,
    status: { $in: ['assigned', 'en_route', 'on_site', 'in_progress', 'completed'] },
  }).sort({ updatedAt: -1 });
  res.json(list);
});

router.get('/:id', requireAuth, async (req, res) => {
  const doc = await CleaningRequest.findById(req.params.id)
    .populate('clientId', 'name email')
    .populate('assignedCleanerId', 'name email')
    .populate('offers.cleanerId', 'name email');
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  const isClient = String(doc.clientId._id || doc.clientId) === req.user.id;
  const isAssigned = doc.assignedCleanerId && String(doc.assignedCleanerId._id || doc.assignedCleanerId) === req.user.id;
  const isOffered = doc.offers.some((o) => String(o.cleanerId._id || o.cleanerId) === req.user.id);

  if (!isAdmin && !isClient && !isAssigned && !isOffered) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Clients see summary without full offer trail unless they are admin path
  if (isClient && !isAdmin) {
    return res.json({
      ...doc.toObject(),
      offers: undefined,
      notifiedCleanerCount: doc.notifiedCleanerCount,
    });
  }
  res.json(doc);
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
    const request = await updateOpenRequest(req.params.id, req.user.id, req.body);
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

export default router;
