import Stripe from 'stripe';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { CleaningJobPay } from '../models/CleaningJobPay.js';
import { config } from '../config.js';
import { isBusinessMember } from './businessService.js';
import { payToPublic } from './jobPay.js';

function getStripe() {
  if (!config.stripeSecretKey) return null;
  return new Stripe(config.stripeSecretKey);
}

async function assertCanPay(requestId, user) {
  const request = await CleaningRequest.findById(requestId);
  if (!request || request.deletedAt) {
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

  const pay = await CleaningJobPay.findOne({ requestId: request._id });
  if (!pay) {
    const err = new Error('This request has no payable amount (business pay required)');
    err.status = 400;
    throw err;
  }

  return { request, pay };
}

/**
 * Start Stripe Checkout (or local stub) for a request's totalAmount.
 * @returns {{ url: string, sessionId: string, stub: boolean, pay: object }}
 */
export async function createCheckoutSession(requestId, user) {
  const { request, pay } = await assertCanPay(requestId, user);

  if (pay.paymentStatus === 'paid') {
    const err = new Error('This request is already paid');
    err.status = 409;
    throw err;
  }

  const amountPence = Math.round(Number(pay.totalAmount) * 100);
  if (!(amountPence > 0)) {
    const err = new Error('Invalid payment amount');
    err.status = 400;
    throw err;
  }

  const successUrl = `${config.clientOrigin}/client/pay/${request._id}?paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.clientOrigin}/client/pay/${request._id}?cancelled=1`;

  // Local/demo without Stripe keys
  if (config.stripeStub || !config.stripeSecretKey) {
    const sessionId = `stub_cs_${request._id}_${Date.now()}`;
    pay.paymentStatus = 'pending';
    pay.stripeCheckoutSessionId = sessionId;
    await pay.save();
    return {
      url: `${config.clientOrigin}/client/pay/${request._id}?session_id=${sessionId}`,
      sessionId,
      stub: true,
      pay: payToPublic(pay),
    };
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (pay.currency || 'GBP').toLowerCase(),
          unit_amount: amountPence,
          product_data: {
            name: `Cleaning: ${request.serviceDetails}`.slice(0, 120),
            description: `${pay.durationHours}h @ £${pay.payRatePerHour}/hr`,
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      requestId: String(request._id),
      jobPayId: String(pay._id),
    },
  });

  pay.paymentStatus = 'pending';
  pay.stripeCheckoutSessionId = session.id;
  await pay.save();

  return {
    url: session.url,
    sessionId: session.id,
    stub: false,
    pay: payToPublic(pay),
  };
}

/** Confirm payment after Stripe success (or stub complete). */
export async function confirmCheckoutPayment(requestId, user, sessionId) {
  const { pay } = await assertCanPay(requestId, user);

  if (pay.paymentStatus === 'paid') {
    return { pay: payToPublic(pay), alreadyPaid: true };
  }

  const sid = String(sessionId || pay.stripeCheckoutSessionId || '').trim();
  if (!sid) {
    const err = new Error('Missing checkout session');
    err.status = 400;
    throw err;
  }

  if (sid.startsWith('stub_cs_') || config.stripeStub || !config.stripeSecretKey) {
    if (pay.stripeCheckoutSessionId && pay.stripeCheckoutSessionId !== sid) {
      const err = new Error('Session mismatch');
      err.status = 400;
      throw err;
    }
    pay.paymentStatus = 'paid';
    pay.stripeCheckoutSessionId = sid;
    pay.paidAt = new Date();
    await pay.save();
    return { pay: payToPublic(pay), stub: true };
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

  pay.paymentStatus = 'paid';
  pay.stripeCheckoutSessionId = session.id;
  pay.stripePaymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  pay.paidAt = new Date();
  await pay.save();
  return { pay: payToPublic(pay), stub: false };
}

export async function getPaymentForRequest(requestId, user) {
  const { request, pay } = await assertCanPay(requestId, user);
  return {
    request: {
      id: request._id,
      serviceDetails: request.serviceDetails,
      address: request.address,
      status: request.status,
      scheduleStart: request.scheduleStart,
      scheduleEnd: request.scheduleEnd,
    },
    pay: payToPublic(pay),
  };
}
