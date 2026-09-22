import mongoose from 'mongoose';
import { locationSchema } from './User.js';

const offerSchema = new mongoose.Schema(
  {
    cleanerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    distanceKm: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'ignored', 'closed'],
      default: 'pending',
    },
    notifiedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
  },
  { _id: true }
);

const cleaningRequestSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    serviceDetails: { type: String, required: true },
    preferredTime: { type: Date, required: true },
    location: { type: locationSchema, required: true },
    status: {
      type: String,
      enum: [
        'open',
        'assigned',
        'en_route',
        'on_site',
        'in_progress',
        'completed',
        'unmatched',
        'cancelled',
      ],
      default: 'open',
    },
    assignedCleanerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    offers: [offerSchema],
    matchingExpiresAt: Date,
    notifiedCleanerCount: { type: Number, default: 0 },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: String,
        note: String,
      },
    ],
  },
  { timestamps: true }
);

export const CleaningRequest = mongoose.model('CleaningRequest', cleaningRequestSchema);
