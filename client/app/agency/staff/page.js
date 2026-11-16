'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatGbp } from '../../../lib/jobPay';
import FilterBar, { matchesQuery } from '../../../components/FilterBar';

function staffVisible(row, query, availability, jobFilter) {
  const person = row.user || {};
  const jobs = row.jobs || [];
  if (!matchesQuery(query, [person.name, person.email])) return false;
  if (availability === 'available' && !person.isAvailable) return false;
  if (availability === 'away' && person.isAvailable) return false;
  if (jobFilter === 'on' && jobs.length === 0) return false;
  if (jobFilter === 'off' && jobs.length > 0) return false;
  return true;
}

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

function rangeLabel(start, end) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  const left = new Date(start);
  const right = new Date(end);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return '';
  return `${left.toLocaleString('en-GB', opts)} – ${right.toLocaleString('en-GB', opts)}`;
}

export default function AgencyStaffPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [staff, setStaff] = useState([]);
  const [openId, setOpenId] = useState('');
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState('any');
  const [jobFilter, setJobFilter] = useState('any');
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

  const visibleStaff = staff.filter((row) => staffVisible(row, query, availability, jobFilter));

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
        <p className="muted">Open a person to see their account and the jobs they are on.</p>
        {staff.length === 0 ? (
          <p className="muted">No staff yet. Create an account on the agency home, or add many from a file.</p>
        ) : null}
        <FilterBar
          query={query}
          onQuery={setQuery}
          placeholder="Search name or email"
          count={visibleStaff.length}
          total={staff.length}
          active={Boolean(query.trim() || availability !== 'any' || jobFilter !== 'any')}
          onClear={() => {
            setQuery('');
            setAvailability('any');
            setJobFilter('any');
          }}
        >
          <select aria-label="Availability" value={availability} onChange={(event) => setAvailability(event.target.value)}>
            <option value="any">Any availability</option>
            <option value="available">Available</option>
            <option value="away">Not available</option>
          </select>
          <select aria-label="Jobs" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)}>
            <option value="any">Any jobs</option>
            <option value="on">On a job</option>
            <option value="off">No jobs</option>
          </select>
        </FilterBar>
        <div className="staff-list">
          {staff.length > 0 && visibleStaff.length === 0 ? <p className="muted">No staff match.</p> : null}
          {visibleStaff.map((row) => {
            const person = row.user || {};
            const jobs = row.jobs || [];
            const id = String(row.membershipId || personId(person));
            const open = openId === id;
            const name = person.name || 'Staff';
            const jobLabel =
              jobs.length === 0 ? 'No jobs' : jobs.length === 1 ? '1 job' : `${jobs.length} jobs`;
            const location =
              person.currentLocation?.lat != null && person.currentLocation?.lng != null
                ? `${Number(person.currentLocation.lat).toFixed(5)}, ${Number(person.currentLocation.lng).toFixed(5)}`
                : '';
            return (
              <article className={open ? 'staff-person open' : 'staff-person'} key={id}>
                <button
                  type="button"
                  className="staff-head"
                  aria-expanded={open}
                  aria-controls={`staff-panel-${id}`}
                  onClick={() => setOpenId(open ? '' : id)}
                >
                  <span className="staff-avatar" aria-hidden="true">
                    {name.trim().charAt(0).toUpperCase() || 'S'}
                  </span>
                  <span className="staff-id">
                    <span className="staff-name">{name}</span>
                    <span className="muted">{person.email}</span>
                  </span>
                  <span className="staff-meta">
                    <span className={person.isAvailable ? 'staff-pill ok' : 'staff-pill'}>
                      {person.isAvailable ? 'Available' : 'Not available'}
                    </span>
                    <span className="staff-count">{jobLabel}</span>
                    <span className="staff-chevron" aria-hidden="true" />
                  </span>
                </button>
                {open ? (
                  <div className="staff-panel" id={`staff-panel-${id}`}>
                    <section>
                      <h3>Account</h3>
                      <dl className="staff-facts">
                        <div>
                          <dt>Role</dt>
                          <dd>Staff</dd>
                        </div>
                        <div>
                          <dt>Joined</dt>
                          <dd>{when(row.joinedAt) || 'Not recorded'}</dd>
                        </div>
                        <div>
                          <dt>Status</dt>
                          <dd>{person.isDisabled ? 'Disabled' : 'Active'}</dd>
                        </div>
                        <div>
                          <dt>Password</dt>
                          <dd>{person.mustSetPassword ? 'Still needs to be set' : 'Set'}</dd>
                        </div>
                        <div>
                          <dt>Location</dt>
                          <dd>{location || 'No location shared'}</dd>
                        </div>
                        {location && person.currentLocation?.updatedAt ? (
                          <div>
                            <dt>Last seen</dt>
                            <dd>{when(person.currentLocation.updatedAt)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </section>
                    <section>
                      <h3>Jobs</h3>
                      {jobs.length === 0 ? <p className="muted">Not assigned to a job yet.</p> : null}
                      <div className="staff-jobs">
                        {jobs.map((job) => (
                          <div className="staff-job" key={String(job.requestId)}>
                            <div className="row">
                              <strong>{job.serviceDetails}</strong>
                              <StatusBadge status={job.status} />
                              <StatusBadge status={job.confirmStatus} />
                            </div>
                            <dl className="staff-facts">
                              {job.address ? (
                                <div>
                                  <dt>Address</dt>
                                  <dd>{job.address}</dd>
                                </div>
                              ) : null}
                              {job.scheduleStart && job.scheduleEnd ? (
                                <div>
                                  <dt>Job window</dt>
                                  <dd>{rangeLabel(job.scheduleStart, job.scheduleEnd)}</dd>
                                </div>
                              ) : null}
                              <div>
                                <dt>Their shift</dt>
                                <dd>
                                  {job.workStart && job.workEnd
                                    ? rangeLabel(job.workStart, job.workEnd)
                                    : 'No shift time saved'}
                                </dd>
                              </div>
                              <div>
                                <dt>Pay</dt>
                                <dd>
                                  {job.pay
                                    ? `${job.pay.durationHours} hours · ${formatGbp(job.pay.payRatePerHour)}/hr · ${formatGbp(job.pay.totalAmount)}`
                                    : 'Not set'}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
