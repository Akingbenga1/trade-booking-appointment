import Stripe from 'stripe';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { BusinessPayment } from '../models/BusinessPayment.js';
import { Transaction } from '../models/Transaction.js';
import { PaymentProviderEvent } from '../models/PaymentProviderEvent.js';
import { config } from '../config.js';
import { isBusinessMember } from './businessService.js';
import { payToPublic } from './jobPay.js';
import { applyPaymentStatus } from './payments/core.js';
import { mapStripeEvent } from './payments/stripeAdapter.js';

function getStripe() {
  if (!config.stripeSecretKey) {
    const err = new Error('Stripe is not configured (STRIPE_SECRET_KEY)');
    err.status = 503;
    throw err;
  }
  return new Stripe(config.stripeSecretKey);
}

async function assertCanPay(requestId, user) {
  const request = await CleaningRequest.findById(requestId);
  if (!request || request.deletedAt || request.archivedAt) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }

  const isPersonOwner = String(request.clientId) === String(user.id);
  const isBizMember =
    request.businessId && (await isBusinessMember(user.id, request.businessId));
  if (!isPersonOwner && !isBizMember && user.role !== 'admin') {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const businessPayment = await BusinessPayment.findOne({ requestId: request._id });
  if (!businessPayment) {
    const err = new Error('This request has no payable amount (business pay required)');
    err.status = 400;
    throw err;
  }
  const transaction = await Transaction.findById(businessPayment.transactionId);
  if (!transaction) {
    const err = new Error('This request has no payable amount (business pay required)');
    err.status = 400;
    throw err;
  }

  return { request, businessPayment, transaction };
}

