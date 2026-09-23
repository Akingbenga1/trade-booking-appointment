import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  confirmCheckoutPayment,
  createCheckoutSession,
  getPaymentForRequest,
} from '../services/paymentService.js';

const router = Router();

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
