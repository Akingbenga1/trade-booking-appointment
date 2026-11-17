'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { StatusBadge } from './ui';
import { formatScheduleRange } from './DateTimeRangePicker';
import { MINIMUM_WAGE_PER_HOUR, formatGbp, formatPaySummary } from '../lib/jobPay';
import { describeJob } from '../lib/jobHours';
import { hasPlacePin } from '../lib/place';

export default function MyRequests({
  requests,
  user,
  onReload,
  setError,
  setMessage,
  rematchDraft,
  title = 'My requests',
}) {
  async function cancel(id) {
    setError('');
    try {
      await api(`/api/requests/${id}/cancel`, { method: 'POST' });
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    setError('');
    setMessage('');
    try {
      await api(`/api/requests/${id}/remove`, { method: 'POST' });
      setMessage('Request removed.');
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function hide(id) {
    setError('');
    setMessage('');
    try {
      await api(`/api/requests/${id}/archive`, { method: 'POST' });
      setMessage('Job archived. See Archived for the list.');
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateRequest(request, opts = {}) {
    const rematch = Boolean(opts.rematch);
    const currentPay = request.pay;
    let nextDetails = request.serviceDetails;
    if (!rematch) {
      const next = window.prompt('Update service details', request.serviceDetails || '');
      if (next == null || next.trim() === '') return;
      nextDetails = next.trim();
    } else if (rematchDraft) {
      nextDetails = rematchDraft.serviceDetails || request.serviceDetails;
      if (!hasPlacePin(rematchDraft.place)) {
        setError('Pick an address from the suggestions before rematching');
        return;
      }
    }

    let nextPayRate;
    if (user.role === 'business') {
      const ratePrompt = window.prompt(
        `Hourly pay rate (£, min ${formatGbp(MINIMUM_WAGE_PER_HOUR)})`,
        currentPay?.payRatePerHour != null
          ? String(currentPay.payRatePerHour)
          : String(MINIMUM_WAGE_PER_HOUR)
      );
      if (ratePrompt == null || ratePrompt.trim() === '') return;
      nextPayRate = Number(ratePrompt);
      if (!Number.isFinite(nextPayRate) || nextPayRate < MINIMUM_WAGE_PER_HOUR) {
        setError(`Hourly rate must be at least ${formatGbp(MINIMUM_WAGE_PER_HOUR)}`);
        return;
      }
    }

    setError('');
    setMessage('');
    try {
      const body = { serviceDetails: nextDetails };
      if (nextPayRate != null) body.payRatePerHour = nextPayRate;
      if (rematch) {
        const place = rematchDraft?.place || request;
        body.address = String(place.address || '').trim();
        body.latitude = Number(place.latitude);
        body.longitude = Number(place.longitude);
      }
      const updated = await api(`/api/requests/${request._id}`, {
        method: 'PATCH',
        body,
      });
      setMessage(
        updated.status === 'unmatched'
          ? 'Updated — still no cleaners nearby.'
          : updated.status === 'open' && updated.notifiedCleanerCount
            ? `Updated — nearby cleaners notified (${updated.notifiedCleanerCount}).`
            : 'Request updated.'
      );
      await onReload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <Link href="/client/archived" className="muted">
          Archived jobs
        </Link>
      </div>
      <div className="list">
        {requests.length === 0 ? <p className="muted">None yet.</p> : null}
        {requests.map((r) => {
          const isPaid = r.pay?.paymentStatus === 'paid';
          return (
            <div className="item stack" key={r._id}>
              <div className="row">
                <StatusBadge status={r.status} />
                <span className="muted">
                  Notified: {r.notifiedCleanerCount ?? 0} cleaners
                  {r.notifiedAgencyCount != null ? ` · ${r.notifiedAgencyCount} agencies` : ''}
                </span>
                {r.businessId?.name ? <span className="muted">{r.businessId.name}</span> : null}
              </div>
              <div>{r.serviceDetails}</div>
              <div className="muted">{r.address}</div>
              {describeJob(r) ? <div>{describeJob(r)}</div> : null}
              {r.scheduleStart && r.scheduleEnd ? (
                <div className="muted">Window: {formatScheduleRange(r.scheduleStart, r.scheduleEnd)}</div>
              ) : r.preferredTime ? (
                <div className="muted">Preferred: {new Date(r.preferredTime).toLocaleString()}</div>
              ) : null}
              {r.pay ? (
                <div className="muted">
                  Pay: {formatPaySummary(r.pay)}
                  {r.jobType === 'recurring_indefinite' ? ' per visit' : ''}
                  {isPaid ? ' · PAID' : ''}
                </div>
              ) : null}
              {r.assignedCleanerId ? (
                <div className="muted">Assigned cleaner: {r.assignedCleanerId.name || r.assignedCleanerId}</div>
              ) : null}
              {r.assignedAgencyId ? (
                <div className="muted">
                  Agency: {r.assignedAgency?.name || r.assignedAgencyId?.name || r.assignedAgencyId}
                  {r.assignedStaffIds?.length
                    ? ` · Staff: ${r.assignedStaffIds.map((s) => s.name || s).join(', ')}`
                    : ''}
                </div>
              ) : null}
              {r.status === 'open' ? <AgencyInterestPicker requestId={r._id} onPicked={onReload} /> : null}
              {r.status === 'open' || r.status === 'unmatched' ? (
                <div className="row">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => updateRequest(r, { rematch: r.status === 'unmatched' })}
                  >
                    {r.status === 'unmatched' ? 'Adjust & rematch' : 'Update'}
                  </button>
                  {!isPaid ? (
                    <button className="danger" type="button" onClick={() => cancel(r._id)}>
                      Cancel
                    </button>
                  ) : (
                    <button className="secondary" type="button" onClick={() => hide(r._id)}>
                      Hide
                    </button>
                  )}
                  {r.pay && !isPaid ? (
                    <Link href={`/client/pay/${r._id}`}>
                      <button type="button">Pay for Service</button>
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {r.pay && !isPaid && r.status !== 'open' && r.status !== 'unmatched' && r.status !== 'cancelled' ? (
                <div className="row">
                  <Link href={`/client/pay/${r._id}`}>
                    <button type="button">Pay for Service</button>
                  </Link>
                </div>
              ) : null}
              {isPaid && r.status !== 'open' && r.status !== 'unmatched' ? (
                <div className="row">
                  <button className="secondary" type="button" onClick={() => hide(r._id)}>
                    Hide
                  </button>
                </div>
              ) : null}
              {r.status === 'cancelled' ? (
                <div className="row">
                  <button className="danger" type="button" onClick={() => remove(r._id)}>
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function AgencyInterestPicker({ requestId, onPicked }) {
  const [interests, setInterests] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api(`/api/requests/${requestId}/interests`);
        if (!cancelled) setInterests(list.filter((i) => i.status === 'interested'));
      } catch {
        if (!cancelled) setInterests([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  async function pick(agencyId) {
    setError('');
    try {
      await api(`/api/requests/${requestId}/pick-agency`, {
        method: 'POST',
        body: { agencyId },
      });
      await onPicked();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!interests.length) return null;

  return (
    <div className="stack">
      <div className="muted">Interested agencies — pick one:</div>
      {error ? <div className="error">{error}</div> : null}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {interests.map((i) => (
          <button key={String(i._id)} type="button" onClick={() => pick(i.agencyId?._id || i.agencyId)}>
            Pick {i.agencyId?.name || 'agency'}
          </button>
        ))}
      </div>
    </div>
  );
}
