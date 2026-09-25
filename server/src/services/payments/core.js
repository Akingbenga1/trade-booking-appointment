import { Transaction } from '../../models/Transaction.js';
import { BusinessPayment } from '../../models/BusinessPayment.js';
import { payToPublic } from '../jobPay.js';

const TERMINAL = new Set(['paid']);
const ALLOWED = new Set(['paid', 'failed', 'cancelled', 'pending', 'unpaid']);

/**
 * Apply a provider-neutral payment status update to a transaction row.
 * Idempotent for already-paid rows (paid wins and is not overwritten).
 *
 * @param {{
 *   transactionId?: string,
 *   requestId?: string,
 *   checkoutSessionId?: string,
 *   status: 'paid' | 'failed' | 'cancelled' | 'pending' | 'unpaid',
 *   provider?: string,
 *   providerPaymentId?: string,
 *   checkoutSessionIdToStore?: string,
 *   receiptUrl?: string | null,
 *   paidAt?: Date | null,
 * }} event
 */
export async function applyPaymentStatus(event) {
  const status = String(event.status || '').trim();
  if (!ALLOWED.has(status)) {
    const err = new Error(`Unknown payment status: ${status}`);
    err.status = 400;
    throw err;
  }

  let transaction = null;
  if (event.transactionId) {
    transaction = await Transaction.findById(event.transactionId);
  }
  if (!transaction && event.requestId) {
    transaction = await Transaction.findOne({ requestId: event.requestId }).sort({
      createdAt: -1,
    });
  }
  if (!transaction && event.checkoutSessionId) {
    transaction = await Transaction.findOne({
      providerCheckoutSessionId: event.checkoutSessionId,
    });
  }
  if (!transaction) {
    const err = new Error('Payment record not found');
    err.status = 404;
    throw err;
  }

  if (TERMINAL.has(transaction.status) && status !== 'paid') {
    const businessPayment = await BusinessPayment.findOne({
      transactionId: transaction._id,
    });
    return {
      transaction,
      businessPayment,
      pay: payToPublic(businessPayment, transaction),
      alreadyPaid: true,
      unchanged: true,
    };
  }
  if (transaction.status === 'paid' && status === 'paid') {
    let changed = false;
    if (event.receiptUrl && !transaction.receiptUrl) {
      transaction.receiptUrl = event.receiptUrl;
      await transaction.save();
      changed = true;
    }
    const businessPayment = await BusinessPayment.findOne({
      transactionId: transaction._id,
    });
    return {
      transaction,
      businessPayment,
      pay: payToPublic(businessPayment, transaction),
      alreadyPaid: true,
      unchanged: !changed,
    };
  }

  transaction.status = status;
  if (event.provider) transaction.provider = event.provider;
  if (event.checkoutSessionIdToStore) {
    transaction.providerCheckoutSessionId = event.checkoutSessionIdToStore;
  }
  if (event.providerPaymentId) {
    transaction.providerPaymentId = event.providerPaymentId;
  }
  if (event.receiptUrl) {
    transaction.receiptUrl = event.receiptUrl;
  }
  if (status === 'paid') {
    transaction.paidAt = event.paidAt || new Date();
  }
  await transaction.save();

  const businessPayment = await BusinessPayment.findOne({
    transactionId: transaction._id,
  });
  return {
    transaction,
    businessPayment,
    pay: payToPublic(businessPayment, transaction),
    alreadyPaid: false,
    unchanged: false,
  };
}

export function publicPay(businessPayment, transaction) {
  return payToPublic(businessPayment, transaction);
}
