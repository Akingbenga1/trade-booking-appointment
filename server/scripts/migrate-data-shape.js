/**
 * One-time migration: embedded offers/statusHistory → collections;
 * Business.memberIds → business_memberships.
 *
 * Usage (from server/): node scripts/migrate-data-shape.js
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { Business } from '../src/models/Business.js';
import { RequestOffer } from '../src/models/RequestOffer.js';
import { RequestEvent } from '../src/models/RequestEvent.js';
import { BusinessMembership } from '../src/models/BusinessMembership.js';

async function migrateOffersAndEvents() {
  const cursor = CleaningRequest.find({}).cursor();
  let offers = 0;
  let events = 0;
  for await (const doc of cursor) {
    const raw = doc.toObject();
    if (Array.isArray(raw.offers) && raw.offers.length) {
      for (const o of raw.offers) {
        const existing = await RequestOffer.findOne({
          requestId: doc._id,
          kind: 'cleaner',
          cleanerId: o.cleanerId,
        });
        if (!existing) {
          await RequestOffer.create({
            requestId: doc._id,
            kind: 'cleaner',
            cleanerId: o.cleanerId,
            distanceKm: o.distanceKm ?? 0,
            status: o.status || 'pending',
            notifiedAt: o.notifiedAt || doc.createdAt,
            expiresAt: o.expiresAt || doc.matchingExpiresAt || new Date(),
            respondedAt: o.respondedAt,
          });
          offers += 1;
        }
      }
    }
    if (Array.isArray(raw.statusHistory) && raw.statusHistory.length) {
      const count = await RequestEvent.countDocuments({ requestId: doc._id });
      if (count === 0) {
        await RequestEvent.insertMany(
          raw.statusHistory.map((h) => ({
            requestId: doc._id,
            status: h.status,
            at: h.at || doc.createdAt,
            by: h.by || 'system',
            note: h.note,
          }))
        );
        events += raw.statusHistory.length;
      }
    }
    if (raw.offers != null || raw.statusHistory != null) {
      await CleaningRequest.updateOne(
        { _id: doc._id },
        { $unset: { offers: '', statusHistory: '' } }
      );
    }
  }
  return { offers, events };
}

async function migrateBusinessMemberships() {
  const businesses = await Business.find({ memberIds: { $exists: true, $ne: [] } });
  let created = 0;
  for (const biz of businesses) {
    const ids = biz.memberIds || [];
    for (let i = 0; i < ids.length; i += 1) {
      const userId = ids[i];
      const memberRole =
        String(userId) === String(biz.createdBy) || i === 0 ? 'owner' : 'admin';
      const res = await BusinessMembership.findOneAndUpdate(
        { businessId: biz._id, userId },
        { businessId: biz._id, userId, memberRole },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (res) created += 1;
    }
    await Business.updateOne({ _id: biz._id }, { $unset: { memberIds: '' } });
  }
  return { businesses: businesses.length, memberships: created };
}

async function main() {
  await connectDb();
  const a = await migrateOffersAndEvents();
  const b = await migrateBusinessMemberships();
  console.log('Migrated offers/events:', a);
  console.log('Migrated business memberships:', b);
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
