/**
 * One-shot migration: nested location { address, lat, lng }
 * → flat address / latitude / longitude on CleaningRequest and Business.
 *
 * Usage: node scripts/migrate-place-fields.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const uri = (process.env.MONGO_URI || '').trim();
if (!uri || uri === 'memory') {
  console.error('MONGO_URI required');
  process.exit(1);
}

function flatten(doc) {
  const loc = doc.location;
  if (!loc || typeof loc !== 'object') return null;
  const address = loc.address;
  const latitude = loc.lat ?? loc.latitude;
  const longitude = loc.lng ?? loc.longitude;
  if (address == null || latitude == null || longitude == null) return null;
  return { address, latitude: Number(latitude), longitude: Number(longitude) };
}

async function migrateCollection(db, name) {
  const col = db.collection(name);
  const cursor = col.find({ location: { $exists: true } });
  let updated = 0;
  let skipped = 0;
  for await (const doc of cursor) {
    const place = flatten(doc);
    if (!place) {
      skipped += 1;
      continue;
    }
    await col.updateOne(
      { _id: doc._id },
      {
        $set: place,
        $unset: { location: '' },
      }
    );
    updated += 1;
  }
  return { updated, skipped };
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const requests = await migrateCollection(db, 'cleaningrequests');
const businesses = await migrateCollection(db, 'businesses');

console.log('CleaningRequest:', requests);
console.log('Business:', businesses);

await mongoose.disconnect();
