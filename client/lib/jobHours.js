import { MINIMUM_WAGE_PER_HOUR } from './jobPay';

/** One working day. Matches the server. */
export const HOURS_PER_DAY = 8;

function roundHours(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/**
 * Live preview for the business post form.
 * Returns an error string, or the visit size, total hours, and pay.
 */
export function previewBusinessJob({
  jobType,
  durationDays,
  durationExtraHours,
  startsAt,
  untilDate,
  payRatePerHour,
}) {
  const days = Number(durationDays);
  const extra = durationExtraHours === '' || durationExtraHours == null ? 0 : Number(durationExtraHours);
  if (!Number.isInteger(days) || days < 0) {
    return { error: 'Days must be a whole number, 0 or more.' };
  }
  if (!Number.isFinite(extra) || extra < 0 || extra >= HOURS_PER_DAY) {
    return { error: 'Hours must be from 0 up to 8. 8 hours counts as another day.' };
  }
  const visitHours = roundHours(days * HOURS_PER_DAY + extra);
  if (!(visitHours > 0)) return { error: 'Enter at least 1 hour or 1 day.' };

  const start = new Date(startsAt);
  if (!startsAt || Number.isNaN(start.getTime())) return { error: 'Choose when the job starts.' };

  let visitCount = 1;
  let totalHours = visitHours;
  if (jobType === 'recurring_until') {
    if (!untilDate) return { error: 'Choose the date this job repeats until.' };
    const until = new Date(`${untilDate}T00:00:00`);
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    if (Number.isNaN(until.getTime()) || until.getTime() < startDay.getTime()) {
      return { error: 'The repeat-until date must be on or after the start date.' };
    }
    const diffDays = Math.round((until.getTime() - startDay.getTime()) / 86400000);
    visitCount = Math.floor(diffDays / 7) + 1;
    totalHours = roundHours(visitHours * visitCount);
  }

  const rate = Number(payRatePerHour);
  const billHours = totalHours;
  const total = Number.isFinite(rate) ? Math.round(rate * billHours * 100) / 100 : null;
  return {
    visitHours,
    totalHours,
    visitCount,
    total,
    belowMinimum: Number.isFinite(rate) && rate < MINIMUM_WAGE_PER_HOUR,
  };
}

export function allocatedHours(unit, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundHours(unit === 'days' ? n * HOURS_PER_DAY : n);
}

function countLabel(n, one, many) {
  const value = Number(n);
  return `${value} ${value === 1 ? one : many}`;
}

export function describeJob(request) {
  if (!request?.jobType) return null;
  const days = Number(request.durationDays || 0);
  const extra = Number(request.durationExtraHours || 0);
  const visit = countLabel(request.visitHours, 'hour', 'hours');
  const size =
    days && extra
      ? `${countLabel(days, 'day', 'days')} and ${countLabel(extra, 'hour', 'hours')} (${visit})`
      : days
        ? `${countLabel(days, 'day', 'days')} (${visit})`
        : visit;
  if (request.jobType === 'fixed') return `One job: ${size}.`;
  if (request.jobType === 'recurring_indefinite') {
    return `Each visit: ${size}. Repeats every week with no end date.`;
  }
  const until = request.recurrenceUntil
    ? new Date(request.recurrenceUntil).toLocaleDateString()
    : '';
  return `Each visit: ${size}. ${request.visitCount} weekly visits until ${until}. ${request.totalHours} hours in total.`;
}
