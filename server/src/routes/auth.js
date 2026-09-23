import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import {
  consumeMagicLink,
  publicUser,
  registerBusinessRepresentative,
} from '../services/businessService.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, role required' });
    }
    // Business self-onboarding uses /register/business — do not create business via this path.
    if (!['client', 'cleaner', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role,
    });
    const token = signToken(user);
    res.status(201).json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/register/business', async (req, res) => {
  try {
    const { name, email, businessName, address, latitude, longitude, phone } = req.body;
    console.log(`[auth] POST /register/business email=${email || '(missing)'}`);
    const { user, business } = await registerBusinessRepresentative({
      name,
      email,
      businessName,
      address,
      latitude,
      longitude,
      phone,
    });
    console.log(
      `[auth] register/business OK userId=${user._id} businessId=${business._id}`
    );
    res.status(201).json({
      ok: true,
      message: 'Check your email for a link to finish signup and set your password.',
      user: { id: user._id, email: user.email, role: user.role },
      business: {
        id: business._id,
        name: business.name,
        phone: business.phone,
        address: business.address,
        latitude: business.latitude,
        longitude: business.longitude,
      },
    });
  } catch (err) {
    console.error(`[auth] register/business FAIL: ${err.message}`);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/magic-link/verify', async (req, res) => {
  try {
    console.log('[auth] POST /magic-link/verify');
    const user = await consumeMagicLink(req.body?.token);
    const token = signToken(user);
    console.log(`[auth] magic-link/verify OK email=${user.email}`);
    res.json({
      token,
      user: publicUser(user),
      mustSetPassword: Boolean(user.mustSetPassword),
    });
  } catch (err) {
    console.error(`[auth] magic-link/verify FAIL: ${err.message}`);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/set-password', requireAuth, async (req, res) => {
  try {
    console.log(`[auth] POST /set-password userId=${req.user.id}`);
    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.passwordHash = await bcrypt.hash(String(password), 10);
    user.mustSetPassword = false;
    await user.save();
    const token = signToken(user);
    console.log(`[auth] set-password OK email=${user.email}`);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(`[auth] set-password FAIL: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`[auth] POST /login email=${(email || '').toLowerCase()}`);
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.isDisabled) return res.status(403).json({ error: 'Account disabled' });
    if (!user.passwordHash) {
      console.warn(`[auth] login blocked — password not set yet email=${user.email}`);
      return res.status(401).json({
        error: 'Finish signup from your email link and set a password first',
      });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    console.log(`[auth] login OK email=${user.email} role=${user.role}`);
    res.json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(publicUser(user));
});

export default router;
