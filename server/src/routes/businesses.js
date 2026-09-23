import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createBusinessForUser,
  listBusinessesForUser,
} from '../services/businessService.js';
import { User } from '../models/User.js';

const router = Router();

router.get('/', requireAuth, requireRole('business'), async (req, res) => {
  try {
    const list = await listBusinessesForUser(req.user.id);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireRole('business'), async (req, res) => {
  try {
    const { name, phone, address, latitude, longitude } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'name, phone, and address are required' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const business = await createBusinessForUser(user, {
      name,
      phone,
      address,
      latitude,
      longitude,
    });
    res.status(201).json(business);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
