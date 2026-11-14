'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiForm } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatGbp } from '../../../lib/jobPay';

export default function UploadReceiptPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState('');
  const [jobs, setJobs] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [preferredAgencyId, setPreferredAgencyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    setPreferredAgencyId(new URLSearchParams(window.location.search).get('agencyId') || '');
  }, []);

  const loadJobs = useCallback(async (id) => {
    if (!id) {
      setJobs([]);
      return;
    }
    const rows = await api(`/api/payments/receipts/jobs?businessId=${encodeURIComponent(id)}`);
    setJobs(rows);
    setAgencyId((current) => {
      if (preferredAgencyId && rows.some((row) => String(row.agencyId) === preferredAgencyId)) {
        return preferredAgencyId;
      }
      if (current && rows.some((row) => String(row.agencyId) === current)) return current;
      return rows[0]?.agencyId ? String(rows[0].agencyId) : '';
    });
  }, [preferredAgencyId]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    api('/api/businesses')
      .then((list) => {
        setBusinesses(list);
        setBusinessId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
      })
      .catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!user || !businessId) return;
    loadJobs(businessId).catch((err) => setError(err.message));
  }, [user, businessId, loadJobs]);

  const agencies = [];
  const seen = new Set();
  for (const job of jobs) {
    const id = String(job.agencyId);
    if (seen.has(id)) continue;
    seen.add(id);
    agencies.push({ id, name: job.agencyName });
  }
  const visible = jobs.filter((job) => String(job.agencyId) === String(agencyId));

  async function upload(requestId, file) {
    if (!file) return;
    setError('');
    setMessage('');
    setBusyId(requestId);
    try {
      const body = new FormData();
      body.append('requestId', requestId);
      body.append('agencyId', agencyId);
      body.append('file', file);
      await apiForm('/api/payments/receipts', body);
      setMessage('Receipt uploaded. The agency can open it and mark the job paid.');
      await loadJobs(businessId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Upload receipt" />
      <p className="muted">
        <Link href="/client">Back to business home</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="card stack">
        <h2>Send proof of payment</h2>
        <p className="muted">
          Use this when you paid an agency outside the app. Choose the agency, then upload a PDF
          or an image for that job. The file must be 5 MB or smaller.
        </p>
        {businesses.length > 1 ? (
          <label>
            Business
            <select value={businessId} onChange={(event) => setBusinessId(event.target.value)}>
              {businesses.map((business) => (
                <option key={business._id} value={business._id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Agency
          <select value={agencyId} onChange={(event) => setAgencyId(event.target.value)}>
            {agencies.length === 0 ? <option value="">No agency has a job yet</option> : null}
            {agencies.map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name}
              </option>
            ))}
          </select>
        </label>
        <div className="list">
          {visible.length === 0 ? <p className="muted">No jobs for this agency.</p> : null}
          {visible.map((job) => (
            <div className="item stack" key={String(job.requestId)}>
              <div className="row">
                <strong>{job.serviceDetails}</strong>
                <StatusBadge status={job.paymentStatus === 'none' ? 'unpaid' : job.paymentStatus} />
              </div>
              <div>{job.address}</div>
              <div className="muted">
                {job.amount == null ? 'No amount' : formatGbp(job.amount)} · {job.agencyName}
              </div>
              {job.receipt ? (
                <div className="muted">Receipt on file: {job.receipt.originalName}</div>
              ) : null}
              {job.paymentStatus === 'paid' ? (
                <p className="muted">This job is already marked paid.</p>
              ) : (
                <label>
                  {job.receipt ? 'Replace receipt' : 'Receipt file'}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                    disabled={busyId === String(job.requestId)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      upload(String(job.requestId), file);
                    }}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
