import mongoose from 'mongoose';

const cleaningAgencySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'cleaning_agencies' }
);

export const CleaningAgency = mongoose.model('CleaningAgency', cleaningAgencySchema);
