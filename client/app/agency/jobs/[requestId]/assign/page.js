'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../../../components/ui';
import { DateTimeRangePicker, formatScheduleRange } from '../../../../../components/DateTimeRangePicker';
import { MINIMUM_WAGE_PER_HOUR, formatGbp } from '../../../../../lib/jobPay';
import { describeJob, HOURS_PER_DAY } from '../../../../../lib/jobHours';
import FilterBar, { matchesQuery } from '../../../../../components/FilterBar';

const OPEN_FOR_CREW = new Set(['assigned', 'en_route', 'on_site', 'in_progress']);

function personId(person) {
  if (!person) return '';
  return String(person._id || person);
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(hours * 100) / 100;
}

function defaultStaffWindow(job) {
  const start = new Date(job.scheduleStart);
  let end = new Date(job.scheduleEnd);
  if (job.jobType === 'recurring_indefinite' || job.jobType === 'recurring_until') {
    const visit = Number(job.visitHours) || 1;
    end = new Date(start.getTime() + visit * 3600000);
  }
  if (!(end.getTime() > start.getTime())) end = new Date(start.getTime() + 3600000);
  return { scheduleStart: start, scheduleEnd: end };
}

function calendarBounds(job) {
  if (!job?.scheduleStart) return {};
  const minDate = new Date(job.scheduleStart);
  if (job.jobType === 'recurring_indefinite') return { minDate };
  if (job.jobType === 'recurring_until' && job.recurrenceUntil) {
    return { minDate, maxDate: new Date(job.recurrenceUntil) };
  }
  return { minDate, maxDate: job.scheduleEnd ? new Date(job.scheduleEnd) : undefined };
}

