'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { TopBar, useRequireRole } from '../../components/ui';
import { DateTimeRangePicker, defaultScheduleRange } from '../../components/DateTimeRangePicker';
import LocationPicker from '../../components/LocationPicker';
import { MINIMUM_WAGE_PER_HOUR, formatGbp } from '../../lib/jobPay';
import { previewBusinessJob } from '../../lib/jobHours';
import MyRequests from '../../components/MyRequests';
import { hasPlacePin } from '../../lib/place';

const DEFAULT_PLACE = {
  address: '',
  latitude: null,
  longitude: null,
};

const JOB_TYPES = [
  ['fixed', 'Days and hours'],
  ['recurring_indefinite', 'Repeats with no end'],
  ['recurring_until', 'Repeats until a date'],
];

function tomorrowAtNine() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  const [jobType, setJobType] = useState('fixed');
  const [durationDays, setDurationDays] = useState('1');
  const [durationExtraHours, setDurationExtraHours] = useState('0');
  const [startsAt, setStartsAt] = useState(tomorrowAtNine);
  const [untilDate, setUntilDate] = useState('');

  const businessPreview = useMemo(
    () =>
      previewBusinessJob({
        jobType,
        durationDays,
        durationExtraHours,
        startsAt,
        untilDate,
        payRatePerHour,
      }),
    [jobType, durationDays, durationExtraHours, startsAt, untilDate, payRatePerHour]
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
    if (user.role !== 'business' && (!schedule.scheduleStart || !schedule.scheduleEnd)) {
      setError('Choose a start and end date/time on the calendar');
      return;
    }
    if (!hasPlacePin(place)) {
      setError('Pick an address from the suggestions (or set the map pin)');
      return;
    }
    if (user.role === 'business') {
      const rate = Number(payRatePerHour);
      if (!Number.isFinite(rate) || rate < MINIMUM_WAGE_PER_HOUR) {
        setError(`Hourly rate must be at least ${formatGbp(MINIMUM_WAGE_PER_HOUR)}`);
        return;
      }
      if (businessPreview.error) {
        setError(businessPreview.error);
        return;
      }
    }
    try {
      const body = {
        serviceDetails,
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
        body.jobType = jobType;
        body.durationDays = Number(durationDays);
        body.durationExtraHours = Number(durationExtraHours || 0);
        body.scheduleStart = new Date(startsAt).toISOString();
        if (jobType === 'recurring_until') body.recurrenceUntil = untilDate;
      } else {
        body.scheduleStart = new Date(schedule.scheduleStart).toISOString();
        body.scheduleEnd = new Date(schedule.scheduleEnd).toISOString();
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
            {user.role === 'business' ? (
              <>
                <label>
                  Job type
                  <select value={jobType} onChange={(e) => setJobType(e.target.value)}>
                    {JOB_TYPES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  {jobType === 'fixed'
                    ? 'One job. Set how many days and extra hours it needs. 1 day is 8 hours.'
                    : jobType === 'recurring_indefinite'
                      ? 'The same days and hours repeat every week, with no end date.'
                      : 'The same days and hours repeat every week until the date you choose.'}
                </p>
                <div className="row">
                  <label>
                    Days
                    <input
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={durationDays}
                      onChange={(e) => setDurationDays(e.target.value)}
                    />
                  </label>
                  <label>
                    Extra hours
                    <input
                      type="number"
                      min="0"
                      max="7.99"
                      step="0.5"
                      required
                      value={durationExtraHours}
                      onChange={(e) => setDurationExtraHours(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  First visit starts
                  <input
                    type="datetime-local"
                    required
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </label>
                {jobType === 'recurring_until' ? (
                  <label>
                    Repeats until
                    <input
                      type="date"
                      required
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                    />
                  </label>
                ) : null}
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
                <p className="muted">Minimum {formatGbp(MINIMUM_WAGE_PER_HOUR)} / hour</p>
                <div className="item">
                  {businessPreview.error ? (
                    <div className="muted">{businessPreview.error}</div>
                  ) : (
                    <>
                      <div className="muted">
                        {jobType === 'fixed'
                          ? `${businessPreview.totalHours} hours in total.`
                          : jobType === 'recurring_indefinite'
                            ? `Each visit is ${businessPreview.visitHours} hours. It repeats every week with no end date.`
                            : `Each visit is ${businessPreview.visitHours} hours. ${businessPreview.visitCount} weekly visits, ${businessPreview.totalHours} hours in total.`}
                      </div>
                      <div>
                        <strong>
                          {jobType === 'recurring_indefinite' ? 'Per visit: ' : 'Total: '}
                          {formatGbp(businessPreview.total)}
                        </strong>
                        {businessPreview.belowMinimum ? (
                          <span className="error"> (below minimum)</span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <label>
                Preferred window
                <DateTimeRangePicker value={schedule} onChange={setSchedule} />
              </label>
            )}
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

        <div className="card stack requests-panel" aria-label="Requests panel">
          {user.role === 'business' ? null : (
            <MyRequests
              requests={requests}
              user={user}
              onReload={load}
              setError={setError}
              setMessage={setMessage}
              rematchDraft={{ serviceDetails, place }}
            />
          )}
        </div>
      </div>
    </div>
  );
}


