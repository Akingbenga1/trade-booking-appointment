import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    // Optional until business/agency signup completes set-password after magic link
    passwordHash: { type: String, required: false },
    role: {
      type: String,
      enum: ['client', 'business', 'cleaner', 'admin', 'cleaning_agency', 'agency_staff'],
      required: true,
    },
    // Soft-disable for admin oversight (login blocked when true)
    isDisabled: { type: Boolean, default: false },
    mustSetPassword: { type: Boolean, default: false },
    magicLinkTokenHash: { type: String },
    magicLinkExpiresAt: { type: Date },
    // Cleaner / agency_staff live location (separate from job address)
    isAvailable: { type: Boolean, default: false },
    currentLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
