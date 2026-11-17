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

function requiredEmail(value) {
  const email = requiredText(value, 'Email', 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Enter a valid email');
    err.status = 400;
    throw err;
  }
  return email;
}

function requiredPhone(value) {
  const phone = requiredText(value, 'Phone', 30);
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    const err = new Error('Enter a phone number');
    err.status = 400;
    throw err;
  }
  return phone;
}

function toPublicTool(doc) {
  return {
    id: doc._id,
    name: doc.name,
    detail: doc.detail,
    category: doc.category,
    contactName: doc.contactName,
    email: doc.email,
    phone: doc.phone,
  };
}

router.get('/', async (_req, res) => {
  const list = await BoardTool.find().sort({ createdAt: -1 });
  res.json(list.map(toPublicTool));
});

router.post('/', async (req, res) => {
  try {
    const name = requiredText(req.body.name, 'Tool name', 80);
    const detail = requiredText(req.body.detail, 'What it is for', 400);
    const category = requiredText(req.body.category, 'Section', 80);
    const contactName = requiredText(req.body.contactName, 'Contact name', 80);
    const email = requiredEmail(req.body.email);
    const phone = requiredPhone(req.body.phone);
    const doc = await BoardTool.create({ name, detail, category, contactName, email, phone });
    res.status(201).json(toPublicTool(doc));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
