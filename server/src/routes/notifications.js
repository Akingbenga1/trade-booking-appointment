import { Router } from 'express';
import { Notification } from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const list = await Notification.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(list);
});

router.post('/:id/read', requireAuth, async (req, res) => {
  const note = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { read: true } },
    { new: true }
  );
  if (!note) return res.status(404).json({ error: 'Not found' });
  res.json(note);
});

export default router;
