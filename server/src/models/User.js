import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['client', 'business', 'cleaner', 'admin'],
      required: true,
    },
    // Soft-disable for admin oversight (login blocked when true)
    isDisabled: { type: Boolean, default: false },
    // Cleaner-only fields
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
export { locationSchema };
