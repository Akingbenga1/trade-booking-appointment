import mongoose from 'mongoose';

/**
 * Join: user ↔ business. Replaces embedded Business.memberIds[].
 */
const businessMembershipSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
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
      enum: ['owner', 'admin'],
      required: true,
      default: 'owner',
    },
  },
  { timestamps: true, collection: 'business_memberships' }
);

businessMembershipSchema.index({ businessId: 1, userId: 1 }, { unique: true });
businessMembershipSchema.index({ userId: 1 });

export const BusinessMembership = mongoose.model(
  'BusinessMembership',
  businessMembershipSchema
);
