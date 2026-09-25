import mongoose from 'mongoose';

/**
 * Payment transaction ledger row (amount, status, provider ids, receipt).
 * Not business ownership — that lives on business_payments.
 */
const transactionSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'GBP' },
    status: {
      type: String,
      enum: ['unpaid', 'pending', 'paid', 'failed', 'cancelled'],
      default: 'unpaid',
    },
    /** Payment provider name; stripe first, others later */
    provider: { type: String, default: 'stripe' },
    providerCheckoutSessionId: { type: String },
    providerPaymentId: { type: String },
    /** Hosted receipt URL from the payment provider (when available) */
    receiptUrl: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true, collection: 'transactions' }
);

transactionSchema.index({ providerCheckoutSessionId: 1 });

export const Transaction = mongoose.model('Transaction', transactionSchema);
