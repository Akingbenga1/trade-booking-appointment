'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../../components/ui';
import { formatScheduleRange } from '../../../../components/DateTimeRangePicker';
import JobMap from '../../../../components/JobMap';
import { formatGbp, formatPaySummary } from '../../../../lib/jobPay';
import { describeJob, scheduleKindLabel } from '../../../../lib/jobHours';

const ACTIVE = new Set(['assigned', 'en_route', 'on_site', 'in_progress']);

const STATUS_LINE = {
  open: 'Still open. The client has not locked an agency yet.',
  assigned: 'Locked to an agency. Cleaning has not started.',
  en_route: 'On the way. Cleaning has not started.',
  on_site: 'Crew is on site. Cleaning is not finished.',
  in_progress: 'Cleaning is in progress.',
  completed: 'Completed.',
  unmatched: 'Closed with no match.',
  cancelled: 'Cancelled before completion.',
};

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function agencyIdOf(value) {
  if (!value) return '';
  return String(value._id || value);
}

export default function AgencyOfferDetailPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = String(params.requestId || '');
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    api('/api/agencies/mine')
      .then((list) => {
        setAgencies(list);
        setAgencyId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
      })
      .catch((err) => setError(err.message));
  }, [user]);

  const load = useCallback(async () => {
    if (!agencyId || !requestId) return;
    setItem(await api(`/api/agencies/${agencyId}/offers/${requestId}`));
  }, [agencyId, requestId]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !agencyId) return;
    load().catch((err) => setError(err.message));
  }, [user, agencyId, load]);

  async function run(action, success) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  const request = item?.request;
  const offer = item?.offer;
  const business = item?.business;
  const ours = request && agencyIdOf(request.assignedAgencyId) === String(agencyId);
  const interested = item?.interestStatus === 'interested' || item?.interestStatus === 'selected';
  const summary = request ? describeJob(request) : '';

  return (
    <div className="shell offer-detail">
      <TopBar title="Job offer" />
      <p className="muted">
        <Link href="/agency/offers">Back to all offers</Link>
        {' · '}
        <Link href="/agency">Agency home</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {agencies.length > 1 ? (
        <div className="card">
          <label>
            Agency
            <select value={agencyId} onChange={(event) => setAgencyId(event.target.value)}>
              {agencies.map((agency) => (
                <option key={agency._id} value={agency._id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {!item && !error ? <p className="muted">Loading the job…</p> : null}
      {request && offer ? (
        <>
          <section className="card offer-hero">
            <div className="row">
              <StatusBadge status={request.status} />
              <StatusBadge status={offer.status} />
              <span className="muted">{item.jobType}</span>
              <span className="job-kind">{scheduleKindLabel(request)}</span>
            </div>
            <h1>{request.serviceDetails}</h1>
            <p className="muted">{summary || 'The time below is the window the client chose.'}</p>
            <p>{STATUS_LINE[request.status] || request.status}</p>
            <div className="row">
              {offer.distanceKm != null ? (
                <span className="staff-count">{offer.distanceKm} km away</span>
              ) : null}
              {item.canLock ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        api(`/api/requests/${requestId}/agency-accept`, {
                          method: 'POST',
                          body: { agencyId },
                        }),
                      'Job locked. You can assign staff next.'
                    )
                  }
                >
                  Accept and lock
                </button>
              ) : null}
              {request.status === 'open' && offer.status === 'pending' && !item.canLock ? (
                interested ? (
                  <span className="muted">Interest sent. Waiting for the client to pick an agency.</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api(`/api/requests/${requestId}/agency-interest`, {
                            method: 'POST',
                            body: { agencyId },
                          }),
                        'Interest sent. Waiting for the client to pick an agency.'
                      )
                    }
                  >
                    Express interest
                  </button>
                )
              ) : null}
              {ours && ACTIVE.has(request.status) ? (
                <>
                  <Link className="offer-action" href={`/agency/jobs/${requestId}/assign`}>
                    Assign staff
                  </Link>
                  <Link href={`/agency/jobs/${requestId}`}>Swap staff</Link>
                </>
              ) : null}
            </div>
          </section>

          <div className="offer-layout">
            <section className="card stack">
              <h2>Job location</h2>
              <JobMap
                address={request.address}
                latitude={request.latitude}
                longitude={request.longitude}
                height={380}
              />
            </section>
            <section className="card stack">
              <h2>Job</h2>
              <dl className="staff-facts">
                <div>
                  <dt>Schedule</dt>
                  <dd>{scheduleKindLabel(request)}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>
                    {request.scheduleStart && request.scheduleEnd
                      ? formatScheduleRange(request.scheduleStart, request.scheduleEnd)
                      : 'Not set'}
                  </dd>
                </div>
                {request.visitHours ? (
                  <div>
                    <dt>Each visit</dt>
                    <dd>{request.visitHours} hours</dd>
                  </div>
                ) : null}
                {request.visitCount ? (
                  <div>
                    <dt>Visits</dt>
                    <dd>{request.visitCount}</dd>
                  </div>
                ) : null}
                {request.totalHours ? (
                  <div>
                    <dt>Hours in total</dt>
                    <dd>{request.totalHours}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Pay</dt>
                  <dd>
                    {request.pay
                      ? formatPaySummary(request.pay)
                      : 'No company charge. This is a personal job.'}
                  </dd>
                </div>
                {request.pay ? (
                  <div>
                    <dt>Payment</dt>
                    <dd>{request.pay.paymentStatus || 'unpaid'}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Offer</dt>
                  <dd>
                    {offer.status}
                    {offer.notifiedAt ? ` · sent ${when(offer.notifiedAt)}` : ''}
                  </dd>
                </div>
                {offer.expiresAt ? (
                  <div>
                    <dt>Offer closes</dt>
                    <dd>{when(offer.expiresAt)}</dd>
                  </div>
                ) : null}
              </dl>
              {request.pay?.totalAmount != null ? (
                <div className="offer-pay">
                  <span className="muted">Company total</span>
                  <strong>{formatGbp(request.pay.totalAmount)}</strong>
                </div>
              ) : null}
            </section>
          </div>

          <section className="card offer-party">
            <div className="staff-avatar" aria-hidden="true">
              {(business?.name || item.owner?.name || 'C').trim().charAt(0).toUpperCase()}
            </div>
            <div className="stack">
              <h2>{business ? 'Business' : 'Client'}</h2>
              {business ? (
                <dl className="staff-facts">
                  <div>
                    <dt>Name</dt>
                    <dd>{business.name}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{business.phone || 'No phone saved'}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{business.address || 'No address saved'}</dd>
                  </div>
                  <div>
                    <dt>Posted by</dt>
                    <dd>
                      {item.owner?.name || 'Unknown'}
                      {item.owner?.email ? ` · ${item.owner.email}` : ''}
                    </dd>
                  </div>
                </dl>
              ) : (
                <dl className="staff-facts">
                  <div>
                    <dt>Name</dt>
                    <dd>{item.owner?.name || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{item.owner?.email || 'No email saved'}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>Personal client</dd>
                  </div>
                </dl>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
