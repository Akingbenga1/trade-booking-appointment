import mongoose from 'mongoose';

/**
 * Join: user ↔ cleaning agency (owner / admin / staff). Multi-agency staff allowed.
 */
const agencyMembershipSchema = new mongoose.Schema(
  {
    agencyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningAgency',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    memberRole: {
      type: String,
      enum: ['owner', 'admin', 'staff'],
      required: true,
    },
  },
  { timestamps: true, collection: 'agency_memberships' }
);

agencyMembershipSchema.index({ agencyId: 1, userId: 1 }, { unique: true });
agencyMembershipSchema.index({ userId: 1, memberRole: 1 });

export const AgencyMembership = mongoose.model('AgencyMembership', agencyMembershipSchema);
