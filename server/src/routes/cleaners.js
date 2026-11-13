import { Router } from 'express';
import { User } from '../models/User.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post(
  '/availability',
  requireAuth,
  requireRole('cleaner', 'agency_staff'),
  async (req, res) => {
  try {
    const { isAvailable, lat, lng } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    if (isAvailable) {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'lat and lng required when going available' });
      }
      user.isAvailable = true;
      user.currentLocation = { lat, lng, updatedAt: new Date() };
    } else {
      user.isAvailable = false;
    }
    await user.save();
    res.json({
      isAvailable: user.isAvailable,
      currentLocation: user.currentLocation,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
  }
);

router.post(
  '/location',
  requireAuth,
  requireRole('cleaner', 'agency_staff'),
  async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng required' });
    }
    const user = await User.findById(req.user.id);
    user.currentLocation = { lat, lng, updatedAt: new Date() };
    await user.save();
    res.json({ currentLocation: user.currentLocation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
  }
);

export default router;
