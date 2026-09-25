import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  confirmCheckoutPayment,
  createCheckoutSession,
  getPaymentForRequest,
  listBusinessTransactions,
} from '../services/paymentService.js';

const router = Router();

router.get(
  '/transactions',
  requireAuth,
  requireRole('business'),
  async (req, res) => {
    try {
      const list = await listBusinessTransactions(
        req.user,
        req.query.businessId || req.query.business_id
      );
      res.json(list);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.get(
  '/request/:requestId',
  requireAuth,
  requireRole('client', 'business', 'admin'),
  async (req, res) => {
    try {
      const data = await getPaymentForRequest(req.params.requestId, req.user);
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  '/checkout/:requestId',
  requireAuth,
  requireRole('client', 'business'),
  async (req, res) => {
    try {
      const result = await createCheckoutSession(req.params.requestId, req.user);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

/** Browser return backup; remove once webhooks are trusted. */
router.post(
  '/confirm/:requestId',
  requireAuth,
  requireRole('client', 'business', 'admin'),
  async (req, res) => {
    try {
      const result = await confirmCheckoutPayment(
        req.params.requestId,
        req.user,
        req.body?.sessionId || req.query.session_id
      );
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

export default router;
