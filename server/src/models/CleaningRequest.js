import mongoose from 'mongoose';

/**
 * Lean job header. Offers → request_offers; history → request_events;
 * agency crew → job_assignments; staff pay → staff_job_pays.
 */
const cleaningRequestSchema = new mongoose.Schema(
  {
    // Person who posted (notifications / audit). Ownership for business jobs is businessId.
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
    serviceDetails: { type: String, required: true },
    scheduleStart: { type: Date, required: true },
    scheduleEnd: { type: Date, required: true },
    // Business job size. 1 day = 8 hours. Personal jobs leave these empty and use the schedule window.
    jobType: {
      type: String,
      enum: ['fixed', 'recurring_indefinite', 'recurring_until'],
    },
    durationDays: Number,
    durationExtraHours: Number,
    visitHours: Number,
    visitCount: Number,
    totalHours: Number,
    recurrenceUntil: Date,
    preferredTime: { type: Date, required: false },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    status: {
      type: String,
      enum: [
        'open',
        'assigned',
        'en_route',
        'on_site',
        'in_progress',
        'completed',
        'unmatched',
        'cancelled',
      ],
      default: 'open',
    },
    // Independent cleaner path
    assignedCleanerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Agency path pointers (details in related collections)
    selectedAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleaningAgency' },
    assignedAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleaningAgency' },
    assignedStaffIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    matchingExpiresAt: Date,
    notifiedCleanerCount: { type: Number, default: 0 },
    notifiedAgencyCount: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const CleaningRequest = mongoose.model('CleaningRequest', cleaningRequestSchema);
