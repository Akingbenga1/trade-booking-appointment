import crypto from 'crypto';
import { Business } from '../models/Business.js';
import { BusinessMembership } from '../models/BusinessMembership.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { parsePlaceFields } from './place.js';
import { enqueueEmail } from './emailQueue.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createMagicToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + config.magicLinkTtlMinutes * 60 * 1000),
  };
}

export function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustSetPassword: Boolean(user.mustSetPassword),
    isAvailable: user.isAvailable,
    currentLocation: user.currentLocation,
  };
}

export async function isBusinessMember(userId, businessId) {
  if (!businessId) return false;
  const row = await BusinessMembership.findOne({
    businessId,
    userId,
  }).select('_id');
  return Boolean(row);
}

export async function listBusinessesForUser(userId) {
  const memberships = await BusinessMembership.find({ userId }).select('businessId');
  const ids = memberships.map((m) => m.businessId);
  if (!ids.length) return [];
  return Business.find({ _id: { $in: ids } }).sort({ createdAt: 1 });
}

async function addBusinessMembership(businessId, userId, memberRole = 'owner') {
  await BusinessMembership.findOneAndUpdate(
    { businessId, userId },
    { businessId, userId, memberRole },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function createBusinessForUser(user, { name, phone, address, latitude, longitude }) {
  const place = parsePlaceFields({ address, latitude, longitude });
  const business = await Business.create({
    name: String(name).trim(),
    phone: String(phone).trim(),
    ...place,
    createdBy: user._id,
  });
  await addBusinessMembership(business._id, user._id, 'owner');
  return business;
}

export async function registerBusinessRepresentative({
  name,
  email,
  businessName,
  address,
  latitude,
  longitude,
  phone,
}) {
  const normalizedEmail = String(email).trim().toLowerCase();
  console.log(`[signup] business register start email=${normalizedEmail}`);
  if (!name?.trim() || !normalizedEmail || !businessName?.trim() || !phone?.trim()) {
    const err = new Error('name, email, businessName, address, and phone are required');
    err.status = 400;
    throw err;
  }

  let place;
  try {
    place = parsePlaceFields({ address, latitude, longitude });
  } catch (err) {
    err.message = 'name, email, businessName, address, latitude, longitude, and phone are required';
    throw err;
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    console.warn(
      `[signup] reject duplicate email=${normalizedEmail} existingRole=${existing.role}`
    );
    const err = new Error(
      existing.role === 'business'
        ? 'Email already registered — sign in instead'
        : 'Email already registered with another account type'
    );
    err.status = 409;
    throw err;
  }

  console.log(
    `[signup] place address="${place.address}" lat=${place.latitude} lng=${place.longitude}`
  );
  const magic = createMagicToken();

  const user = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    role: 'business',
    mustSetPassword: true,
    magicLinkTokenHash: magic.hash,
    magicLinkExpiresAt: magic.expiresAt,
  });
  console.log(`[signup] user created id=${user._id} role=${user.role}`);

  const business = await Business.create({
    name: String(businessName).trim(),
    phone: String(phone).trim(),
    ...place,
    createdBy: user._id,
  });
  await addBusinessMembership(business._id, user._id, 'owner');
  console.log(`[signup] business created id=${business._id} name="${business.name}"`);

  const link = `${config.clientOrigin}/auth/magic?token=${magic.token}`;
  console.log(
    `[signup] magicLink user=${user.email} expiresAt=${magic.expiresAt.toISOString()} url=${link}`
  );
  enqueueEmail({
    to: user.email,
    subject: 'Complete your business signup',
    text: `Hi ${user.name},\n\nConfirm your email and finish signup:\n${link}\n\nThis link expires in ${config.magicLinkTtlMinutes} minutes.\nAfter confirming, you will set a password to sign in next time.`,
    html: `<p>Hi ${user.name},</p><p><a href="${link}">Confirm your email and finish signup</a></p><p>This link expires in ${config.magicLinkTtlMinutes} minutes. After confirming, you will set a password to sign in next time.</p>`,
    meta: { kind: 'business_signup_magic', userId: String(user._id) },
  });

  return { user, business };
}

export async function consumeMagicLink(rawToken) {
  const token = String(rawToken || '').trim();
  const tokenPreview = token ? `${token.slice(0, 8)}…` : '(empty)';
  console.log(`[magic] verify attempt token=${tokenPreview}`);
  if (!token) {
    const err = new Error('Token required');
    err.status = 400;
    throw err;
  }

  const hash = hashToken(token);
  const user = await User.findOne({ magicLinkTokenHash: hash });
  if (!user) {
    console.warn(`[magic] verify FAILED no matching token token=${tokenPreview}`);
    const err = new Error('Invalid or expired link');
    err.status = 400;
    throw err;
  }
  if (!user.magicLinkExpiresAt || user.magicLinkExpiresAt.getTime() < Date.now()) {
    console.warn(
      `[magic] verify FAILED expired email=${user.email} expiresAt=${user.magicLinkExpiresAt?.toISOString()}`
    );
    const err = new Error('Invalid or expired link');
    err.status = 400;
    throw err;
  }
  if (user.isDisabled) {
    console.warn(`[magic] verify FAILED disabled email=${user.email}`);
    const err = new Error('Account disabled');
    err.status = 403;
    throw err;
  }

  user.magicLinkTokenHash = undefined;
  user.magicLinkExpiresAt = undefined;
  await user.save();
  console.log(
    `[magic] verify OK userId=${user._id} email=${user.email} mustSetPassword=${user.mustSetPassword}`
  );
  return user;
}
