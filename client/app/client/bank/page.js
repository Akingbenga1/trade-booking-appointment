'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { TopBar, useRequireRole } from '../../../components/ui';
import { jobStamp } from '../../../lib/jobPay';

export default function BusinessBankPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

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
    api(`/api/payments/bank-details?businessId=${encodeURIComponent(businessId)}`)
      .then(setRows)
      .catch((err) => setError(err.message));
  }, [user, businessId]);

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Bank details" />
      <p className="muted">
        <Link href="/client">Back to business home</Link>
        {' · '}
        <Link href="/client/receipts">Upload receipt</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {businesses.length > 1 ? (
        <div className="card stack" style={{ marginBottom: 16 }}>
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
        </div>
      ) : null}
      <div className="card stack">
        <h2>Pay by bank transfer</h2>
        <p className="muted">
          These are the official bank details for an agency you chose, or an agency locked to your
          job. After you pay, upload the receipt so the agency is told and can open the file.
        </p>
        <div className="list">
          {rows.length === 0 ? (
            <p className="muted">Choose an agency for a job first. Bank details show here after that.</p>
          ) : null}
          {rows.map((row) => (
            <div className="item stack" key={String(row.agencyId)}>
              <strong>{row.agencyName}</strong>
              {row.provided ? (
                <div className="stack">
                  <div>Account name: {row.accountName}</div>
                  <div>Bank: {row.bankName}</div>
                  <div>Sort code: {row.sortCode}</div>
                  <div>Account number: {row.accountNumber}</div>
                </div>
              ) : (
                <p className="muted">This agency has not added bank details yet.</p>
              )}
              <div className="muted">
                Jobs:{' '}
                {row.jobs.map((job) => `${job.serviceDetails} (${jobStamp(job)})`).join('; ')}
              </div>
              <Link href={`/client/receipts?agencyId=${encodeURIComponent(row.agencyId)}`}>
                Upload payment receipt
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
