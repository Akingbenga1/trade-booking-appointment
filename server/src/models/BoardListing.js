import mongoose from 'mongoose';

// A job written on the public board. It is not a booked cleaning request.
const boardListingSchema = new mongoose.Schema(
  {
    serviceDetails: { type: String, required: true, maxlength: 200 },
    address: { type: String, required: true, maxlength: 300 },
    scheduleStart: { type: Date, required: true },
    scheduleEnd: { type: Date, required: true },
    jobType: {
      type: String,
      enum: ['fixed', 'recurring_indefinite', 'recurring_until'],
    },
    recurrenceUntil: Date,
    visitHours: Number,
    postedBy: { type: String, enum: ['business', 'personal'], required: true },
    businessName: { type: String, default: '', maxlength: 120 },
    payRatePerHour: Number,
    durationHours: Number,
    totalAmount: Number,
  },
  { timestamps: true }
);

export const BoardListing = mongoose.model('BoardListing', boardListingSchema);
