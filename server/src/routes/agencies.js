import { Router } from 'express';
import { RequestOffer } from '../models/RequestOffer.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { AgencyJobInterest } from '../models/AgencyJobInterest.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createAgencyStaff,
  listAgenciesForUser,
  listAgencyStaff,
  isAgencyOwnerOrAdmin,
} from '../services/agencyService.js';
import { hydrateRequest, notDeletedFilter } from '../services/requestService.js';
import { attachPayToRequests } from '../services/jobPay.js';

const router = Router();

router.get('/mine', requireAuth, requireRole('cleaning_agency', 'agency_staff'), async (req, res) => {
  try {
    const agencies = await listAgenciesForUser(req.user.id);
    res.json(agencies);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get(
  '/:agencyId/staff',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      if (!(await isAgencyOwnerOrAdmin(req.user.id, req.params.agencyId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      res.json(await listAgencyStaff(req.params.agencyId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/:agencyId/staff',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      const result = await createAgencyStaff(req.user.id, req.params.agencyId, req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.get('/:agencyId/offers', requireAuth, requireRole('cleaning_agency'), async (req, res) => {
  try {
    if (!(await isAgencyOwnerOrAdmin(req.user.id, req.params.agencyId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const offers = await RequestOffer.find({
      kind: 'agency',
      agencyId: req.params.agencyId,
    }).sort({ createdAt: -1 });
    const requestIds = offers.map((o) => o.requestId);
    const requests = await CleaningRequest.find({
      _id: { $in: requestIds },
      ...notDeletedFilter,
    })
      .populate('clientId', 'name email role')
      .populate('businessId', 'name');
    const byId = new Map(requests.map((r) => [String(r._id), r]));
    const interests = await AgencyJobInterest.find({
      agencyId: req.params.agencyId,
      requestId: { $in: requestIds },
    });
    const interestByRequest = new Map(
      interests.map((row) => [String(row.requestId), row.status])
    );
    const shaped = [];
    for (const offer of offers) {
      const doc = byId.get(String(offer.requestId));
      if (!doc) continue;
      const plain = await hydrateRequest(doc);
      const client = plain.clientId && plain.clientId.name ? plain.clientId : null;
      const business = plain.businessId && plain.businessId.name ? plain.businessId : null;
      const selectedId = plain.selectedAgencyId?._id || plain.selectedAgencyId;
      shaped.push({
        request: plain,
        offer: {
          id: offer._id,
          status: offer.status,
          distanceKm: offer.distanceKm,
          expiresAt: offer.expiresAt,
          notifiedAt: offer.notifiedAt,
        },
        jobType: business ? 'Business' : 'Personal client',
        owner: client
          ? { name: client.name, email: client.email, role: client.role }
          : null,
        businessName: business ? business.name : null,
        interestStatus: interestByRequest.get(String(plain._id)) || null,
        canLock:
          plain.status === 'open' && String(selectedId || '') === String(req.params.agencyId),
      });
    }
    res.json(shaped);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get(
  '/:agencyId/jobs',
  requireAuth,
  requireRole('cleaning_agency'),
  async (req, res) => {
    try {
      if (!(await isAgencyOwnerOrAdmin(req.user.id, req.params.agencyId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const list = await CleaningRequest.find({
        ...notDeletedFilter,
        assignedAgencyId: req.params.agencyId,
      }).sort({ updatedAt: -1 });
      const plain = [];
      for (const d of list) {
        plain.push(await hydrateRequest(d));
      }
      await attachPayToRequests(plain);
      res.json(plain);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

export default router;