export default function AssignStaffPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = String(params.requestId || '');
  const user = useRequireRole('cleaning_agency');
  const [job, setJob] = useState(null);
  const [staff, setStaff] = useState([]);
  const [picked, setPicked] = useState({});
  const [rates, setRates] = useState({});
  const [windows, setWindows] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [staffQuery, setStaffQuery] = useState('');

  const load = useCallback(async () => {
    const request = await api(`/api/requests/${requestId}`);
    setJob(request);
    const agencyId = personId(request.assignedAgencyId);
    if (!agencyId) {
      setStaff([]);
      return;
    }
    setStaff(await api(`/api/agencies/${agencyId}/staff`));
  }, [requestId]);

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !requestId) return;
    load().catch((err) => setError(err.message));
  }, [user, requestId, load]);

  const crew = job?.assignments || [];
  const onJob = useMemo(
    () => new Set(crew.map((row) => personId(row.staffUserId))),
    [crew]
  );
  const available = staff.filter((row) => {
    const id = personId(row.user);
    return id && !onJob.has(id);
  });
  const shownAvailable = available.filter((row) =>
    matchesQuery(staffQuery, [row.user?.name, row.user?.email])
  );
  const canEdit = Boolean(job && OPEN_FOR_CREW.has(job.status) && job.assignedAgencyId);

  function rateFor(id) {
    return rates[id] ?? String(MINIMUM_WAGE_PER_HOUR);
  }

  function windowFor(id) {
    return windows[id] || (job ? defaultStaffWindow(job) : null);
  }

  function toggle(id) {
    setPicked((current) => {
      const next = !current[id];
      if (next && job) {
        setWindows((wins) => (wins[id] ? wins : { ...wins, [id]: defaultStaffWindow(job) }));
      }
      return { ...current, [id]: next };
    });
  }

  async function assignSelected(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const chosen = available.filter((row) => picked[personId(row.user)]);
    if (!chosen.length) {
      setError('Choose at least one staff member.');
      return;
    }
    const staffBody = [];
    for (const row of chosen) {
      const id = personId(row.user);
      const window = windowFor(id);
      const hours = hoursBetween(window?.scheduleStart, window?.scheduleEnd);
      if (hours == null) {
        setError('Choose a start and an end on the calendar for every person you selected.');
        return;
      }
      staffBody.push({
        staffUserId: id,
        payRatePerHour: Number(rateFor(id)),
        workStart: new Date(window.scheduleStart).toISOString(),
        workEnd: new Date(window.scheduleEnd).toISOString(),
      });
    }
    const asked = chosen.reduce((sum, row) => {
      const window = windowFor(personId(row.user));
      return sum + (hoursBetween(window?.scheduleStart, window?.scheduleEnd) || 0);
    }, 0);
    if (job.hoursRemaining != null && asked - job.hoursRemaining > 0.0001) {
      const left = Number(job.hoursRemaining);
      const askedLabel = `${asked} hour${asked === 1 ? '' : 's'}`;
      const leftLabel = `${left} hour${left === 1 ? '' : 's'}`;
      setError(`Only ${leftLabel} are left. The people you picked add up to ${askedLabel}.`);
      return;
    }
    const tooLow = staffBody.find(
      (row) => !Number.isFinite(row.payRatePerHour) || row.payRatePerHour < MINIMUM_WAGE_PER_HOUR
    );
    if (tooLow) {
      setError(`Each rate must be at least £${MINIMUM_WAGE_PER_HOUR} per hour.`);
      return;
    }
    setBusy(true);
    try {
      const updated = await api(`/api/requests/${requestId}/assign-staff`, {
        method: 'POST',
        body: { agencyId: personId(job.assignedAgencyId), staff: staffBody },
      });
      setJob(updated);
      setPicked({});
      setMessage(
        chosen.length === 1
          ? '1 staff member assigned. Their pay is shown below.'
          : `${chosen.length} staff assigned. Each person’s pay is shown below.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeStaff(staffUserId) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const updated = await api(`/api/requests/${requestId}/remove-staff`, {
        method: 'POST',
        body: { agencyId: personId(job.assignedAgencyId), staffUserId },
      });
      setJob(updated);
      setMessage('Staff removed. The remaining pay totals are updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Assign staff" />
      <p className="muted">
        <Link href="/agency/offers">Back to all offers</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {!job ? <p className="muted">Loading job…</p> : null}

      {job ? (
        <div className="stack">
          <div className="card stack">
            <div className="row">
              <StatusBadge status={job.status} />
              <strong>{job.serviceDetails}</strong>
            </div>
            <div>{job.address}</div>
            {job.scheduleStart && job.scheduleEnd ? (
              <div className="muted">
                Window: {formatScheduleRange(job.scheduleStart, job.scheduleEnd)}
              </div>
            ) : null}
            {describeJob(job) ? <div>{describeJob(job)}</div> : null}
            <div>
              Hours on this job: {job.hourBudget ?? 'not set'}. Already given out:{' '}
              {job.hoursAllocated ?? 0}. Still free: {job.hoursRemaining ?? '—'}. 1 day ={' '}
              {HOURS_PER_DAY} hours.
            </div>
            {job.jobType === 'recurring_indefinite' ? (
              <div className="muted">
                These hours are for one visit. The same split applies every week, and the job has no
                end date.
              </div>
            ) : null}
          </div>

          <div className="card stack">
            <h2>On this job</h2>
            {crew.length === 0 ? <p className="muted">No staff assigned yet.</p> : null}
            <div className="list">
              {crew.map((row) => {
                const id = personId(row.staffUserId);
                const pay = row.pay;
                return (
                  <div className="item stack" key={id}>
                    <div className="row">
                      <strong>{row.staffUserId?.name || 'Staff'}</strong>
                      <StatusBadge status={row.confirmStatus} />
                    </div>
                    {row.workStart && row.workEnd ? (
                      <div className="muted">Works {formatScheduleRange(row.workStart, row.workEnd)}</div>
                    ) : null}
                    {pay ? (
                      <div>
                        {pay.durationHours} hours · {formatGbp(pay.payRatePerHour)}/hr ={' '}
                        {formatGbp(pay.totalAmount)} if they carry out their share
                      </div>
                    ) : (
                      <div className="muted">Pay is not set for this person.</div>
                    )}
                    {canEdit ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => removeStaff(id)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div>
              Crew total if everyone carries out the job: {formatGbp(job.crewPayTotal || 0)}
            </div>
          </div>

          {canEdit ? (
            <form className="card stack" onSubmit={assignSelected}>
              <h2>Add staff</h2>
              <p className="muted">
                Tick a person, then choose their start and end on the calendar. Set the clock times
                under the month. The shares cannot add up to more than the hours still free.
                {job.jobType === 'recurring_indefinite' || job.jobType === 'recurring_until'
                  ? ' For a weekly job, pick one visit. That time repeats each week.'
                  : ' The time must sit inside the job window.'}
              </p>
              {available.length === 0 ? (
                <p className="muted">
                  No more staff to add.{' '}
                  <Link href="/agency">Create a staff account on the agency home.</Link>
                </p>
              ) : (
                <FilterBar
                  query={staffQuery}
                  onQuery={setStaffQuery}
                  placeholder="Search staff name or email"
                  count={shownAvailable.length}
                  total={available.length}
                  active={Boolean(staffQuery.trim())}
                  onClear={() => setStaffQuery('')}
                />
              )}
              {available.length > 0 && shownAvailable.length === 0 ? (
                <p className="muted">No staff match that name.</p>
              ) : null}
              <div className="list">
                {shownAvailable.map((row) => {
                  const id = personId(row.user);
                  const chosenWindow = picked[id] ? windowFor(id) : null;
                  const share = chosenWindow
                    ? hoursBetween(chosenWindow.scheduleStart, chosenWindow.scheduleEnd)
                    : null;
                  const rate = Number(rateFor(id));
                  const pay =
                    share != null && Number.isFinite(rate)
                      ? Math.round(rate * share * 100) / 100
                      : null;
                  const bounds = calendarBounds(job);
                  return (
                    <div className="item stack" key={id}>
                      <label className="row" style={{ color: 'inherit' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(picked[id])}
                          onChange={() => toggle(id)}
                          style={{ width: 'auto' }}
                        />
                        <span>
                          {row.user?.name || 'Staff'}
                          {row.user?.email ? ` · ${row.user.email}` : ''}
                        </span>
                      </label>
                      {picked[id] && chosenWindow ? (
                        <DateTimeRangePicker
                          value={chosenWindow}
                          minDate={bounds.minDate}
                          maxDate={bounds.maxDate}
                          onChange={(next) =>
                            setWindows((current) => ({ ...current, [id]: next }))
                          }
                        />
                      ) : null}
                      <label>
                        Pay £/hr
                        <input
                          type="number"
                          step="0.01"
                          min={MINIMUM_WAGE_PER_HOUR}
                          value={rateFor(id)}
                          onChange={(e) =>
                            setRates((current) => ({ ...current, [id]: e.target.value }))
                          }
                        />
                      </label>
                      <div className="muted">
                        {share == null
                          ? 'Tick this person to choose their dates and times.'
                          : `${share} hours. Will be paid ${formatGbp(pay)} if they carry out that share.`}
                        {Number.isFinite(rate) && rate < MINIMUM_WAGE_PER_HOUR
                          ? ` Rate must be at least £${MINIMUM_WAGE_PER_HOUR} per hour.`
                          : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
              {available.length ? (
                <button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Assign selected staff'}
                </button>
              ) : null}
            </form>
          ) : (
            <p className="muted">Staff can no longer be changed on this job.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
