import { Business } from '../models/Business.js';
import { CleaningAgency } from '../models/CleaningAgency.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { AgencyMembership } from '../models/AgencyMembership.js';
import { AgencyJobInterest } from '../models/AgencyJobInterest.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { isBusinessMember } from './businessService.js';
import { findNearbyAgencies } from './requestService.js';

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function agencyCard(agency) {
  return {
    id: agency._id,
    name: agency.name,
    phone: agency.phone,
    address: agency.address,
  };
}

async function availableStaffCounts() {
  const memberships = await AgencyMembership.find({ memberRole: 'staff' }).select('agencyId userId');
  const staffIds = [...new Set(memberships.map((row) => String(row.userId)))];
  const staff = staffIds.length
    ? await User.find({
        _id: { $in: staffIds },
        role: 'agency_staff',
        isAvailable: true,
        isDisabled: { $ne: true },
      }).select('_id')
    : [];
  const onDuty = new Set(staff.map((row) => String(row._id)));
  const counts = new Map();
  for (const row of memberships) {
    if (!onDuty.has(String(row.userId))) continue;
    const key = String(row.agencyId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Three agency lists for one business the caller belongs to.
 * Available: the agency has staff who are on duty.
 * Nearby: the same distance rule used when a job is posted, measured from this business address.
 * Interested: an agency asked to take one of this business's jobs.
 */
export async function listAgenciesForBusiness(user, businessId) {
  if (user.role !== 'business') throw httpError('Forbidden', 403);
  const bid = String(businessId || '').trim();
  if (!bid) throw httpError('businessId is required', 400);
  if (!(await isBusinessMember(user.id, bid))) throw httpError('Forbidden', 403);

  const business = await Business.findById(bid).select('name address latitude longitude');
  if (!business) throw httpError('Business not found', 404);

  const [counts, nearby, jobs] = await Promise.all([
    availableStaffCounts(),
    findNearbyAgencies(business.latitude, business.longitude, config.matchRadiusKm),
    CleaningRequest.find({ businessId: business._id, deletedAt: null }).select(
      'serviceDetails status archivedAt'
    ),
  ]);

  const agencies = await CleaningAgency.find({}).select('name phone address');
  const byId = new Map(agencies.map((row) => [String(row._id), row]));

  const available = agencies
    .filter((row) => counts.get(String(row._id)) > 0)
    .map((row) => ({
      ...agencyCard(row),
      availableStaff: counts.get(String(row._id)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const nearbyCards = nearby
    .map(({ agency, distanceKm }) => {
      const row = byId.get(String(agency._id)) || agency;
      return {
        ...agencyCard(row),
        distanceKm,
        availableStaff: counts.get(String(agency._id)) || 0,
      };
    });

  const jobById = new Map(jobs.map((row) => [String(row._id), row]));
  const interests = jobs.length
    ? await AgencyJobInterest.find({ requestId: { $in: jobs.map((row) => row._id) } })
        .sort({ expressedAt: -1 })
        .lean()
    : [];

  const interested = interests.map((row) => {
    const agency = byId.get(String(row.agencyId));
    const job = jobById.get(String(row.requestId));
    return {
      id: row._id,
      agencyId: row.agencyId,
      name: agency?.name || 'Agency',
      phone: agency?.phone || '',
      address: agency?.address || '',
      status: row.status,
      expressedAt: row.expressedAt,
      requestId: row.requestId,
      jobLabel: job?.serviceDetails || 'Job',
      jobStatus: job?.status || '',
      jobArchived: Boolean(job?.archivedAt),
    };
  });

  return {
    radiusKm: config.matchRadiusKm,
    business: {
      id: business._id,
      name: business.name,
      address: business.address,
    },
    available,
    nearby: nearbyCards,
    interested,
  };
}
