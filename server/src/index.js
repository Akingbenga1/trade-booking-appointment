import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDb } from './db.js';
import { processExpiries } from './services/requestService.js';
import { seedDemo } from './seed.js';
import { User } from './models/User.js';
import authRoutes from './routes/auth.js';
import cleanerRoutes from './routes/cleaners.js';
import requestRoutes from './routes/requests.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import businessRoutes from './routes/businesses.js';
import placesRoutes from './routes/places.js';
import paymentRoutes from './routes/payments.js';
import { handleStripeWebhook } from './services/paymentService.js';
import { startEmailQueueWorker } from './services/emailQueue.js';
import { startDeliveryQueueWorker } from './services/deliveryQueue.js';
import { attachRealtime } from './services/realtime.js';

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));

// Stripe needs the raw body for signature verification — mount before json parser.
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const result = await handleStripeWebhook(
        req.body,
        req.headers['stripe-signature']
      );
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  if (!dbReady) {
    return res.status(503).json({
      ok: false,
      database: 'disconnected',
      error: 'MongoDB is required and is not connected',
    });
  }
  res.json({ ok: true, database: 'connected' });
});

app.use('/api/auth', authRoutes);
app.use('/api/cleaners', cleanerRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/payments', paymentRoutes);

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

export async function startServer() {
  await connectDb();

  if (process.env.SEED_ON_START === '1') {
    const count = await User.countDocuments();
    if (count === 0) {
      await seedDemo({ reset: false });
      console.log('Seeded demo users (password123)');
    }
  }

  startEmailQueueWorker();
  startDeliveryQueueWorker();

  setInterval(() => {
    processExpiries().catch((e) => console.error('expiry job', e.message));
  }, 10_000);

  return new Promise((resolve) => {
    const server = app.listen(config.port, () => {
      attachRealtime(server);
      console.log(`API listening on http://localhost:${config.port}`);
      resolve(server);
    });
  });
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (entry.endsWith('/index.js')) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { app };
