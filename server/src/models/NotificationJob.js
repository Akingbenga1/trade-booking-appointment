import mongoose from 'mongoose';

/**
 * Durable outbox for notification delivery (live / push / email fallback).
 * Survives process restarts unlike the in-memory email array alone.
 */
const notificationJobSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['deliver', 'email_fallback'],
      required: true,
    },
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleaningRequest' },
    status: {
      type: String,
      enum: ['pending', 'done', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    result: {
      live: { type: Boolean, default: false },
      push: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
    },
    lastError: { type: String },
  },
  { timestamps: true }
);

notificationJobSchema.index({ status: 1, nextAttemptAt: 1 });

export const NotificationJob = mongoose.model('NotificationJob', notificationJobSchema);
