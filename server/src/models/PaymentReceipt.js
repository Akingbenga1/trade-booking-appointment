import mongoose from 'mongoose';

/**
 * Proof a business uploaded for a job the app did not see paid online.
 * The file itself is stored on disk. This row is the record.
 */
const paymentReceiptSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningRequest',
      required: true,
      unique: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    agencyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningAgency',
      index: true,
    },
    cleanerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    statedAmount: { type: Number },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    markedPaidAt: Date,
    markedPaidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'payment_receipts' }
);

paymentReceiptSchema.pre('validate', function rejectEmptyPayee(next) {
  if (!this.agencyId && !this.cleanerUserId) {
    next(new Error('A receipt needs an agency or a cleaner'));
    return;
  }
  next();
});

export const PaymentReceipt = mongoose.model('PaymentReceipt', paymentReceiptSchema);
