import mongoose from 'mongoose';

/**
 * Raw payment-provider webhook payloads for audit and replay.
 * Provider-specific; mapped into neutral events by adapters.
 */
const paymentProviderEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, default: 'stripe' },
    providerEventId: { type: String, required: true },
    providerEventType: { type: String, required: true },
    /** Neutral outcome: paid | failed | cancelled; omit when ignored */
    mappedStatus: {
      type: String,
      enum: ['paid', 'failed', 'cancelled'],
    },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleaningRequest' },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    processingStatus: {
      type: String,
      enum: ['received', 'processed', 'ignored', 'error'],
      default: 'received',
    },
    processingError: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

paymentProviderEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

export const PaymentProviderEvent = mongoose.model(
  'PaymentProviderEvent',
  paymentProviderEventSchema
);
