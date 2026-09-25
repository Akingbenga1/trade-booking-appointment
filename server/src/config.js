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
  magicLinkTtlMinutes: Number(process.env.MAGIC_LINK_TTL_MINUTES || 60),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  // FCM (web + Android). Private key may contain escaped newlines in .env.
  fcm: {
    projectId: process.env.FCM_PROJECT_ID || '',
    clientEmail: process.env.FCM_CLIENT_EMAIL || '',
    privateKey: (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  notify: {
    // Booking email only if live+push missed after this window (seconds).
    emailFallbackSeconds: Number(process.env.NOTIFY_EMAIL_FALLBACK_SECONDS || 120),
    maxAttempts: Number(process.env.NOTIFY_MAX_ATTEMPTS || 5),
  },
};
