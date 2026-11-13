import bcrypt from 'bcryptjs';
import { CleaningAgency } from '../models/CleaningAgency.js';
import { AgencyMembership } from '../models/AgencyMembership.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { parsePlaceFields } from './place.js';
import { enqueueEmail } from './emailQueue.js';
import { createMagicToken, publicUser } from './businessService.js';

export async function isAgencyMember(userId, agencyId, roles = null) {
  if (!agencyId) return false;
  const filter = { agencyId, userId };
  if (roles?.length) filter.memberRole = { $in: roles };
  const row = await AgencyMembership.findOne(filter).select('_id');
  return Boolean(row);
}

export async function isAgencyOwnerOrAdmin(userId, agencyId) {
  return isAgencyMember(userId, agencyId, ['owner', 'admin']);
}

export async function listAgenciesForUser(userId) {
  const memberships = await AgencyMembership.find({ userId });
  const ids = memberships.map((m) => m.agencyId);
  if (!ids.length) return [];
  const agencies = await CleaningAgency.find({ _id: { $in: ids } }).sort({ createdAt: 1 });
  const roleByAgency = new Map(
    memberships.map((m) => [String(m.agencyId), m.memberRole])
  );
  return agencies.map((a) => ({
    ...a.toObject(),
    memberRole: roleByAgency.get(String(a._id)),
  }));
}

export async function listAgencyStaff(agencyId) {
  const memberships = await AgencyMembership.find({
    agencyId,
    memberRole: 'staff',
  }).populate('userId', 'name email role isAvailable currentLocation isDisabled');
  return memberships.map((m) => ({
    membershipId: m._id,
    memberRole: m.memberRole,
    user: m.userId,
  }));
}

async function addAgencyMembership(agencyId, userId, memberRole) {
  await AgencyMembership.findOneAndUpdate(
    { agencyId, userId },
    { agencyId, userId, memberRole },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function registerCleaningAgency({
  name,
  email,
  agencyName,
  address,
  latitude,
  longitude,
  phone,
}) {
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!name?.trim() || !normalizedEmail || !agencyName?.trim() || !phone?.trim()) {
    const err = new Error('name, email, agencyName, address, and phone are required');
    err.status = 400;
    throw err;
  }

  let place;
  try {
    place = parsePlaceFields({ address, latitude, longitude });
  } catch (err) {
    err.message =
      'name, email, agencyName, address, latitude, longitude, and phone are required';
    throw err;
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    const err = new Error(
      existing.role === 'cleaning_agency'
        ? 'Email already registered — sign in instead'
        : 'Email already registered with another account type'
    );
    err.status = 409;
    throw err;
  }

  const magic = createMagicToken();
  const user = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    role: 'cleaning_agency',
    mustSetPassword: true,
    magicLinkTokenHash: magic.hash,
    magicLinkExpiresAt: magic.expiresAt,
  });

  const agency = await CleaningAgency.create({
    name: String(agencyName).trim(),
    phone: String(phone).trim(),
    ...place,
    createdBy: user._id,
  });
  await addAgencyMembership(agency._id, user._id, 'owner');

  const link = `${config.clientOrigin}/auth/magic?token=${magic.token}`;
  console.log(
    `[signup] agency magicLink user=${user.email} expiresAt=${magic.expiresAt.toISOString()} url=${link}`
  );
  enqueueEmail({
    to: user.email,
    subject: 'Complete your cleaning agency signup',
    text: `Hi ${user.name},\n\nConfirm your email and finish signup:\n${link}\n\nThis link expires in ${config.magicLinkTtlMinutes} minutes.\nAfter confirming, you will set a password to sign in next time.`,
    html: `<p>Hi ${user.name},</p><p><a href="${link}">Confirm your email and finish signup</a></p><p>This link expires in ${config.magicLinkTtlMinutes} minutes. After confirming, you will set a password to sign in next time.</p>`,
    meta: { kind: 'agency_signup_magic', userId: String(user._id) },
  });

  return { user, agency };
}

/**
 * Agency owner/admin creates a staff account and links them to the agency.
 */
export async function createAgencyStaff(actorUserId, agencyId, { name, email, password }) {
  if (!(await isAgencyOwnerOrAdmin(actorUserId, agencyId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const normalizedEmail = String(email || '')
    .trim()
    .toLowerCase();
  if (!name?.trim() || !normalizedEmail || !password || String(password).length < 8) {
    const err = new Error('name, email, and password (min 8 chars) are required');
    err.status = 400;
    throw err;
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    if (existing.role !== 'agency_staff') {
      const err = new Error('Email already registered with another account type');
      err.status = 409;
      throw err;
    }
    const already = await AgencyMembership.findOne({
      agencyId,
      userId: existing._id,
    });
    if (already) {
      const err = new Error('Staff already belongs to this agency');
      err.status = 409;
      throw err;
    }
    await addAgencyMembership(agencyId, existing._id, 'staff');
    return { user: publicUser(existing), linkedExisting: true };
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash,
    role: 'agency_staff',
    mustSetPassword: false,
  });
  await addAgencyMembership(agencyId, user._id, 'staff');
  return { user: publicUser(user), linkedExisting: false };
}

export async function getAgencyMemberUserIds(agencyId, roles = ['owner', 'admin']) {
  const rows = await AgencyMembership.find({
    agencyId,
    memberRole: { $in: roles },
  }).select('userId');
  return rows.map((r) => r.userId);
}
