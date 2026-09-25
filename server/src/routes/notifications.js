import { Router } from 'express';
import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { PushDevice } from '../models/PushDevice.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { isFcmConfigured } from '../services/fcm.js';

const router = Router();

const PUSH_ROLES = new Set(['cleaner', 'business']);

router.get('/', requireAuth, async (req, res) => {
  const list = await Notification.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(list);
});

/** Public-ish config for the signed-in client (whether to enable FCM). */
router.get('/push/config', requireAuth, (_req, res) => {
  res.json({
    enabled: isFcmConfigured(),
    roles: [...PUSH_ROLES],
    emailFallbackSeconds: config.notify.emailFallbackSeconds,
  });
});

/**
 * Register or refresh an FCM device token (web or Android).
 * Body: { token, platform: 'web' | 'android' }
 */
router.post('/devices', requireAuth, async (req, res) => {
  try {
    if (!PUSH_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Push is only for cleaners and business users' });
    }
    const token = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || '').trim();
    if (!token || !['web', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'token and platform (web|android) required' });
    }

    const existing = await PushDevice.findOne({ token });
    if (existing && String(existing.userId) !== String(req.user.id)) {
      return res
        .status(409)
        .json({ error: 'Token already registered to another user' });
    }

    const device = await PushDevice.findOneAndUpdate(
      { token },
      {
        userId: req.user.id,
        token,
        platform,
        active: true,
        lastSeenAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({
      id: device._id,
      platform: device.platform,
      active: device.active,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** Deactivate a token (logout / permission revoked). */
router.delete('/devices', requireAuth, async (req, res) => {
  const token = String(req.body?.token || req.query?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });
  await PushDevice.updateMany(
    { userId: req.user.id, token },
    { $set: { active: false } }
  );
  res.json({ ok: true });
});

router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const note = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { read: true } },
      { new: true }
    );
    if (!note) return res.status(404).json({ error: 'Not found' });
    res.json(note);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
