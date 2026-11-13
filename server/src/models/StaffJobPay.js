import mongoose from 'mongoose';

/**
 * Record-only staff wage for an agency assignment (no Stripe payout in v1).
 */
const staffJobPaySchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      index: true,
    },
    agencyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningAgency',
      required: true,
      index: true,
    },
    staffUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobAssignment',
      required: true,
      unique: true,
    },
    payRatePerHour: { type: Number, required: true },
    minimumWagePerHour: { type: Number, required: true },
    durationHours: { type: Number, required: true },
    currency: { type: String, default: 'GBP' },
  },
  { timestamps: true, collection: 'staff_job_pays' }
);

staffJobPaySchema.index({ requestId: 1, staffUserId: 1 });

export const StaffJobPay = mongoose.model('StaffJobPay', staffJobPaySchema);
