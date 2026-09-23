import mongoose from 'mongoose';

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
    // Person who posted (notifications / audit). Ownership for business jobs is businessId.
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
    serviceDetails: { type: String, required: true },
    // Preferred window (minute precision). preferredTime kept optional for legacy rows.
    scheduleStart: { type: Date, required: true },
    scheduleEnd: { type: Date, required: true },
    preferredTime: { type: Date, required: false },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
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
    // Soft-delete: set when poster removes a cancelled request from "My requests".
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const CleaningRequest = mongoose.model('CleaningRequest', cleaningRequestSchema);
