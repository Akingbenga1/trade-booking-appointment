import bcrypt from 'bcryptjs';
import { CleaningAgency } from '../models/CleaningAgency.js';
import { AgencyMembership } from '../models/AgencyMembership.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { JobAssignment } from '../models/JobAssignment.js';
import { StaffJobPay } from '../models/StaffJobPay.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { parsePlaceFields } from './place.js';
import { enqueueEmail, htmlFromPlainText } from './emailQueue.js';
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
  }).populate(
    'userId',
    'name email role isAvailable currentLocation isDisabled mustSetPassword createdAt'
  );
  const userIds = memberships.map((row) => row.userId?._id).filter(Boolean);
  const assignments = userIds.length
    ? await JobAssignment.find({
        agencyId,
        staffUserId: { $in: userIds },
        confirmStatus: { $in: ['pending', 'confirmed'] },
      }).lean()
    : [];
  const requestIds = [...new Set(assignments.map((row) => String(row.requestId)))];
  const [requests, pays] = await Promise.all([
    requestIds.length
      ? CleaningRequest.find({ _id: { $in: requestIds } })
          .select('serviceDetails address status scheduleStart scheduleEnd')
          .lean()
      : [],
    assignments.length
      ? StaffJobPay.find({ assignmentId: { $in: assignments.map((row) => row._id) } })
          .select('assignmentId payRatePerHour durationHours totalAmount currency')
          .lean()
      : [],
  ]);
  const requestById = new Map(requests.map((row) => [String(row._id), row]));
  const payByAssignment = new Map(pays.map((row) => [String(row.assignmentId), row]));
  const jobsByUser = new Map();
  for (const row of assignments) {
    const key = String(row.staffUserId);
    const request = requestById.get(String(row.requestId));
    const pay = payByAssignment.get(String(row._id));
    const job = {
      requestId: row.requestId,
      serviceDetails: request?.serviceDetails || 'Cleaning job',
      address: request?.address || '',
      status: request?.status || null,
      scheduleStart: request?.scheduleStart || null,
      scheduleEnd: request?.scheduleEnd || null,
      confirmStatus: row.confirmStatus,
      workStart: row.workStart || null,
      workEnd: row.workEnd || null,
      assignedAt: row.assignedAt || null,
      pay: pay
        ? {
            payRatePerHour: pay.payRatePerHour,
            durationHours: pay.durationHours,
            totalAmount: pay.totalAmount,
            currency: pay.currency || 'GBP',
          }
        : null,
    };
    const list = jobsByUser.get(key) || [];
    list.push(job);
    jobsByUser.set(key, list);
  }

  return memberships
    .filter((row) => row.userId)
    .map((row) => ({
      membershipId: row._id,
      memberRole: row.memberRole,
      joinedAt: row.createdAt,
      user: row.userId,
      jobs: (jobsByUser.get(String(row.userId._id)) || []).sort((a, b) => {
        const left = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
        const right = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
        return right - left;
      }),
    }))
    .sort((a, b) => String(a.user.name || '').localeCompare(String(b.user.name || '')));
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
  await queueStaffWelcome(user, agencyId);
  return { user: publicUser(user), linkedExisting: false };
}

async function queueStaffWelcome(user, agencyId) {
  try {
    const agency = await CleaningAgency.findById(agencyId).select('name');
    const agencyName = agency?.name || 'Your agency';
    const text = [
      `Hi ${user.name},`,
      '',
      `${agencyName} created your staff profile.`,
      '',
      `Name: ${user.name}`,
      `Sign-in email: ${user.email}`,
      `Agency: ${agencyName}`,
      '',
      'Ask your agency for your sign-in password. It is not included in this email.',
      '',
      `Sign in: ${config.clientOrigin}`,
    ].join('\n');
    enqueueEmail({
      to: user.email,
      subject: `${agencyName} created your staff profile`,
      text,
      html: htmlFromPlainText(text),
      meta: { kind: 'staff_welcome', userId: String(user._id), agencyId: String(agencyId) },
    });
  } catch (err) {
    console.error('[email] staff welcome failed', err.message);
  }
}

const MAX_BULK_STAFF = 100;

/**
 * Create or link many staff accounts. One bad row does not stop the rest.
 */
export async function createAgencyStaffMany(actorUserId, agencyId, rows) {
  if (!(await isAgencyOwnerOrAdmin(actorUserId, agencyId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('Add at least one staff member');
    err.status = 400;
    throw err;
  }
  if (rows.length > MAX_BULK_STAFF) {
    const err = new Error(`You can add at most ${MAX_BULK_STAFF} staff at a time`);
    err.status = 400;
    throw err;
  }

  const results = [];
  for (const row of rows) {
    const name = row?.name;
    const email = row?.email;
    const password = row?.password;
    try {
      const created = await createAgencyStaff(actorUserId, agencyId, { name, email, password });
      results.push({
        name: created.user.name,
        email: created.user.email,
        status: created.linkedExisting ? 'linked' : 'created',
      });
    } catch (err) {
      results.push({
        name: String(name || '').trim(),
        email: String(email || '').trim().toLowerCase(),
        status: 'failed',
        error: err.message,
      });
    }
  }

  return {
    results,
    created: results.filter((row) => row.status === 'created').length,
    linked: results.filter((row) => row.status === 'linked').length,
    failed: results.filter((row) => row.status === 'failed').length,
  };
}

export async function getAgencyMemberUserIds(agencyId, roles = ['owner', 'admin']) {
  const rows = await AgencyMembership.find({
    agencyId,
    memberRole: { $in: roles },
  }).select('userId');
  return rows.map((r) => r.userId);
}
