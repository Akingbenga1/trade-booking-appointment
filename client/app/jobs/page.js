'use client';

import { useEffect, useState } from 'react';
import PublicBar from '../../components/PublicBar';
import { StatusBadge } from '../../components/ui';
import { formatScheduleRange } from '../../components/DateTimeRangePicker';
import FilterBar, { matchesQuery } from '../../components/FilterBar';
import { api } from '../../lib/api';
import { describeJob, scheduleKindLabel } from '../../lib/jobHours';
import { formatPaySummary } from '../../lib/jobPay';

function offerMatches(job, { query, who, status }) {
  if (!matchesQuery(query, [job.serviceDetails, job.address, job.businessName])) return false;
  if (who === 'business' && job.postedBy !== 'business') return false;
  if (who === 'personal' && job.postedBy !== 'personal') return false;
  if (status !== 'any' && job.status !== status) return false;
  return true;
}

export default function PublicJobsPage() {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('any');
  const [status, setStatus] = useState('any');

  useEffect(() => {
    api('/api/requests/board')
      .then((rows) => setJobs(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message));
  }, []);

  const visible = jobs.filter((job) => offerMatches(job, { query, who, status }));
  const filtersOn = Boolean(query.trim() || who !== 'any' || status !== 'any');

  return (
    <div className="shell">
      <PublicBar
        title="Job offers"
        subtitle="Every cleaning job posted by a business or a personal client. No sign-in is needed."
      />
      {error ? <div className="error">{error}</div> : null}
      <FilterBar
        query={query}
        onQuery={setQuery}
        placeholder="Search job, address, or business"
        count={visible.length}
        total={jobs.length}
        active={filtersOn}
        onClear={() => {
          setQuery('');
          setWho('any');
          setStatus('any');
        }}
      >
        <select aria-label="Who posted the job" value={who} onChange={(event) => setWho(event.target.value)}>
          <option value="any">Business and personal</option>
          <option value="business">Business</option>
          <option value="personal">Personal client</option>
        </select>
        <select aria-label="Job status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="any">Any status</option>
          <option value="open">Open</option>
          <option value="assigned">Assigned</option>
          <option value="en_route">En route</option>
          <option value="on_site">On site</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="unmatched">Unmatched</option>
        </select>
      </FilterBar>
      <div className="list">
        {jobs.length > 0 && visible.length === 0 ? <p className="muted">No job offers match.</p> : null}
        {jobs.length === 0 && !error ? <p className="muted">No job offers yet.</p> : null}
        {visible.map((job) => {
          const summary =
            job.visitHours != null && (job.jobType !== 'recurring_until' || job.visitCount != null)
              ? describeJob(job)
              : null;
          return (
            <article className="card stack" key={job.id}>
              <div className="row">
                <StatusBadge status={job.status} />
                <span className="job-kind">{job.postedBy === 'business' ? 'Business' : 'Personal client'}</span>
                <span className="job-kind">{scheduleKindLabel(job)}</span>
              </div>
              <h2>{job.serviceDetails}</h2>
              <p>{job.address}</p>
              <p className="muted">Window: {formatScheduleRange(job.scheduleStart, job.scheduleEnd)}</p>
              {summary ? <p>{summary}</p> : null}
              <p className="muted">
                {job.postedBy === 'business' && job.businessName
                  ? `Posted by ${job.businessName}`
                  : 'Posted by a personal client'}
              </p>
              {job.pay?.totalAmount != null ? <p>Pay: {formatPaySummary(job.pay)}</p> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
