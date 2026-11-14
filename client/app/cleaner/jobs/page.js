'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatScheduleRange } from '../../../components/DateTimeRangePicker';
import { formatGbp, formatPaySummary } from '../../../lib/jobPay';
import { describeJob } from '../../../lib/jobHours';

const ACTIVE = new Set(['assigned', 'en_route', 'on_site', 'in_progress']);

const NEXT_STAGE = {
  assigned: ['en_route', 'On the way'],
  en_route: ['on_site', 'On site'],
  on_site: ['in_progress', 'Start cleaning'],
  in_progress: ['completed', 'Mark completed'],
};

const STAGE = {
  assigned: 'Assigned. Cleaning has not started.',
  en_route: 'On the way. Cleaning has not started.',
  on_site: 'On site. Cleaning is not finished.',
  in_progress: 'Cleaning is in progress.',
  completed: 'Completed.',
};

function personId(value) {
  if (!value) return '';
  return String(value._id || value);
}

function ownerLine(job) {
  if (job.businessId?.name) return `Job owner: ${job.businessId.name} (business)`;
  if (job.clientId?.name) return `Job owner: ${job.clientId.name} (personal client)`;
  return 'Job owner: not listed';
}

function customerPayLine(job) {
  if (!job.businessId) return 'Customer payment: personal job, no company charge.';
  if (!job.pay) return 'Customer payment: not set up yet.';
  const status = job.pay.paymentStatus || 'unpaid';
  const summary = formatPaySummary(job.pay);
  if (status === 'paid') return `Customer payment: paid. ${summary}`;
  if (status === 'pending') return `Customer payment: waiting for the card payment to finish. ${summary}`;
  if (status === 'failed') return `Customer payment: failed. ${summary}`;
  return `Customer payment: ${status}. ${summary}`;
}

function myPay(job, userId) {
  const row = (job.assignments || []).find(
    (item) => personId(item.staffUserId) === String(userId)
  );
  return row?.pay || null;
}

function staffPayLine(pay) {
  if (!pay) return 'Your pay: not set yet.';
  return `Your pay: ${formatGbp(pay.payRatePerHour)}/hr · ${pay.durationHours} hours · ${formatGbp(pay.totalAmount)}`;
}

function cleanerPayLine(job) {
  if (!job.pay) return 'Your pay: not set for this job.';
  return `Your pay: ${job.pay.paymentStatus || 'unpaid'}. ${formatPaySummary(job.pay)}`;
}

function JobCard({ job, isStaff, userId, busy, onProgress, onStaffRespond }) {
  const next = NEXT_STAGE[job.status];
  const confirmStatus = job.myAssignment?.confirmStatus;
  const pay = isStaff ? myPay(job, userId) : null;
  const schedule = describeJob(job);
  return (
    <div className="item stack">
      <div className="row">
        <StatusBadge status={job.status} />
        {isStaff && confirmStatus ? <StatusBadge status={confirmStatus} /> : null}
      </div>
      <strong>{job.serviceDetails}</strong>
      <div>{job.address}</div>
      {job.scheduleStart && job.scheduleEnd ? (
        <div className="muted">
          Window: {formatScheduleRange(job.scheduleStart, job.scheduleEnd)}
        </div>
      ) : null}
      {schedule ? <div className="muted">{schedule}</div> : null}
      <div>{ownerLine(job)}</div>
      <div>{STAGE[job.status] || job.status}</div>
      {isStaff ? <div>{staffPayLine(pay)}</div> : <div>{cleanerPayLine(job)}</div>}
      {isStaff ? <div>{customerPayLine(job)}</div> : null}
      {isStaff && confirmStatus === 'pending' ? (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => onStaffRespond(job._id, 'confirm')}>
            Confirm assignment
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => onStaffRespond(job._id, 'decline')}
          >
            Decline
          </button>
        </div>
      ) : null}
      {isStaff && confirmStatus === 'confirmed' && ACTIVE.has(job.status) ? (
        <p className="muted">Your agency updates this stage. You are confirmed for the hours above.</p>
      ) : null}
      {!isStaff && next ? (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => onProgress(job._id, next[0])}>
            {next[1]}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, hint, jobs, isStaff, userId, busy, onProgress, onStaffRespond }) {
  return (
    <div className="card stack">
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <div className="list">
        {jobs.length === 0 ? <p className="muted">None.</p> : null}
        {jobs.map((job) => (
          <JobCard
            key={String(job._id)}
            job={job}
            isStaff={isStaff}
            userId={userId}
            busy={busy}
            onProgress={onProgress}
            onStaffRespond={onStaffRespond}
          />
        ))}
      </div>
    </div>
  );
}

export default function AssignedJobsPage() {
  const user = useRequireRole(['cleaner', 'agency_staff']);
  const isStaff = user?.role === 'agency_staff';
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setJobs(await api('/api/requests/assigned'));
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch((err) => setError(err.message));
  }, [user, load]);

  async function run(work, success) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await work();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function progress(id, status) {
    const label = NEXT_STAGE[Object.keys(NEXT_STAGE).find((key) => NEXT_STAGE[key][0] === status)]?.[1];
    return run(
      () => api(`/api/requests/${id}/progress`, { method: 'POST', body: { status } }),
      label ? `Updated: ${label}.` : 'Job updated.'
    );
  }

  function staffRespond(id, action) {
    return run(
      () => api(`/api/requests/${id}/staff-respond`, { method: 'POST', body: { action } }),
      action === 'confirm' ? 'You confirmed this job.' : 'You declined this job.'
    );
  }

  if (!user) return null;

  const current = jobs.filter((job) => ACTIVE.has(job.status));
  const past = jobs.filter((job) => job.status === 'completed');

  return (
    <div className="shell">
      <TopBar title="Assigned jobs" />
      <p className="muted">
        <Link href="/cleaner">Back to home</Link>
        {' · '}
        {isStaff ? 'Agency staff' : 'Independent cleaner'}
      </p>
      {message ? <div className="success">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}
      <div className="stack" style={{ marginTop: 16 }}>
        <Panel
          title="Current jobs"
          hint={
            isStaff
              ? 'Jobs your agency has given you. Confirm or decline while a job is waiting for your reply.'
              : 'Jobs you accepted. Move each job to the next stage as you work.'
          }
          jobs={current}
          isStaff={isStaff}
          userId={user.id}
          busy={busy}
          onProgress={progress}
          onStaffRespond={staffRespond}
        />
        <Panel
          title="Past jobs"
          hint="Jobs that are finished."
          jobs={past}
          isStaff={isStaff}
          userId={user.id}
          busy={busy}
          onProgress={progress}
          onStaffRespond={staffRespond}
        />
      </div>
    </div>
  );
}
