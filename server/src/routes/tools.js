import { Router } from 'express';
import { BoardTool } from '../models/BoardTool.js';

const router = Router();

function requiredText(value, label, max) {
  const text = String(value || '').trim();
  if (!text) {
    const err = new Error(`${label} is required`);
    err.status = 400;
    throw err;
  }
  if (text.length > max) {
    const err = new Error(`${label} must be ${max} characters or fewer`);
    err.status = 400;
    throw err;
  }
  return text;
}

function toPublicTool(doc) {
  return {
    id: doc._id,
    name: doc.name,
    detail: doc.detail,
    category: doc.category,
  };
}

router.get('/', async (_req, res) => {
  const list = await BoardTool.find().sort({ createdAt: -1 });
  res.json(list.map(toPublicTool));
});

router.post('/', async (req, res) => {
  try {
    const name = requiredText(req.body.name, 'Name', 80);
    const detail = requiredText(req.body.detail, 'What it is for', 400);
    const category = requiredText(req.body.category, 'Section', 80);
    const doc = await BoardTool.create({ name, detail, category });
    res.status(201).json(toPublicTool(doc));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
