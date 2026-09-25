/**
 * Stripe → provider-neutral payment events.
 * Only maps v1 outcomes: paid, failed, cancelled.
 */

/**
 * @typedef {{
 *   status: 'paid' | 'failed' | 'cancelled',
 *   requestId?: string,
 *   transactionId?: string,
 *   checkoutSessionId?: string,
 *   providerPaymentId?: string,
 *   receiptUrl?: string | null,
 * }} NeutralPaymentEvent
 */

/**
 * Map a verified Stripe event object into zero or one neutral payment event.
 * @param {object} stripeEvent
 * @returns {NeutralPaymentEvent | null}
 */
export function mapStripeEvent(stripeEvent) {
  const type = stripeEvent?.type;
  const obj = stripeEvent?.data?.object;
  if (!type || !obj) return null;

  const requestId = obj.metadata?.requestId || undefined;
  const transactionId =
    obj.metadata?.transactionId || obj.metadata?.jobPayId || undefined;
  const checkoutSessionId = obj.object === 'checkout.session' ? obj.id : undefined;
  const providerPaymentId =
    typeof obj.payment_intent === 'string'
      ? obj.payment_intent
      : obj.payment_intent?.id || (obj.object === 'payment_intent' ? obj.id : undefined);

  if (type === 'checkout.session.completed') {
    if (obj.payment_status === 'paid') {
      return {
        status: 'paid',
        requestId,
        transactionId,
        checkoutSessionId,
        providerPaymentId,
      };
    }
    return null;
  }

  if (type === 'checkout.session.async_payment_succeeded') {
    return {
      status: 'paid',
      requestId,
      transactionId,
      checkoutSessionId,
      providerPaymentId,
    };
  }

  if (type === 'checkout.session.async_payment_failed') {
    return {
      status: 'failed',
      requestId,
      transactionId,
      checkoutSessionId,
      providerPaymentId,
    };
  }

  if (type === 'checkout.session.expired') {
    return {
      status: 'cancelled',
      requestId,
      transactionId,
      checkoutSessionId,
      providerPaymentId,
    };
  }

  if (type === 'payment_intent.payment_failed') {
    return {
      status: 'failed',
      requestId: obj.metadata?.requestId,
      transactionId: obj.metadata?.transactionId || obj.metadata?.jobPayId,
      providerPaymentId: obj.id,
      checkoutSessionId: undefined,
    };
  }

  return null;
}
