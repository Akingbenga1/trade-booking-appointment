'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../components/ui';
import {
  DateTimeRangePicker,
  defaultScheduleRange,
  formatScheduleRange,
} from '../../components/DateTimeRangePicker';
import LocationPicker from '../../components/LocationPicker';
import {
  MINIMUM_WAGE_PER_HOUR,
  computePayPreview,
  formatGbp,
  formatPaySummary,
} from '../../lib/jobPay';

const DEFAULT_PLACE = {
  address: '',
  latitude: null,
  longitude: null,
};

export default function ClientPage() {
  const router = useRouter();
  const user = useRequireRole(['client', 'business']);
  const [requests, setRequests] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState(() => defaultScheduleRange());
  const [payRatePerHour, setPayRatePerHour] = useState(String(MINIMUM_WAGE_PER_HOUR));
  const [serviceDetails, setServiceDetails] = useState('Office deep clean tomorrow');
  const [place, setPlace] = useState(DEFAULT_PLACE);

  const payPreview = useMemo(
    () =>
      computePayPreview(payRatePerHour, schedule.scheduleStart, schedule.scheduleEnd),
    [payRatePerHour, schedule.scheduleStart, schedule.scheduleEnd]
  );

  useEffect(() => {
    if (user?.mustSetPassword) {
      router.replace('/auth/set-password');
    }
  }, [user, router]);

  const load = useCallback(async () => {
    const mine = await api('/api/requests/mine');
    setRequests(mine);
    if (user?.role === 'business') {
      const list = await api('/api/businesses');
      setBusinesses(list);
      const preferred =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('tba_selected_business')
          : null;
      if (preferred) sessionStorage.removeItem('tba_selected_business');
      setSelectedBusinessId((prev) => {
        if (preferred && list.some((b) => String(b._id) === String(preferred))) {
          return String(preferred);
        }
        if (prev && list.some((b) => String(b._id) === String(prev))) return prev;
        return list[0]?._id ? String(list[0]._id) : '';
      });
    }
  }, [user?.role]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [user, load]);

  const placeSyncedForBiz = useRef('');
  const placeEdited = useRef(false);

  useEffect(() => {
    if (user?.role !== 'business') return;
    if (placeEdited.current) return;
    const active = businesses.find((b) => String(b._id) === String(selectedBusinessId));
    if (!active?.address) return;
    // Only seed the form when the selected business changes — not on every poll refresh.
    if (placeSyncedForBiz.current === String(selectedBusinessId)) return;
    placeSyncedForBiz.current = String(selectedBusinessId);
    setPlace({
      address: active.address,
      latitude: active.latitude,
      longitude: active.longitude,
    });
  }, [selectedBusinessId, businesses, user?.role]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!schedule.scheduleStart || !schedule.scheduleEnd) {
      setError('Choose a start and end date/time on the calendar');
      return;
    }
    if (
      !place.address?.trim() ||
      !Number.isFinite(Number(place.latitude)) ||
      !Number.isFinite(Number(place.longitude))
    ) {
      setError('Pick an address from the suggestions (or set the map pin)');
      return;
    }
    if (user.role === 'business') {
      const rate = Number(payRatePerHour);
      if (!Number.isFinite(rate) || rate < MINIMUM_WAGE_PER_HOUR) {
        setError(`Hourly rate must be at least ${formatGbp(MINIMUM_WAGE_PER_HOUR)}`);
        return;
      }
      if (payPreview.hours == null) {
        setError(
          'End time of day must be after start time of day so working hours × days can be calculated'
        );
        return;
      }
    }
    try {
      const body = {
        serviceDetails,
        scheduleStart: new Date(schedule.scheduleStart).toISOString(),
        scheduleEnd: new Date(schedule.scheduleEnd).toISOString(),
        address: place.address.trim(),
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
      };
      if (user.role === 'business') {
        if (!selectedBusinessId) {
          setError('Select a business to post for');
          return;
        }
        body.businessId = selectedBusinessId;
        body.payRatePerHour = Number(payRatePerHour);
      }
      const created = await api('/api/requests', {
        method: 'POST',
        body,
      });
      setMessage(
        created.status === 'unmatched'
          ? 'No available cleaners nearby.'
          : `Nearby cleaners notified (${created.notifiedCleanerCount}).`
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancel(id) {
    setError('');
    try {
      await api(`/api/requests/${id}/cancel`, { method: 'POST' });
      await load();
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
      await load();
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateRequest(id, currentDetails, opts = {}) {
    const rematch = Boolean(opts.rematch);
    const currentPay = opts.pay;
    let nextDetails = currentDetails;
    if (!rematch) {
      const next = window.prompt('Update service details', currentDetails || '');
      if (next == null || next.trim() === '') return;
      nextDetails = next.trim();
    } else {
      nextDetails = serviceDetails || currentDetails;
      if (
        !place.address?.trim() ||
        !Number.isFinite(Number(place.latitude)) ||
        !Number.isFinite(Number(place.longitude))
      ) {
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
        body.address = place.address.trim();
        body.latitude = Number(place.latitude);
        body.longitude = Number(place.longitude);
      }
      const updated = await api(`/api/requests/${id}`, {
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
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title={user.role === 'business' ? 'Business' : 'Client / Business'} />
      <div className="grid grid-client-hub">
        <div className="card stack">
          <h2>Post a cleaning need</h2>
          {user.role === 'business' ? (
            <label>
              Post as business
              <select
                value={selectedBusinessId}
                onChange={(e) => setSelectedBusinessId(e.target.value)}
              >
                {businesses.length === 0 ? (
                  <option value="">No businesses yet</option>
                ) : null}
                {businesses.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <form className="stack" onSubmit={submit}>
            <label>
              What is needed
              <textarea
                value={serviceDetails}
                onChange={(e) => setServiceDetails(e.target.value)}
              />
            </label>
            <label>
              Preferred window
              <DateTimeRangePicker value={schedule} onChange={setSchedule} />
            </label>
            {user.role === 'business' ? (
              <>
                <label>
                  Hourly pay rate (£)
                  <input
                    type="number"
                    min={MINIMUM_WAGE_PER_HOUR}
                    step="0.01"
                    required
                    value={payRatePerHour}
                    onChange={(e) => setPayRatePerHour(e.target.value)}
                  />
                </label>
                <p className="muted">
                  Minimum {formatGbp(MINIMUM_WAGE_PER_HOUR)} / hour
                </p>
                <div className="item">
                  <div className="muted">
                    {payPreview.hoursPerDay != null && payPreview.days != null
                      ? `${payPreview.hoursPerDay}h/day × ${payPreview.days} day${
                          payPreview.days === 1 ? '' : 's'
                        } = ${payPreview.hours} hours`
                      : 'Set start/end times with end later in the day than start'}
                  </div>
                  <div>
                    <strong>Total: {formatGbp(payPreview.total)}</strong>
                    {payPreview.belowMinimum ? (
                      <span className="error"> (below minimum)</span>
                    ) : null}
                  </div>
                </div>
              </>
            ) : null}
            <LocationPicker
              value={place}
              onChange={(next) => {
                placeEdited.current = true;
                setPlace(next);
              }}
            />
            <button type="submit">Submit request</button>
          </form>
          {message ? <div className="success">{message}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="card stack requests-panel">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>My requests</h2>
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
                    Notified: {r.notifiedCleanerCount ?? 0}
                  </span>
                  {r.businessId?.name ? (
                    <span className="muted">{r.businessId.name}</span>
                  ) : null}
                </div>
                <div>{r.serviceDetails}</div>
                <div className="muted">{r.address}</div>
                {r.scheduleStart && r.scheduleEnd ? (
                  <div className="muted">
                    Window: {formatScheduleRange(r.scheduleStart, r.scheduleEnd)}
                  </div>
                ) : r.preferredTime ? (
                  <div className="muted">
                    Preferred: {new Date(r.preferredTime).toLocaleString()}
                  </div>
                ) : null}
                {r.pay ? (
                  <div className="muted">
                    Pay: {formatPaySummary(r.pay)}
                    {isPaid ? ' · PAID' : ''}
                  </div>
                ) : null}
                {r.assignedCleanerId ? (
                  <div className="muted">
                    Assigned: {r.assignedCleanerId.name || r.assignedCleanerId}
                  </div>
                ) : null}
                {r.status === 'open' || r.status === 'unmatched' ? (
                  <div className="row">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        updateRequest(r._id, r.serviceDetails, {
                          rematch: r.status === 'unmatched',
                          pay: r.pay,
                        })
                      }
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
                {r.pay &&
                !isPaid &&
                r.status !== 'open' &&
                r.status !== 'unmatched' &&
                r.status !== 'cancelled' ? (
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
        </div>
      </div>
    </div>
  );
}