async function fetchStripeReceiptUrl(paymentIntentId) {
  if (!paymentIntentId) return null;
  try {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
    const charge = pi.latest_charge;
    if (charge && typeof charge === 'object' && charge.receipt_url) {
      return charge.receipt_url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Start Stripe Checkout for a request's totalAmount.
 * @returns {{ url: string, sessionId: string, pay: object }}
 */
export async function createCheckoutSession(requestId, user) {
  const { request, businessPayment, transaction } = await assertCanPay(requestId, user);

  if (transaction.status === 'paid') {
    const err = new Error('This request is already paid');
    err.status = 409;
    throw err;
  }

  const amountPence = Math.round(Number(transaction.amount) * 100);
  if (!(amountPence > 0)) {
    const err = new Error('Invalid payment amount');
    err.status = 400;
    throw err;
  }

  const successUrl = `${config.clientOrigin}/client/pay/${request._id}?paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.clientOrigin}/client/pay/${request._id}?cancelled=1`;

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (transaction.currency || 'GBP').toLowerCase(),
          unit_amount: amountPence,
          product_data: {
            name: `Cleaning: ${request.serviceDetails}`.slice(0, 120),
            description: `${businessPayment.durationHours}h @ £${businessPayment.payRatePerHour}/hr`,
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      requestId: String(request._id),
      transactionId: String(transaction._id),
      businessPaymentId: String(businessPayment._id),
    },
  });

  const result = await applyPaymentStatus({
    transactionId: transaction._id,
    status: 'pending',
    provider: 'stripe',
    checkoutSessionIdToStore: session.id,
  });

  return {
    url: session.url,
    sessionId: session.id,
    pay: result.pay,
  };
}

/** Confirm payment after Stripe Checkout success redirect (backup until webhooks are trusted). */
export async function confirmCheckoutPayment(requestId, user, sessionId) {
  const { businessPayment, transaction } = await assertCanPay(requestId, user);

  if (transaction.status === 'paid') {
    return { pay: payToPublic(businessPayment, transaction), alreadyPaid: true };
  }

  const sid = String(sessionId || transaction.providerCheckoutSessionId || '').trim();
  if (!sid) {
    const err = new Error('Missing checkout session');
    err.status = 400;
    throw err;
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sid);
  if (session.metadata?.requestId && session.metadata.requestId !== String(requestId)) {
    const err = new Error('Session does not match this request');
    err.status = 400;
    throw err;
  }
  if (session.payment_status !== 'paid') {
    const err = new Error('Payment not completed yet');
    err.status = 409;
    throw err;
  }

  const providerPaymentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  const receiptUrl = await fetchStripeReceiptUrl(providerPaymentId);

  const result = await applyPaymentStatus({
    transactionId: transaction._id,
    status: 'paid',
    provider: 'stripe',
    checkoutSessionIdToStore: session.id,
    providerPaymentId,
    receiptUrl,
    paidAt: new Date(),
  });
  return { pay: result.pay, alreadyPaid: result.alreadyPaid };
}

export async function getPaymentForRequest(requestId, user) {
  const { request, businessPayment, transaction } = await assertCanPay(requestId, user);
  return {
    request: {
      id: request._id,
      serviceDetails: request.serviceDetails,
      address: request.address,
      status: request.status,
      scheduleStart: request.scheduleStart,
      scheduleEnd: request.scheduleEnd,
    },
    pay: payToPublic(businessPayment, transaction),
  };
}

/**
 * List payment transactions for one business the user belongs to.
 * Reads business_payments (ownership) → transactions → request label.
 */
export async function listBusinessTransactions(user, businessId) {
  if (user.role !== 'business') {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const bid = String(businessId || '').trim();
  if (!bid) {
    const err = new Error('businessId is required');
    err.status = 400;
    throw err;
  }
  if (!(await isBusinessMember(user.id, bid))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const ownership = await BusinessPayment.find({ businessId: bid }).sort({
    updatedAt: -1,
  });
  const txIds = ownership.map((o) => o.transactionId).filter(Boolean);
  const requestIds = ownership.map((o) => o.requestId);

  const [transactions, requests] = await Promise.all([
    txIds.length ? Transaction.find({ _id: { $in: txIds } }) : [],
    requestIds.length
      ? CleaningRequest.find({ _id: { $in: requestIds } }).select(
          'serviceDetails address status deletedAt'
        )
      : [],
  ]);

  const txById = new Map(transactions.map((t) => [String(t._id), t]));
  const byRequest = new Map(requests.map((r) => [String(r._id), r]));

  return ownership.map((bp) => {
    const tx = txById.get(String(bp.transactionId));
    const request = byRequest.get(String(bp.requestId));
    return {
      id: tx?._id || bp._id,
      date: tx?.paidAt || tx?.updatedAt || bp.updatedAt || bp.createdAt,
      amount: tx?.amount,
      currency: tx?.currency || 'GBP',
      requestId: bp.requestId,
      jobLabel: request?.serviceDetails || 'Cleaning request',
      requestStatus: request?.status || null,
      status: tx?.status || 'unpaid',
      providerId: tx?.providerPaymentId || tx?.providerCheckoutSessionId || null,
      receiptUrl: tx?.receiptUrl || null,
    };
  });
}

/**
 * Verify Stripe signature, store raw event, map to neutral status, apply.
 * @param {Buffer|string} rawBody
 * @param {string} signature
 */
export async function handleStripeWebhook(rawBody, signature) {
  if (!config.stripeWebhookSecret) {
    const err = new Error('Stripe webhook secret is not configured (STRIPE_WEBHOOK_SECRET)');
    err.status = 503;
    throw err;
  }

  const stripe = getStripe();
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripeWebhookSecret
    );
  } catch (e) {
    const err = new Error(`Webhook signature verification failed: ${e.message}`);
    err.status = 400;
    throw err;
  }

  const existing = await PaymentProviderEvent.findOne({
    provider: 'stripe',
    providerEventId: stripeEvent.id,
  });
  if (existing?.processingStatus === 'processed' || existing?.processingStatus === 'ignored') {
    return { received: true, duplicate: true };
  }

  const mapped = mapStripeEvent(stripeEvent);
  const record =
    existing ||
    (await PaymentProviderEvent.create({
      provider: 'stripe',
      providerEventId: stripeEvent.id,
      providerEventType: stripeEvent.type,
      ...(mapped?.status ? { mappedStatus: mapped.status } : {}),
      ...(mapped?.requestId ? { requestId: mapped.requestId } : {}),
      ...(mapped?.transactionId ? { transactionId: mapped.transactionId } : {}),
      payload: stripeEvent,
      processingStatus: 'received',
    }));

  if (!mapped) {
    record.processingStatus = 'ignored';
    record.processedAt = new Date();
    await record.save();
    return { received: true, ignored: true };
  }

  try {
    let receiptUrl = null;
    if (mapped.status === 'paid' && mapped.providerPaymentId) {
      receiptUrl = await fetchStripeReceiptUrl(mapped.providerPaymentId);
    }

    await applyPaymentStatus({
      transactionId: mapped.transactionId,
      requestId: mapped.requestId,
      checkoutSessionId: mapped.checkoutSessionId,
      status: mapped.status,
      provider: 'stripe',
      providerPaymentId: mapped.providerPaymentId,
      checkoutSessionIdToStore: mapped.checkoutSessionId,
      receiptUrl,
      paidAt: mapped.status === 'paid' ? new Date() : undefined,
    });

    record.mappedStatus = mapped.status;
    record.requestId = mapped.requestId || record.requestId;
    record.transactionId = mapped.transactionId || record.transactionId;
    record.processingStatus = 'processed';
    record.processedAt = new Date();
    record.processingError = undefined;
    await record.save();
    return { received: true, status: mapped.status };
  } catch (err) {
    record.processingStatus = 'error';
    record.processingError = err.message;
    record.processedAt = new Date();
    await record.save();
    throw err;
  }
}
