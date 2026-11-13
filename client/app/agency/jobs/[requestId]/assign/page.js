'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../../../components/ui';
import { formatScheduleRange } from '../../../../../components/DateTimeRangePicker';
import {
  MINIMUM_WAGE_PER_HOUR,
  computePayPreview,
  durationHoursFromSchedule,
  formatGbp,
} from '../../../../../lib/jobPay';

const OPEN_FOR_CREW = new Set(['assigned', 'en_route', 'on_site', 'in_progress']);

function personId(person) {
  if (!person) return '';
  return String(person._id || person);
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
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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

  const hours = job ? durationHoursFromSchedule(job.scheduleStart, job.scheduleEnd) : null;
  const crew = job?.assignments || [];
  const onJob = useMemo(
    () => new Set(crew.map((row) => personId(row.staffUserId))),
    [crew]
  );
  const available = staff.filter((row) => {
    const id = personId(row.user);
    return id && !onJob.has(id);
  });
  const canEdit = Boolean(job && OPEN_FOR_CREW.has(job.status) && job.assignedAgencyId);

  function rateFor(id) {
    return rates[id] ?? String(MINIMUM_WAGE_PER_HOUR);
  }

  function toggle(id) {
    setPicked((current) => ({ ...current, [id]: !current[id] }));
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
    const staffBody = chosen.map((row) => {
      const id = personId(row.user);
      return { staffUserId: id, payRatePerHour: Number(rateFor(id)) };
    });
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
            <div>
              Job length: {hours == null ? 'not set' : `${hours} hours`}. Each person is paid their
              own hourly rate times those hours if they carry out the job.
            </div>
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
                    {pay ? (
                      <div>
                        {formatGbp(pay.payRatePerHour)}/hr × {pay.durationHours}h ={' '}
                        {formatGbp(pay.totalAmount)} if they carry out the job
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
              <p className="muted">Choose one person or several. Set a rate for each.</p>
              {available.length === 0 ? (
                <p className="muted">
                  No more staff to add.{' '}
                  <Link href="/agency">Create a staff account on the agency home.</Link>
                </p>
              ) : null}
              <div className="list">
                {available.map((row) => {
                  const id = personId(row.user);
                  const preview = computePayPreview(rateFor(id), job.scheduleStart, job.scheduleEnd);
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
                        {preview.total == null
                          ? 'Enter a rate to see their pay.'
                          : `Will be paid ${formatGbp(preview.total)} if they carry out the job.`}
                        {preview.belowMinimum
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
