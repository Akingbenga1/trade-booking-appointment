'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatScheduleRange } from '../../../components/DateTimeRangePicker';
import { formatPaySummary } from '../../../lib/jobPay';

const ACTIVE = new Set(['assigned', 'en_route', 'on_site', 'in_progress']);

const NEXT_STAGE = {
  assigned: ['en_route', 'Next: on the way'],
  en_route: ['on_site', 'Next: on site'],
  on_site: ['in_progress', 'Next: in progress'],
  in_progress: ['completed', 'Next: completed'],
};

const COMPLETION = {
  open: 'Not started. The job is still open.',
  assigned: 'Locked to an agency. Cleaning has not started.',
  en_route: 'On the way. Cleaning has not started.',
  on_site: 'Crew is on site. Cleaning is not finished.',
  in_progress: 'Cleaning is in progress.',
  completed: 'Completed.',
  unmatched: 'Closed with no match.',
  cancelled: 'Cancelled before completion.',
};

function agencyIdOf(request) {
  const value = request?.assignedAgencyId;
  if (!value) return '';
  return String(value._id || value);
}

function paymentMessage(item) {
  if (!item.businessName) return 'Payment: no company charge. This is a personal job.';
  const pay = item.request.pay;
  if (!pay) return 'Payment: not set up yet.';
  const status = pay.paymentStatus || 'unpaid';
  const summary = formatPaySummary(pay);
  if (status === 'paid') return `Payment: paid. ${summary}`;
  if (status === 'pending') return `Payment: waiting for the card payment to finish. ${summary}`;
  if (status === 'failed') return `Payment: failed. ${summary}`;
  if (status === 'cancelled') return `Payment: cancelled. ${summary}`;
  return `Payment: unpaid. ${summary}`;
}

function splitOffers(items, agencyId) {
  const currentOffers = [];
  const currentJobs = [];
  const pastJobs = [];
  for (const item of items) {
    const status = item.request.status;
    const pending = item.offer.status === 'pending' && status === 'open';
    const ours = agencyIdOf(item.request) === String(agencyId) && ACTIVE.has(status);
    if (pending) currentOffers.push(item);
    else if (ours) currentJobs.push(item);
    else pastJobs.push(item);
  }
  return { currentOffers, currentJobs, pastJobs };
}

function OfferCard({ item, mode, busy, onInterest, onLock, onProgress }) {
  const { request, offer } = item;
  const requestId = request._id;
  const next = NEXT_STAGE[request.status];
  const interested =
    item.interestStatus === 'interested' || item.interestStatus === 'selected';
  return (
    <div className="item stack">
      <div className="row">
        <StatusBadge status={request.status} />
        <StatusBadge status={offer.status} />
        <span className="muted">{item.jobType}</span>
      </div>
      <strong>{request.serviceDetails}</strong>
      <div>{request.address}</div>
      {request.scheduleStart && request.scheduleEnd ? (
        <div className="muted">
          Window: {formatScheduleRange(request.scheduleStart, request.scheduleEnd)}
        </div>
      ) : null}
      <div>
        Job owner:{' '}
        {item.businessName
          ? `${item.businessName} (business)`
          : `${item.owner?.name || 'Unknown'} (personal client)`}
      </div>
      {item.businessName && item.owner?.name ? (
        <div className="muted">Posted by {item.owner.name}</div>
      ) : null}
      <div>{COMPLETION[request.status] || request.status}</div>
      <div>{paymentMessage(item)}</div>
      <div className="muted">
        Offer: {offer.status}
        {offer.distanceKm != null ? ` · ${offer.distanceKm} km away` : ''}
      </div>
      {mode === 'offer' ? (
        <div className="row">
          {item.canLock ? (
            <button type="button" disabled={busy} onClick={() => onLock(requestId)}>
              Accept and lock
            </button>
          ) : interested ? (
            <span className="muted">Interest sent. Waiting for the client to pick an agency.</span>
          ) : (
            <button type="button" disabled={busy} onClick={() => onInterest(requestId)}>
              Express interest
            </button>
          )}
        </div>
      ) : null}
      {mode === 'job' && next ? (
        <div className="row">
          <button
            type="button"
            disabled={busy}
            onClick={() => onProgress(requestId, next[0])}
          >
            {next[1]}
          </button>
          <Link href={`/agency/jobs/${requestId}`}>Swap staff</Link>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, hint, items, mode, busy, onInterest, onLock, onProgress }) {
  return (
    <div className="card stack">
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <div className="list">
        {items.length === 0 ? <p className="muted">None.</p> : null}
        {items.map((item) => (
          <OfferCard
            key={String(item.offer.id)}
            item={item}
            mode={mode}
            busy={busy}
            onInterest={onInterest}
            onLock={onLock}
            onProgress={onProgress}
          />
        ))}
      </div>
    </div>
  );
}

export default function AllOffersPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencyId, setAgencyId] = useState('');
  const [agencies, setAgencies] = useState([]);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await api('/api/agencies/mine');
    setAgencies(list);
    const id = agencyId || (list[0]?._id ? String(list[0]._id) : '');
    if (!agencyId && id) setAgencyId(id);
    if (!id) {
      setItems([]);
      return;
    }
    setItems(await api(`/api/agencies/${id}/offers`));
  }, [agencyId]);

  async function runAction(work, success) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await work();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function expressInterest(requestId) {
    return runAction(
      () =>
        api(`/api/requests/${requestId}/agency-interest`, {
          method: 'POST',
          body: { agencyId },
        }),
      'Interest sent. Waiting for the client to pick an agency.'
    );
  }

  function lockJob(requestId) {
    return runAction(
      () =>
        api(`/api/requests/${requestId}/agency-accept`, {
          method: 'POST',
          body: { agencyId },
        }),
      'Job locked to your agency.'
    );
  }

  function advance(requestId, status) {
    return runAction(
      () =>
        api(`/api/requests/${requestId}/progress`, {
          method: 'POST',
          body: { status },
        }),
      'Job moved to the next stage.'
    );
  }

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((err) => setError(err.message));
  }, [user, load]);

  if (!user || user.mustSetPassword) return null;

  const groups = splitOffers(items, agencyId);

  return (
    <div className="shell">
      <TopBar title="All offers" />
      <p className="muted">
        <Link href="/agency">Back to agency home</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {agencies.length > 1 ? (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <label>
            Agency
            <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
              {agencies.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="stack">
        <Panel
          title="Current offers"
          hint="Open jobs this agency has been offered and has not finished with yet."
          items={groups.currentOffers}
          mode="offer"
          busy={busy}
          onInterest={expressInterest}
          onLock={lockJob}
        />
        <Panel
          title="Current jobs"
          hint="Jobs this agency has locked and is still working."
          items={groups.currentJobs}
          mode="job"
          busy={busy}
          onProgress={advance}
        />
        <Panel
          title="Past jobs"
          hint="Finished, cancelled, or offers that are no longer open."
          items={groups.pastJobs}
          mode="past"
        />
      </div>
    </div>
  );
}
