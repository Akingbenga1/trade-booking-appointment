'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { TopBar, useRequireRole, StatusBadge } from '../../../../components/ui';
import { formatGbp, formatPaySummary } from '../../../../lib/jobPay';
import { formatScheduleRange } from '../../../../components/DateTimeRangePicker';

export default function PayForServicePage() {
  const user = useRequireRole(['client', 'business']);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const requestId = params?.requestId;

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) return;
    const detail = await api(`/api/payments/request/${requestId}`);
    setData(detail);
  }, [requestId]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((e) => setError(e.message));
  }, [user, load]);

  // After Stripe redirect (?paid=1&session_id=...)
  useEffect(() => {
    if (!user || !requestId) return;
    const paid = searchParams.get('paid');
    const sessionId = searchParams.get('session_id');
    if (paid !== '1' || !sessionId) return;

    setLoading(true);
    api(`/api/payments/confirm/${requestId}`, {
      method: 'POST',
      body: { sessionId },
    })
      .then((result) => {
        setData((prev) => (prev ? { ...prev, pay: result.pay } : prev));
        setMessage('Payment successful. Thank you.');
        router.replace(`/client/pay/${requestId}`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user, requestId, searchParams, router]);

  async function startCheckout() {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const result = await api(`/api/payments/checkout/${requestId}`, {
        method: 'POST',
      });
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      setError('No checkout URL returned');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  const pay = data?.pay;
  const request = data?.request;
  const isPaid = pay?.paymentStatus === 'paid';
  const cancelled = searchParams.get('cancelled') === '1';

  return (
    <div className="shell">
      <TopBar title="Pay for service" />
      <div className="card stack" style={{ maxWidth: 520 }}>
        <div>
          <h2>Stripe payment</h2>
          <p className="muted">
            Pay the total for this cleaning request securely via Stripe Checkout.
          </p>
        </div>

        {error ? <div className="error">{error}</div> : null}
        {message ? <div className="success">{message}</div> : null}
        {cancelled ? (
          <div className="error">Checkout was cancelled. You can try again below.</div>
        ) : null}

        {!data && !error ? <p className="muted">Loading…</p> : null}

        {request && pay ? (
          <div className="stack">
            <div className="row">
              <StatusBadge status={request.status} />
              <StatusBadge status={pay.paymentStatus || 'unpaid'} />
            </div>
            <div>
              <strong>{request.serviceDetails}</strong>
            </div>
            <div className="muted">{request.address}</div>
            {request.scheduleStart && request.scheduleEnd ? (
              <div className="muted">
                Window: {formatScheduleRange(request.scheduleStart, request.scheduleEnd)}
              </div>
            ) : null}
            <div className="item stack">
              <div className="muted">{formatPaySummary(pay)}</div>
              <div>
                Amount due:{' '}
                <strong>{formatGbp(pay.totalAmount)}</strong> {pay.currency || 'GBP'}
              </div>
            </div>

            {isPaid ? (
              <div className="stack">
                <div className="success">
                  Paid
                  {pay.paidAt ? ` on ${new Date(pay.paidAt).toLocaleString()}` : ''}.
                </div>
                {pay.receiptUrl ? (
                  <a href={pay.receiptUrl} target="_blank" rel="noreferrer">
                    Download receipt
                  </a>
                ) : null}
              </div>
            ) : (
              <button type="button" disabled={loading} onClick={startCheckout}>
                {loading ? 'Redirecting…' : `Pay ${formatGbp(pay.totalAmount)} with Stripe`}
              </button>
            )}
          </div>
        ) : null}

        <Link href="/client" className="muted">
          ← Back to requests
        </Link>
      </div>
    </div>
  );
}
