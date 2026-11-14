'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiForm } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatGbp, jobStamp } from '../../../lib/jobPay';

function payeeKey(job) {
  if (job.agencyId) return `agency:${job.agencyId}`;
  if (job.cleanerId) return `cleaner:${job.cleanerId}`;
  return '';
}

function payeeName(job) {
  return job.agencyId ? job.agencyName : job.cleanerName;
}

export default function UploadReceiptPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedPayee, setSelectedPayee] = useState('');
  const [preferredPayee, setPreferredPayee] = useState('');
  const [amounts, setAmounts] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agencyId = params.get('agencyId');
    const cleanerId = params.get('cleanerId');
    if (agencyId) setPreferredPayee(`agency:${agencyId}`);
    else if (cleanerId) setPreferredPayee(`cleaner:${cleanerId}`);
  }, []);

  const loadJobs = useCallback(async (id) => {
    if (!id) {
      setJobs([]);
      return;
    }
    const rows = await api(`/api/payments/receipts/jobs?businessId=${encodeURIComponent(id)}`);
    setJobs(rows);
    setSelectedPayee((current) => {
      if (preferredPayee && rows.some((row) => payeeKey(row) === preferredPayee)) return preferredPayee;
      if (current && rows.some((row) => payeeKey(row) === current)) return current;
      return payeeKey(rows[0] || {});
    });
  }, [preferredPayee]);

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

  const payees = [];
  const seen = new Set();
  for (const job of jobs) {
    const key = payeeKey(job);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    payees.push({ key, name: payeeName(job), kind: job.agencyId ? 'agency' : 'cleaner' });
  }
  const visible = jobs.filter((job) => payeeKey(job) === selectedPayee);
  const selected = payees.find((row) => row.key === selectedPayee);

  async function upload(job, file) {
    if (!file) return;
    const stated = String(amounts[String(job.requestId)] || '').trim();
    if (!stated || !(Number(stated) > 0)) {
      setError('Enter the amount shown on the receipt before you choose the file.');
      return;
    }
    setError('');
    setMessage('');
    setBusyId(String(job.requestId));
    try {
      const body = new FormData();
      body.append('requestId', String(job.requestId));
      body.append('statedAmount', stated);
      if (job.agencyId) body.append('agencyId', String(job.agencyId));
      else body.append('cleanerUserId', String(job.cleanerId));
      body.append('file', file);
      await apiForm('/api/payments/receipts', body);
      setMessage(
        job.agencyId
          ? 'Receipt uploaded. The agency can open it and mark the job paid.'
          : 'Receipt uploaded. The cleaner can open it and mark the job paid.'
      );
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
          Use this after you pay an agency or a cleaner outside the app. Enter the amount written
          on the receipt, then upload a PDF or an image. The file must be 5 MB or smaller.
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
          Who you paid
          <select value={selectedPayee} onChange={(event) => setSelectedPayee(event.target.value)}>
            {payees.length === 0 ? <option value="">No assigned job yet</option> : null}
            {payees.map((payee) => (
              <option key={payee.key} value={payee.key}>
                {payee.name} ({payee.kind})
              </option>
            ))}
          </select>
        </label>
        <div className="list">
          {visible.length === 0 ? <p className="muted">No jobs for this choice.</p> : null}
          {visible.map((job) => (
            <div className="item stack" key={String(job.requestId)}>
              <div className="row">
                <strong>{job.serviceDetails}</strong>
                <StatusBadge status={job.paymentStatus === 'none' ? 'unpaid' : job.paymentStatus} />
              </div>
              <div>{job.address}</div>
              <div className="muted">{jobStamp(job)}</div>
              <div className="muted">
                Job amount {job.amount == null ? 'not set' : formatGbp(job.amount)} · {payeeName(job)}
              </div>
              {job.receipt ? (
                <div className="muted">
                  Receipt on file: {job.receipt.originalName}
                  {job.receipt.statedAmount != null ? ` · says ${formatGbp(job.receipt.statedAmount)}` : ''}
                </div>
              ) : null}
              {job.paymentStatus === 'paid' ? (
                <p className="muted">This job is already marked paid.</p>
              ) : (
                <>
                  <label>
                    Amount on the receipt (£)
                    <input
                      inputMode="decimal"
                      value={amounts[String(job.requestId)] || ''}
                      onChange={(event) =>
                        setAmounts((current) => ({
                          ...current,
                          [String(job.requestId)]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {job.receipt ? 'Replace receipt' : 'Receipt file'}
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                      disabled={busyId === String(job.requestId)}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        upload(job, file);
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          ))}
        </div>
        {selected?.kind === 'cleaner' ? (
          <p className="muted">This person is a cleaner, so the receipt goes to them rather than an agency.</p>
        ) : null}
      </div>
    </div>
  );
}
