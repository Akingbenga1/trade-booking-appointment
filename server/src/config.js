import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/trade_booking',
  jwtSecret: process.env.JWT_SECRET || 'dev-trade-booking-secret',
  matchRadiusKm: Number(process.env.MATCH_RADIUS_KM || 20),
  // Kept for env compatibility; createCleaningRequest uses matching window for offer expiry.
  offerWindowSeconds: Number(process.env.OFFER_WINDOW_SECONDS || 300),
  matchingWindowSeconds: Number(process.env.MATCHING_WINDOW_SECONDS || 300),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
};
