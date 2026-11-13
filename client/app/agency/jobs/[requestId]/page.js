'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../../components/ui';
import { formatScheduleRange } from '../../../../components/DateTimeRangePicker';
import { MINIMUM_WAGE_PER_HOUR } from '../../../../lib/jobPay';

const SWAPPABLE = new Set(['assigned', 'en_route', 'on_site', 'in_progress']);

function personId(person) {
  if (!person) return '';
  return String(person._id || person);
}

export default function SwapStaffPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = String(params.requestId || '');
  const user = useRequireRole('cleaning_agency');
  const [job, setJob] = useState(null);
  const [staff, setStaff] = useState([]);
  const [staffA, setStaffA] = useState('');
  const [staffB, setStaffB] = useState('');
  const [payRatePerHour, setPayRatePerHour] = useState(String(MINIMUM_WAGE_PER_HOUR));
  const [allocatedHours, setAllocatedHours] = useState('1');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const request = await api(`/api/requests/${requestId}`);
    setJob(request);
    const agencyId = personId(request.assignedAgencyId);
    if (!agencyId) {
      setStaff([]);
      return;
    }
    const list = await api(`/api/agencies/${agencyId}/staff`);
    setStaff(list);
  }, [requestId]);

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !requestId) return;
    load().catch((err) => setError(err.message));
  }, [user, requestId, load]);

  const crew = useMemo(
    () => (job?.assignments || []).filter((row) => personId(row.staffUserId)),
    [job]
  );

  const replacements = useMemo(() => {
    const onJob = new Set(crew.map((row) => personId(row.staffUserId)));
    return staff.filter((row) => {
      const id = personId(row.user);
      return id && id !== staffA && !onJob.has(id);
    });
  }, [staff, crew, staffA]);

  useEffect(() => {
    if (!staffA && crew[0]) setStaffA(personId(crew[0].staffUserId));
  }, [crew, staffA]);

  useEffect(() => {
    const current = crew.find((row) => personId(row.staffUserId) === staffA);
    if (current?.pay?.durationHours) setAllocatedHours(String(current.pay.durationHours));
  }, [crew, staffA]);

  const canSwap = Boolean(job && SWAPPABLE.has(job.status) && job.assignedAgencyId);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!staffA || !staffB) {
      setError('Choose staff A and staff B.');
      return;
    }
    setLoading(true);
    try {
      const updated = await api(`/api/requests/${requestId}/reassign-staff`, {
        method: 'POST',
        body: {
          agencyId: personId(job.assignedAgencyId),
          fromStaffUserId: staffA,
          toStaffUserId: staffB,
          payRatePerHour: Number(payRatePerHour),
          allocatedHours: Number(allocatedHours),
        },
      });
      setJob(updated);
      setStaffA('');
      setStaffB('');
      setMessage('Staff A was replaced by staff B. Staff B still needs to confirm.');
      const agencyId = personId(updated.assignedAgencyId);
      if (agencyId) setStaff(await api(`/api/agencies/${agencyId}/staff`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Swap staff" />
      <p className="muted">
        <Link href="/agency">Back to agency home</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      {!job ? <p className="muted">Loading job…</p> : null}

      {job ? (
        <div className="card stack">
          <div className="row">
            <StatusBadge status={job.status} />
            <strong>{job.serviceDetails}</strong>
          </div>
          <div className="muted">{job.address}</div>
          {job.scheduleStart && job.scheduleEnd ? (
            <div className="muted">
              Window: {formatScheduleRange(job.scheduleStart, job.scheduleEnd)}
            </div>
          ) : null}
          <p className="muted">
            Swap is available at every stage until the job is completed or cancelled.
          </p>

          {crew.length ? (
            <div className="muted">
              On this job:{' '}
              {crew
                .map(
                  (row) =>
                    `${row.staffUserId?.name || 'Staff'} (${row.confirmStatus})`
                )
                .join(', ')}
            </div>
          ) : (
            <div className="muted">No staff are on this job yet.</div>
          )}

          {canSwap && crew.length ? (
            <form className="stack" onSubmit={onSubmit}>
              <label>
                Staff A (leave the job)
                <select value={staffA} onChange={(e) => setStaffA(e.target.value)} required>
                  <option value="">Select…</option>
                  {crew.map((row) => {
                    const id = personId(row.staffUserId);
                    return (
                      <option key={id} value={id}>
                        {row.staffUserId?.name || 'Staff'} ({row.confirmStatus})
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                Staff B (take the job)
                <select value={staffB} onChange={(e) => setStaffB(e.target.value)} required>
                  <option value="">Select…</option>
                  {replacements.map((row) => {
                    const id = personId(row.user);
                    return (
                      <option key={id} value={id}>
                        {row.user?.name || row.user?.email}
                      </option>
                    );
                  })}
                </select>
              </label>
              {staff.length > 0 && replacements.length === 0 ? (
                <p className="muted">
                  Add another staff account on the agency home before swapping.
                </p>
              ) : null}
              <label>
                Hours staff B will work
                <input
                  required
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={allocatedHours}
                  onChange={(e) => setAllocatedHours(e.target.value)}
                />
              </label>
              <p className="muted">1 day is 8 hours. Staff B takes this share of the job.</p>
              <label>
                Staff B pay £/hr
                <input
                  required
                  type="number"
                  step="0.01"
                  min={MINIMUM_WAGE_PER_HOUR}
                  value={payRatePerHour}
                  onChange={(e) => setPayRatePerHour(e.target.value)}
                />
              </label>
              <button type="submit" disabled={loading || !staffB}>
                {loading ? 'Swapping…' : 'Swap staff A for staff B'}
              </button>
            </form>
          ) : null}

          {job && !SWAPPABLE.has(job.status) ? (
            <p className="muted">This job is finished, so staff can no longer be swapped.</p>
          ) : null}
          {job && SWAPPABLE.has(job.status) && !job.assignedAgencyId ? (
            <p className="muted">This job is not locked to your agency yet.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
