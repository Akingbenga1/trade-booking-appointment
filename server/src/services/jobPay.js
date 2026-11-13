import { BusinessPayment } from '../models/BusinessPayment.js';
import { Transaction } from '../models/Transaction.js';

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
export function parseJobPay(payRatePerHour, scheduleStart, scheduleEnd, options = {}) {
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

  const durationHours =
    options.durationHours != null
      ? roundHours(options.durationHours)
      : durationHoursFromSchedule(scheduleStart, scheduleEnd);
  if (!(durationHours > 0)) {
    const err = new Error('Job hours must be more than 0');
    err.status = 400;
    throw err;
  }
  const totalAmount = roundMoney(rate * durationHours);

  return {
    payRatePerHour: roundMoney(rate),
    currency: 'GBP',
    minimumWagePerHour: MINIMUM_WAGE_PER_HOUR,
    durationHours,
    totalAmount,
  };
}

/** Build the public `pay` shape from ownership + transaction rows. */
export function payToPublic(businessPayment, transaction) {
  if (!businessPayment && !transaction) return null;
  const bp =
    businessPayment && typeof businessPayment.toObject === 'function'
      ? businessPayment.toObject()
      : businessPayment || {};
  const tx =
    transaction && typeof transaction.toObject === 'function'
      ? transaction.toObject()
      : transaction || {};

  return {
    payRatePerHour: bp.payRatePerHour,
    currency: tx.currency || 'GBP',
    minimumWagePerHour: bp.minimumWagePerHour,
    durationHours: bp.durationHours,
    totalAmount: tx.amount,
    paymentStatus: tx.status || 'unpaid',
    paidAt: tx.paidAt || null,
    providerId: tx.providerPaymentId || tx.providerCheckoutSessionId || null,
    receiptUrl: tx.receiptUrl || null,
  };
}

/** Staff or visit pay from an hourly rate and an hour count. */
export function quoteHourlyPay(payRatePerHour, durationHours) {
  return parseJobPay(payRatePerHour, null, null, { durationHours });
}

/**
 * Create unpaid transaction + business ownership for a new business request.
 * @returns {{ businessPayment: object, transaction: object }}
 */
export async function createJobPayForRequest({
  requestId,
  businessId,
  payRatePerHour,
  scheduleStart,
  scheduleEnd,
  durationHours,
}) {
  const fields = parseJobPay(payRatePerHour, scheduleStart, scheduleEnd, { durationHours });
  const transaction = await Transaction.create({
    requestId,
    amount: fields.totalAmount,
    currency: fields.currency,
    status: 'unpaid',
  });
  const businessPayment = await BusinessPayment.create({
    businessId,
    requestId,
    transactionId: transaction._id,
    payRatePerHour: fields.payRatePerHour,
    minimumWagePerHour: fields.minimumWagePerHour,
    durationHours: fields.durationHours,
  });
  return { businessPayment, transaction };
}

/**
 * Upsert pay for a business request when rate and/or schedule changes.
 * If payRatePerHour is omitted, keeps the existing rate and recalculates duration/total.
 * @returns {{ businessPayment: object, transaction: object } | null}
 */
export async function syncJobPayForRequest(request, { payRatePerHour } = {}) {
  if (!request.businessId) return null;

  const existing = await BusinessPayment.findOne({ requestId: request._id });
  const rate =
    payRatePerHour != null && payRatePerHour !== ''
      ? payRatePerHour
      : existing?.payRatePerHour;

  if (rate == null) {
    const err = new Error('payRatePerHour is required for business posts');
    err.status = 400;
    throw err;
  }

  const fields = parseJobPay(rate, request.scheduleStart, request.scheduleEnd, {
    durationHours: request.totalHours > 0 ? request.totalHours : undefined,
  });

  if (existing) {
    existing.payRatePerHour = fields.payRatePerHour;
    existing.minimumWagePerHour = fields.minimumWagePerHour;
    existing.durationHours = fields.durationHours;
    await existing.save();

    const transaction = await Transaction.findById(existing.transactionId);
    if (transaction && transaction.status !== 'paid') {
      transaction.amount = fields.totalAmount;
      transaction.currency = fields.currency;
      await transaction.save();
    }
    return { businessPayment: existing, transaction };
  }

  return createJobPayForRequest({
    requestId: request._id,
    businessId: request.businessId,
    payRatePerHour: rate,
    scheduleStart: request.scheduleStart,
    scheduleEnd: request.scheduleEnd,
  });
}

export async function findPayByRequestId(requestId) {
  const businessPayment = await BusinessPayment.findOne({ requestId });
  if (!businessPayment) return null;
  const transaction = await Transaction.findById(businessPayment.transactionId);
  return { businessPayment, transaction };
}

export async function findPayByRequestIds(requestIds) {
  if (!requestIds?.length) return new Map();
  const ownership = await BusinessPayment.find({ requestId: { $in: requestIds } });
  const txIds = ownership.map((o) => o.transactionId).filter(Boolean);
  const transactions = txIds.length
    ? await Transaction.find({ _id: { $in: txIds } })
    : [];
  const txById = new Map(transactions.map((t) => [String(t._id), t]));
  return new Map(
    ownership.map((bp) => [
      String(bp.requestId),
      { businessPayment: bp, transaction: txById.get(String(bp.transactionId)) || null },
    ])
  );
}

/** Attach public `pay` onto plain request object(s). Mutates and returns same shape. */
export async function attachPayToRequests(docs) {
  const single = !Array.isArray(docs);
  const list = single ? [docs] : docs;
  if (!list.length || !list[0]) return docs;

  const ids = list.map((d) => d?._id || d?.id).filter(Boolean);
  const byId = await findPayByRequestIds(ids);

  for (const doc of list) {
    if (!doc) continue;
    const id = String(doc._id || doc.id);
    const pair = byId.get(id);
    doc.pay = payToPublic(pair?.businessPayment, pair?.transaction);
  }
  return single ? list[0] : list;
}
