'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatScheduleRange } from '../../../components/DateTimeRangePicker';
import { formatGbp } from '../../../lib/jobPay';

function personId(person) {
  if (!person) return '';
  return String(person._id || person);
}

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AgencyStaffPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  const load = useCallback(async (id) => {
    if (!id) {
      setStaff([]);
      return;
    }
    setStaff(await api(`/api/agencies/${id}/staff`));
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    api('/api/agencies/mine')
      .then((list) => {
        setAgencies(list);
        setAgencyId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
      })
      .catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !agencyId) return;
    load(agencyId).catch((err) => setError(err.message));
  }, [user, agencyId, load]);

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Staff" />
      <p className="muted">
        <Link href="/agency">Back to agency home</Link>
        {' · '}
        <Link href="/agency/staff/bulk">Add many staff</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}

      {agencies.length > 1 ? (
        <div className="card stack" style={{ marginBottom: 16 }}>
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

      <div className="card stack">
        <h2>Your staff</h2>
        <p className="muted">
          Each person shows their name, email, and how many jobs they are on. Open a person to see
          their account and each job.
        </p>
        {staff.length === 0 ? (
          <p className="muted">No staff yet. Create an account on the agency home, or add many from a file.</p>
        ) : null}
        <div className="list">
          {staff.map((row) => {
            const person = row.user || {};
            const jobs = row.jobs || [];
            const jobLabel =
              jobs.length === 0 ? 'No jobs' : jobs.length === 1 ? '1 job' : `${jobs.length} jobs`;
            return (
              <details className="item stack" key={String(row.membershipId || personId(person))}>
                <summary className="staff-summary stack">
                  <div className="row">
                    <strong>{person.name || 'Staff'}</strong>
                    <span className="muted">{person.isAvailable ? 'Available' : 'Not available'}</span>
                  </div>
                  <div className="muted">{person.email}</div>
                  <div className="muted">{jobLabel}</div>
                </summary>
                <div className="stack">
                  <div>Role: staff</div>
                  <div>Joined: {when(row.joinedAt) || 'Not recorded'}</div>
                  <div>Account: {person.isDisabled ? 'Disabled' : 'Active'}</div>
                  <div>
                    Password:{' '}
                    {person.mustSetPassword ? 'Still needs to set a password' : 'Password is set'}
                  </div>
                  <div>
                    Location:{' '}
                    {person.currentLocation?.lat != null && person.currentLocation?.lng != null
                      ? `${Number(person.currentLocation.lat).toFixed(5)}, ${Number(person.currentLocation.lng).toFixed(5)}${
                          person.currentLocation.updatedAt
                            ? ` · updated ${when(person.currentLocation.updatedAt)}`
                            : ''
                        }`
                      : 'No location shared'}
                  </div>
                  <div>
                    <strong>Jobs</strong>
                  </div>
                  {jobs.length === 0 ? <div className="muted">Not assigned to a job yet.</div> : null}
                  {jobs.map((job) => (
                    <div className="item stack" key={String(job.requestId)}>
                      <div className="row">
                        <strong>{job.serviceDetails}</strong>
                        <StatusBadge status={job.status} />
                        <StatusBadge status={job.confirmStatus} />
                      </div>
                      {job.address ? <div className="muted">{job.address}</div> : null}
                      {job.scheduleStart && job.scheduleEnd ? (
                        <div className="muted">
                          Job window: {formatScheduleRange(job.scheduleStart, job.scheduleEnd)}
                        </div>
                      ) : null}
                      {job.workStart && job.workEnd ? (
                        <div>Their shift: {formatScheduleRange(job.workStart, job.workEnd)}</div>
                      ) : (
                        <div className="muted">No shift time saved for this person.</div>
                      )}
                      {job.pay ? (
                        <div>
                          {job.pay.durationHours} hours · {formatGbp(job.pay.payRatePerHour)}/hr ={' '}
                          {formatGbp(job.pay.totalAmount)}
                        </div>
                      ) : (
                        <div className="muted">Pay is not set.</div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
