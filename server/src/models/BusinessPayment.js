import mongoose from 'mongoose';

/**
 * Which business owns which payment transaction (and the related job/request).
 * Also holds the job billing quote (rate × hours) used when posting.
 * Replaces the old cleaningjobpays / CleaningJobPay collection.
 */
const businessPaymentSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      unique: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      index: true,
    },
    payRatePerHour: { type: Number, required: true },
    minimumWagePerHour: { type: Number, required: true },
    durationHours: { type: Number, required: true },
  },
  { timestamps: true, collection: 'business_payments' }
);

export const BusinessPayment = mongoose.model('BusinessPayment', businessPaymentSchema);
