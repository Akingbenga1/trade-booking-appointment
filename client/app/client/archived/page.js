'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatScheduleRange } from '../../../components/DateTimeRangePicker';
import { formatPaySummary } from '../../../lib/jobPay';

export default function ArchivedJobsPage() {
  const router = useRouter();
  const user = useRequireRole(['client', 'business']);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) {
      router.replace('/auth/set-password');
    }
  }, [user, router]);

  const load = useCallback(async () => {
    const list = await api('/api/requests/archived');
    setRequests(list);
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((e) => setError(e.message));
  }, [user, load]);

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title={user.role === 'business' ? 'Business' : 'Client / Business'} />
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <h2>Archived jobs</h2>
            <p className="muted">
              Paid jobs you hid from My requests. They stay available to cleaners if still active.
            </p>
          </div>
          <Link href="/client" className="muted">
            ← Back to requests
          </Link>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="list">
          {requests.length === 0 ? <p className="muted">No archived jobs.</p> : null}
          {requests.map((r) => (
            <div className="item stack" key={r._id}>
              <div className="row">
                <StatusBadge status={r.status} />
                {r.businessId?.name ? (
                  <span className="muted">{r.businessId.name}</span>
                ) : null}
                {r.archivedAt ? (
                  <span className="muted">
                    Archived {new Date(r.archivedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div>{r.serviceDetails}</div>
              <div className="muted">{r.address}</div>
              {r.scheduleStart && r.scheduleEnd ? (
                <div className="muted">
                  Window: {formatScheduleRange(r.scheduleStart, r.scheduleEnd)}
                </div>
              ) : null}
              {r.pay ? (
                <div className="muted">
                  Pay: {formatPaySummary(r.pay)}
                  {r.pay.paymentStatus === 'paid' ? ' · PAID' : ''}
                </div>
              ) : null}
              {r.assignedCleanerId ? (
                <div className="muted">
                  Assigned: {r.assignedCleanerId.name || r.assignedCleanerId}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
