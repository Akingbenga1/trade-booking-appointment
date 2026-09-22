import { Router } from 'express';
import { User } from '../models/User.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { forceAssign, cancelRequest } from '../services/requestService.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/requests', async (_req, res) => {
  const list = await CleaningRequest.find()
    .sort({ createdAt: -1 })
    .populate('clientId', 'name email')
    .populate('assignedCleanerId', 'name email');
  res.json(list);
});

router.get('/requests/:id', async (req, res) => {
  const doc = await CleaningRequest.findById(req.params.id)
    .populate('clientId', 'name email')
    .populate('assignedCleanerId', 'name email')
    .populate('offers.cleanerId', 'name email');
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

router.get('/users', async (_req, res) => {
  const users = await User.find().select('-passwordHash').sort({ role: 1, name: 1 });
  res.json(users);
});

router.patch('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot manage admin accounts here' });
    }

    if (typeof req.body.isDisabled === 'boolean') {
      user.isDisabled = req.body.isDisabled;
      if (user.isDisabled && user.role === 'cleaner') {
        user.isAvailable = false;
      }
    }
    if (user.role === 'cleaner' && typeof req.body.isAvailable === 'boolean') {
      if (req.body.isAvailable && !user.currentLocation?.lat) {
        return res.status(400).json({ error: 'Cleaner needs a location before going live' });
      }
      user.isAvailable = req.body.isAvailable;
    }

    await user.save();
    const out = user.toObject();
    delete out.passwordHash;
    res.json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/requests/:id/force-assign', async (req, res) => {
  try {
    const { cleanerId } = req.body;
    if (!cleanerId) return res.status(400).json({ error: 'cleanerId required' });
    const request = await forceAssign(req.params.id, cleanerId, req.user.id);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/requests/:id/cancel', async (req, res) => {
  try {
    const request = await cancelRequest(req.params.id, req.user);
    res.json(request);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/stats', async (_req, res) => {
  const rows = await CleaningRequest.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const stats = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  res.json(stats);
});

export default router;
