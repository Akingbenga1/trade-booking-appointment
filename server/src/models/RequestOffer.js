import mongoose from 'mongoose';

/**
 * One notified party for a cleaning request (cleaner or agency).
 * Replaces embedded CleaningRequest.offers[].
 */
const requestOfferSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['cleaner', 'agency'],
      required: true,
    },
    cleanerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleaningAgency' },
    distanceKm: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'ignored', 'closed'],
      default: 'pending',
      index: true,
    },
    notifiedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
  },
  { timestamps: true, collection: 'request_offers' }
);

requestOfferSchema.index({ requestId: 1, cleanerId: 1 });
requestOfferSchema.index({ requestId: 1, agencyId: 1 });
requestOfferSchema.index({ cleanerId: 1, status: 1 });
requestOfferSchema.index({ agencyId: 1, status: 1 });
requestOfferSchema.index({ status: 1, expiresAt: 1 });

export const RequestOffer = mongoose.model('RequestOffer', requestOfferSchema);
