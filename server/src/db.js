import mongoose from 'mongoose';
import { config } from './config.js';

function assertRealMongoUri(uri) {
  const value = (uri || '').trim();
  const blocked = !value || value === 'memory' || value.startsWith('memory:') || process.env.MEMORY_MONGO === '1';

  if (blocked) {
    console.error(`
════════════════════════════════════════════════════════════
 DATABASE REQUIRED — in-memory MongoDB is not allowed
════════════════════════════════════════════════════════════
 Set MONGO_URI to a real MongoDB connection string, e.g.:
   mongodb://127.0.0.1:27017/trade_booking

 Start local Mongo with:
   docker compose up -d mongo

 Then re-run the server / tests.
════════════════════════════════════════════════════════════
`);
    process.exit(1);
  }

  if (!/^mongodb(\+srv)?:\/\//i.test(value)) {
    console.error(`
════════════════════════════════════════════════════════════
 INVALID MONGO_URI
════════════════════════════════════════════════════════════
 Expected a mongodb:// or mongodb+srv:// URI.
 Got: ${value}
════════════════════════════════════════════════════════════
`);
    process.exit(1);
  }

  return value;
}

export async function connectDb() {
  const uri = assertRealMongoUri(config.mongoUri);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
    });
  } catch (err) {
    console.error(`
════════════════════════════════════════════════════════════
 CANNOT REACH MONGODB
════════════════════════════════════════════════════════════
 URI: ${uri}
 Error: ${err.message}

 Start MongoDB (Docker Desktop must be running):
   docker compose up -d mongo

 Or point MONGO_URI at your Atlas / hosted cluster.
════════════════════════════════════════════════════════════
`);
    process.exit(1);
  }

  console.log(`Connected to MongoDB: ${uri}`);
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
