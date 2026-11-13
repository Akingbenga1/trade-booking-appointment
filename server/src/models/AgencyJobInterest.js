import mongoose from 'mongoose';

/**
 * Agency interest in a job; company picks among interested agencies.
 */
const agencyJobInterestSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ['interested', 'selected', 'rejected', 'withdrawn'],
      default: 'interested',
      index: true,
    },
    expressedAt: { type: Date, default: Date.now },
    decidedAt: Date,
  },
  { timestamps: true, collection: 'agency_job_interests' }
);

agencyJobInterestSchema.index({ requestId: 1, agencyId: 1 }, { unique: true });

export const AgencyJobInterest = mongoose.model(
  'AgencyJobInterest',
  agencyJobInterestSchema
);
