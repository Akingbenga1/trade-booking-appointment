import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  confirmCheckoutPayment,
  createCheckoutSession,
  getPaymentForRequest,
  listBusinessTransactions,
} from '../services/paymentService.js';
import {
  listReceiptJobsForBusiness,
  readReceiptFile,
  savePaymentReceipt,
} from '../services/receiptService.js';
import fs from 'fs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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

router.get(
  '/receipts/jobs',
  requireAuth,
  requireRole('business'),
  async (req, res) => {
    try {
      const rows = await listReceiptJobsForBusiness(req.user, req.query.businessId);
      res.json(rows);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post('/receipts', requireAuth, requireRole('business'), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Could not read that file' });
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a PDF or image file' });
      const receipt = await savePaymentReceipt(req.user, {
        requestId: req.body.requestId,
        agencyId: req.body.agencyId,
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      });
      res.status(201).json({
        id: receipt._id,
        originalName: receipt.originalName,
        createdAt: receipt.createdAt,
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });
});

router.get('/receipts/:receiptId/file', requireAuth, async (req, res) => {
  try {
    const found = await readReceiptFile(req.user, req.params.receiptId);
    res.setHeader('Content-Type', found.receipt.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${found.downloadName}"`
    );
    fs.createReadStream(found.filePath).pipe(res);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
