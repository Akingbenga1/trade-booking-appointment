import mongoose from 'mongoose';

/**
 * Agency crew assignment for a request (one row per staff member).
 */
const jobAssignmentSchema = new mongoose.Schema(
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
    confirmStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'declined', 'reassigned', 'removed'],
      default: 'pending',
      index: true,
    },
    assignedAt: { type: Date, default: Date.now },
    respondedAt: Date,
  },
  { timestamps: true, collection: 'job_assignments' }
);

jobAssignmentSchema.index({ requestId: 1, staffUserId: 1 });
jobAssignmentSchema.index({ agencyId: 1, confirmStatus: 1 });

export const JobAssignment = mongoose.model('JobAssignment', jobAssignmentSchema);
