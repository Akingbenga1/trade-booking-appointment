import mongoose from 'mongoose';

const cleaningJobPaySchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      unique: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    payRatePerHour: { type: Number, required: true },
    currency: { type: String, required: true, default: 'GBP' },
    minimumWagePerHour: { type: Number, required: true },
    durationHours: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'pending', 'paid', 'failed'],
      default: 'unpaid',
    },
    stripeCheckoutSessionId: { type: String },
    stripePaymentIntentId: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

cleaningJobPaySchema.index({ businessId: 1 });

export const CleaningJobPay = mongoose.model('CleaningJobPay', cleaningJobPaySchema);
