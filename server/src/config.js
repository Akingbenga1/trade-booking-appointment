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
  mailtrap: {
    host: process.env.MAILTRAP_HOST || 'sandbox.smtp.mailtrap.io',
    port: Number(process.env.MAILTRAP_PORT || 2525),
    user: process.env.MAILTRAP_USER || '',
    pass: process.env.MAILTRAP_PASS || '',
    from: process.env.MAIL_FROM || 'noreply@trade-booking.local',
  },
  opencageApiKey: process.env.OPENCAGE_API_KEY || '',
  // When set, geocode returns fixed coords (local/tests without OpenCage).
  opencageStub: process.env.OPENCAGE_STUB === '1',
  // Nominatim places proxy stub (local/tests). Also on when OPENCAGE_STUB=1.
  placesStub: process.env.PLACES_STUB === '1' || process.env.OPENCAGE_STUB === '1',
  magicLinkTtlMinutes: Number(process.env.MAGIC_LINK_TTL_MINUTES || 60),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  // Local/demo checkout UI when no Stripe key (or STRIPE_STUB=1).
  stripeStub:
    process.env.STRIPE_STUB === '1' ||
    (!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_STUB !== '0'),
};
