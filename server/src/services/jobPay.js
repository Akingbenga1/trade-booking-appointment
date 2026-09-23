import { CleaningJobPay } from '../models/CleaningJobPay.js';

/** UK NMW floor used by this product (£/hour). */
export const MINIMUM_WAGE_PER_HOUR = 12.71;

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function formatGbp(amount) {
  return `£${Number(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function roundHours(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Inclusive calendar-day count for a schedule window. */
export function scheduleDayCount(scheduleStart, scheduleEnd) {
  const start = scheduleStart instanceof Date ? scheduleStart : new Date(scheduleStart);
  const end = scheduleEnd instanceof Date ? scheduleEnd : new Date(scheduleEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return null;
  }
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000) + 1;
}

/**
 * Working hours chosen per day (end clock time − start clock time), not continuous elapsed time.
 * @returns {number}
 */
export function workingHoursPerDay(scheduleStart, scheduleEnd) {
  const start = scheduleStart instanceof Date ? scheduleStart : new Date(scheduleStart);
  const end = scheduleEnd instanceof Date ? scheduleEnd : new Date(scheduleEnd);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  const diffMin = endMin - startMin;
  if (!(diffMin > 0)) {
    const err = new Error(
      'End time of day must be after start time of day (working hours × days)'
    );
    err.status = 400;
    throw err;
  }
  return roundHours(diffMin / 60);
}

/**
 * Billable hours = working hours per day × inclusive days chosen.
 * @returns {number}
 */
export function durationHoursFromSchedule(scheduleStart, scheduleEnd) {
  const start = scheduleStart instanceof Date ? scheduleStart : new Date(scheduleStart);
  const end = scheduleEnd instanceof Date ? scheduleEnd : new Date(scheduleEnd);
  if (!(end.getTime() > start.getTime())) {
    const err = new Error('scheduleEnd must be after scheduleStart');
    err.status = 400;
    throw err;
  }
  const days = scheduleDayCount(start, end);
  const hoursPerDay = workingHoursPerDay(start, end);
  return roundHours(hoursPerDay * days);
}

/**
 * Validate hourly rate and compute pay fields for a schedule window.
 * @returns {{ payRatePerHour: number, currency: string, minimumWagePerHour: number, durationHours: number, totalAmount: number }}
 */
export function parseJobPay(payRatePerHour, scheduleStart, scheduleEnd) {
  if (payRatePerHour == null || payRatePerHour === '') {
    const err = new Error('payRatePerHour is required for business posts');
    err.status = 400;
    throw err;
  }
  const rate = Number(payRatePerHour);
  if (!Number.isFinite(rate)) {
    const err = new Error('payRatePerHour must be a number');
    err.status = 400;
    throw err;
  }
  if (rate < MINIMUM_WAGE_PER_HOUR) {
    const err = new Error(
      `payRatePerHour must be at least ${formatGbp(MINIMUM_WAGE_PER_HOUR)} / hour`
    );
    err.status = 400;
    throw err;
  }

  const durationHours = durationHoursFromSchedule(scheduleStart, scheduleEnd);
  const totalAmount = roundMoney(rate * durationHours);

  return {
    payRatePerHour: roundMoney(rate),
    currency: 'GBP',
    minimumWagePerHour: MINIMUM_WAGE_PER_HOUR,
    durationHours,
    totalAmount,
  };
}

export function payToPublic(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    payRatePerHour: o.payRatePerHour,
    currency: o.currency,
    minimumWagePerHour: o.minimumWagePerHour,
    durationHours: o.durationHours,
    totalAmount: o.totalAmount,
    paymentStatus: o.paymentStatus || 'unpaid',
    paidAt: o.paidAt || null,
  };
}

export async function createJobPayForRequest({
  requestId,
  businessId,
  payRatePerHour,
  scheduleStart,
  scheduleEnd,
}) {
  const fields = parseJobPay(payRatePerHour, scheduleStart, scheduleEnd);
  return CleaningJobPay.create({
    requestId,
    businessId,
    ...fields,
  });
}

/**
 * Upsert pay for a business request when rate and/or schedule changes.
 * If payRatePerHour is omitted, keeps the existing rate and recalculates duration/total.
 */
export async function syncJobPayForRequest(request, { payRatePerHour } = {}) {
  if (!request.businessId) return null;

  const existing = await CleaningJobPay.findOne({ requestId: request._id });
  const rate =
    payRatePerHour != null && payRatePerHour !== ''
      ? payRatePerHour
      : existing?.payRatePerHour;

  if (rate == null) {
    const err = new Error('payRatePerHour is required for business posts');
    err.status = 400;
    throw err;
  }

  const fields = parseJobPay(rate, request.scheduleStart, request.scheduleEnd);

  if (existing) {
    existing.payRatePerHour = fields.payRatePerHour;
    existing.currency = fields.currency;
    existing.minimumWagePerHour = fields.minimumWagePerHour;
    existing.durationHours = fields.durationHours;
    existing.totalAmount = fields.totalAmount;
    await existing.save();
    return existing;
  }

  return CleaningJobPay.create({
    requestId: request._id,
    businessId: request.businessId,
    ...fields,
  });
}

export async function findPayByRequestId(requestId) {
  return CleaningJobPay.findOne({ requestId });
}

export async function findPayByRequestIds(requestIds) {
  if (!requestIds?.length) return new Map();
  const rows = await CleaningJobPay.find({ requestId: { $in: requestIds } });
  return new Map(rows.map((r) => [String(r.requestId), r]));
}

/** Attach public `pay` onto plain request object(s). Mutates and returns same shape. */
export async function attachPayToRequests(docs) {
  const single = !Array.isArray(docs);
  const list = single ? [docs] : docs;
  if (!list.length || !list[0]) return docs;

  const ids = list
    .map((d) => d?._id || d?.id)
    .filter(Boolean);
  const byId = await findPayByRequestIds(ids);

  for (const doc of list) {
    if (!doc) continue;
    const id = String(doc._id || doc.id);
    const pay = byId.get(id);
    if (typeof doc.toObject === 'function') {
      // leave mongoose doc alone; callers usually use plain objects
    }
    doc.pay = payToPublic(pay);
  }
  return single ? list[0] : list;
}
