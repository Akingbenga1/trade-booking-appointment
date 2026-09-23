import { scheduleDayCount } from '../components/DateTimeRangePicker';

/** UK NMW floor shown on business post form (£/hour). */
export const MINIMUM_WAGE_PER_HOUR = 12.71;

function roundHours(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/**
 * Working hours chosen per day (end clock − start clock), not continuous 24h elapsed time.
 */
export function workingHoursPerDay(scheduleStart, scheduleEnd) {
  if (!scheduleStart || !scheduleEnd) return null;
  const start = new Date(scheduleStart);
  const end = new Date(scheduleEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  const diffMin = endMin - startMin;
  if (!(diffMin > 0)) return null;
  return roundHours(diffMin / 60);
}

/**
 * Billable hours = working hours per day × inclusive days chosen.
 */
export function durationHoursFromSchedule(scheduleStart, scheduleEnd) {
  const hoursPerDay = workingHoursPerDay(scheduleStart, scheduleEnd);
  const days = scheduleDayCount(scheduleStart, scheduleEnd);
  if (hoursPerDay == null || days == null || days < 1) return null;
  return roundHours(hoursPerDay * days);
}

export function formatGbp(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return `£${Number(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPaySummary(pay) {
  if (!pay) return null;
  return `${formatGbp(pay.payRatePerHour)}/hr · ${pay.durationHours}h · total ${formatGbp(pay.totalAmount)}`;
}

export function computePayPreview(payRatePerHour, scheduleStart, scheduleEnd) {
  const rate = Number(payRatePerHour);
  const hoursPerDay = workingHoursPerDay(scheduleStart, scheduleEnd);
  const days = scheduleDayCount(scheduleStart, scheduleEnd);
  const hours = durationHoursFromSchedule(scheduleStart, scheduleEnd);
  if (!Number.isFinite(rate) || hours == null) {
    return {
      hours: null,
      hoursPerDay: null,
      days: null,
      total: null,
      belowMinimum: false,
    };
  }
  return {
    hours,
    hoursPerDay,
    days,
    total: Math.round(rate * hours * 100) / 100,
    belowMinimum: rate < MINIMUM_WAGE_PER_HOUR,
  };
}
