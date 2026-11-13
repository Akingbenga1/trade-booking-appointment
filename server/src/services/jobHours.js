import { durationHoursFromSchedule } from './jobPay.js';

/** One working day in this product. */
export const HOURS_PER_DAY = 8;

function roundHours(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Whole days plus extra hours. 8 extra hours must be entered as another day. */
export function hoursFromDaysAndExtra(days, extraHours) {
  const d = Number(days);
  const h = extraHours == null || extraHours === '' ? 0 : Number(extraHours);
  if (!Number.isInteger(d) || d < 0) {
    throw fail('Days must be a whole number, 0 or more');
  }
  if (!Number.isFinite(h) || h < 0 || h >= HOURS_PER_DAY) {
    throw fail('Extra hours must be from 0 up to 8. 8 hours is another day.');
  }
  const visitHours = roundHours(d * HOURS_PER_DAY + h);
  if (!(visitHours > 0)) {
    throw fail('Enter at least 1 hour or 1 day');
  }
  return { durationDays: d, durationExtraHours: roundHours(h), visitHours };
}

/** Weekly visits from the start date through the until date, including both ends when they land on a visit. */
export function countWeeklyVisits(scheduleStart, recurrenceUntil) {
  const start = new Date(scheduleStart);
  const until = new Date(recurrenceUntil);
  if (Number.isNaN(start.getTime()) || Number.isNaN(until.getTime())) {
    throw fail('Choose a valid end date');
  }
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const untilDay = new Date(until);
  untilDay.setHours(0, 0, 0, 0);
  if (untilDay.getTime() < startDay.getTime()) {
    throw fail('The repeat-until date must be on or after the start date');
  }
  const diffDays = Math.round((untilDay.getTime() - startDay.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

/**
 * Business job size.
 * fixed: one visit, total hours = days×8 + extra hours.
 * recurring_indefinite: same visit every week, no end. The hour cap is one visit.
 * recurring_until: weekly until a date. The hour cap is visit hours × number of visits.
 */
export function buildJobSchedule({
  jobType,
  durationDays,
  durationExtraHours,
  scheduleStart,
  recurrenceUntil,
}) {
  const allowed = ['fixed', 'recurring_indefinite', 'recurring_until'];
  if (!allowed.includes(jobType)) {
    throw fail('Choose a job type');
  }
  const size = hoursFromDaysAndExtra(durationDays, durationExtraHours);
  const start = new Date(scheduleStart);
  if (Number.isNaN(start.getTime())) {
    throw fail('Choose when the job starts');
  }
  if (start.getTime() < Date.now() - 60_000) {
    throw fail('The start must not be in the past');
  }

  let visitCount = 1;
  let totalHours = size.visitHours;
  let until = null;
  let end = new Date(start.getTime() + size.visitHours * 3600000);

  if (jobType === 'recurring_until') {
    if (recurrenceUntil == null || recurrenceUntil === '') {
      throw fail('Choose the date this job repeats until');
    }
    visitCount = countWeeklyVisits(start, recurrenceUntil);
    totalHours = roundHours(size.visitHours * visitCount);
    until = new Date(recurrenceUntil);
    const last = new Date(start);
    last.setDate(last.getDate() + (visitCount - 1) * 7);
    end = new Date(last.getTime() + size.visitHours * 3600000);
  }

  return {
    jobType,
    durationDays: size.durationDays,
    durationExtraHours: size.durationExtraHours,
    visitHours: size.visitHours,
    visitCount: jobType === 'recurring_indefinite' ? null : visitCount,
    totalHours,
    recurrenceUntil: until,
    scheduleStart: start,
    scheduleEnd: end,
  };
}

/** Agency allocation: a positive hour count, or days converted at 8 hours each. */
export function parseAllocatedHours({ allocatedHours, allocatedDays } = {}) {
  if (allocatedHours != null && allocatedHours !== '') {
    const hours = Number(allocatedHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw fail('Allocated time must be more than 0');
    }
    return roundHours(hours);
  }
  if (allocatedDays != null && allocatedDays !== '') {
    const days = Number(allocatedDays);
    if (!Number.isFinite(days) || days <= 0) {
      throw fail('Allocated days must be more than 0');
    }
    return roundHours(days * HOURS_PER_DAY);
  }
  throw fail('Say how much time this person will work, in hours or days');
}

/** Hours the agency may hand out. Explicit job total wins; older jobs use the schedule window. */
export function jobHourBudget(request) {
  if (request?.totalHours > 0) return roundHours(request.totalHours);
  try {
    return durationHoursFromSchedule(request.scheduleStart, request.scheduleEnd);
  } catch {
    return null;
  }
}

export function assertHoursFit(budget, used, adding) {
  if (budget == null) {
    throw fail('This job has no hour total to assign');
  }
  const next = roundHours(Number(used) + Number(adding));
  if (next - budget > 0.0001) {
    const left = roundHours(Math.max(0, budget - used));
    throw fail(
      `Only ${left} hours are left on this job (${budget} in total). That assignment is ${adding} hours.`
    );
  }
}

export { roundHours };
