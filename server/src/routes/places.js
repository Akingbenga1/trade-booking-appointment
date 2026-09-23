import { Router } from 'express';
import { reverseGeocode, searchPlaces } from '../services/places.js';

const router = Router();

// Public: used on business signup before the user has a session.
router.get('/search', async (req, res) => {
  try {
    const results = await searchPlaces(req.query.q);
    res.json(results);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/reverse', async (req, res) => {
  try {
    const place = await reverseGeocode(req.query.lat, req.query.lng);
    res.json(place);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
