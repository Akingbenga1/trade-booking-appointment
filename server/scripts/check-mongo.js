import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const uri = (process.env.MONGO_URI || '').trim();

if (!uri || uri === 'memory' || process.env.MEMORY_MONGO === '1') {
  console.error(`
════════════════════════════════════════════════════════════
 DATABASE ALARM — real MongoDB required
════════════════════════════════════════════════════════════
 MONGO_URI must be a mongodb:// or mongodb+srv:// URI.
 In-memory mode is disabled permanently.

 Start MongoDB:
   docker compose up -d mongo
════════════════════════════════════════════════════════════
`);
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`MongoDB OK: ${uri}`);
  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  console.error(`
════════════════════════════════════════════════════════════
 DATABASE ALARM — cannot connect to MongoDB
════════════════════════════════════════════════════════════
 URI: ${uri}
 Error: ${err.message}

 Fix:
   1. Start Docker Desktop
   2. docker compose up -d mongo
   3. Retry
════════════════════════════════════════════════════════════
`);
  process.exit(1);
}
