'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../components/ui';
import { formatScheduleRange } from '../../components/DateTimeRangePicker';
import JobMap from '../../components/JobMap';
import { MINIMUM_WAGE_PER_HOUR, formatPaySummary } from '../../lib/jobPay';

const NEXT_STEP = {
  assigned: 'en_route',
  en_route: 'on_site',
  on_site: 'in_progress',
  in_progress: 'completed',
};

export default function AgencyPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [offers, setOffers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [assignForm, setAssignForm] = useState({
    requestId: '',
    staffUserId: '',
    payRatePerHour: String(MINIMUM_WAGE_PER_HOUR),
  });

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  const load = useCallback(async () => {
    const list = await api('/api/agencies/mine');
    setAgencies(list);
    const id = agencyId || (list[0]?._id ? String(list[0]._id) : '');
    if (!agencyId && id) setAgencyId(id);
    if (!id) return;
    const [offerList, jobList, staffList] = await Promise.all([
      api(`/api/agencies/${id}/offers`),
      api(`/api/agencies/${id}/jobs`),
      api(`/api/agencies/${id}/staff`),
    ]);
    setOffers(offerList);
    setJobs(jobList);
    setStaff(staffList);
  }, [agencyId]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [user, load]);

  async function expressInterest(requestId) {
    setError('');
    setMessage('');
    try {
      await api(`/api/requests/${requestId}/agency-interest`, {
        method: 'POST',
        body: { agencyId },
      });
      setMessage('Interest sent. Waiting for the client to pick an agency.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function acceptJob(requestId) {
    setError('');
    setMessage('');
    try {
      await api(`/api/requests/${requestId}/agency-accept`, {
        method: 'POST',
        body: { agencyId },
      });
      setMessage('Job locked to your agency. Assign staff next.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createStaff(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api(`/api/agencies/${agencyId}/staff`, {
        method: 'POST',
        body: staffForm,
      });
      setStaffForm({ name: '', email: '', password: '' });
      setMessage('Staff account created.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function assignStaff(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api(`/api/requests/${assignForm.requestId}/assign-staff`, {
        method: 'POST',
        body: {
          agencyId,
          staffUserId: assignForm.staffUserId,
          payRatePerHour: Number(assignForm.payRatePerHour),
        },
      });
      setMessage('Staff assigned (awaiting their confirm).');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function progress(id, status) {
    setError('');
    try {
      await api(`/api/requests/${id}/progress`, {
        method: 'POST',
        body: { status },
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user || user.mustSetPassword) return null;

  const pendingOffers = offers.filter((o) => o.offer?.status === 'pending');

  return (
    <div className="shell">
      <TopBar title="Cleaning agency" />
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

      <div className="grid grid-2">
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Nearby offers</h2>
            <Link href="/agency/offers">all offers</Link>
          </div>
          <div className="list">
            {pendingOffers.length === 0 ? (
              <p className="muted">No pending agency offers.</p>
            ) : null}
            {pendingOffers.map(({ request, offer }) => (
              <div className="item stack" key={String(request._id)}>
                <div className="row">
                  <StatusBadge status={offer.status} />
                  <span className="muted">{offer.distanceKm} km</span>
                </div>
                <div>{request.serviceDetails}</div>
                <JobMap
                  address={request.address}
                  latitude={request.latitude}
                  longitude={request.longitude}
                />
                {request.scheduleStart && request.scheduleEnd ? (
                  <div className="muted">
                    Window: {formatScheduleRange(request.scheduleStart, request.scheduleEnd)}
                  </div>
                ) : null}
                {request.pay ? (
                  <div className="muted">Company pay: {formatPaySummary(request.pay)}</div>
                ) : null}
                <div className="row">
                  <button type="button" onClick={() => expressInterest(request._id)}>
                    Express interest
                  </button>
                  {String(request.selectedAgencyId) === String(agencyId) ? (
                    <button type="button" onClick={() => acceptJob(request._id)}>
                      Accept / lock job
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card stack">
          <h2>Staff</h2>
          <form className="stack" onSubmit={createStaff}>
            <label>
              Name
              <input
                required
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                value={staffForm.email}
                onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
              />
            </label>
            <label>
              Temp password
              <input
                required
                type="password"
                minLength={8}
                value={staffForm.password}
                onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
              />
            </label>
            <button type="submit">Create staff</button>
          </form>
          <div className="list">
            {staff.map((s) => (
              <div className="item row" key={String(s.membershipId)}>
                <span>{s.user?.name}</span>
                <span className="muted">{s.user?.email}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Assigned jobs</h2>
        <form className="stack" onSubmit={assignStaff} style={{ marginBottom: 12 }}>
          <h3>Assign staff to a job</h3>
          <label>
            Job
            <select
              required
              value={assignForm.requestId}
              onChange={(e) => setAssignForm({ ...assignForm, requestId: e.target.value })}
            >
              <option value="">Select…</option>
              {jobs.map((j) => (
                <option key={j._id} value={j._id}>
                  {j.serviceDetails} ({j.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            Staff
            <select
              required
              value={assignForm.staffUserId}
              onChange={(e) => setAssignForm({ ...assignForm, staffUserId: e.target.value })}
            >
              <option value="">Select…</option>
              {staff.map((s) => (
                <option key={String(s.user?._id)} value={s.user?._id}>
                  {s.user?.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Staff pay £/hr
            <input
              required
              type="number"
              step="0.01"
              min={MINIMUM_WAGE_PER_HOUR}
              value={assignForm.payRatePerHour}
              onChange={(e) =>
                setAssignForm({ ...assignForm, payRatePerHour: e.target.value })
              }
            />
          </label>
          <button type="submit">Assign</button>
        </form>
        <div className="list">
          {jobs.map((r) => (
            <div className="item stack" key={r._id}>
              <StatusBadge status={r.status} />
              <div>{r.serviceDetails}</div>
              {r.assignments?.length ? (
                <div className="muted">
                  Crew:{' '}
                  {r.assignments
                    .map(
                      (a) =>
                        `${a.staffUserId?.name || a.staffUserId} (${a.confirmStatus})`
                    )
                    .join(', ')}
                </div>
              ) : (
                <div className="muted">No staff assigned yet</div>
              )}
              <div className="row">
                <Link href={`/agency/jobs/${r._id}`}>Swap staff</Link>
                {NEXT_STEP[r.status] ? (
                  <button type="button" onClick={() => progress(r._id, NEXT_STEP[r.status])}>
                    Mark {NEXT_STEP[r.status].replaceAll('_', ' ')}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
