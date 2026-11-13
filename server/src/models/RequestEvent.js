import mongoose from 'mongoose';

/**
 * Append-only status / audit events for a cleaning request.
 * Replaces embedded CleaningRequest.statusHistory[].
 */
const requestEventSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      index: true,
    },
    status: { type: String, required: true },
    at: { type: Date, default: Date.now, index: true },
    by: { type: String, required: true },
    note: { type: String },
  },
  { timestamps: false, collection: 'request_events' }
);

requestEventSchema.index({ requestId: 1, at: 1 });

export const RequestEvent = mongoose.model('RequestEvent', requestEventSchema);
