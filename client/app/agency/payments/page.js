'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatGbp, jobStamp } from '../../../lib/jobPay';

function payerLine(row) {
  const kind = row.payerKind === 'business' ? 'business' : 'personal client';
  return `${row.payerName} (${kind})`;
}

function amountLine(row) {
  if (row.status === 'none') return 'No charge. This is a personal job.';
  return `${formatGbp(row.amount)} ${row.currency || 'GBP'}`;
}

function PaymentTable({ rows }) {
  if (rows.length === 0) return <p className="muted">None.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tx-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Payer</th>
            <th>Job</th>
            <th>Amount</th>
            <th>Payment</th>
            <th>Job stage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.date ? new Date(row.date).toLocaleString() : '—'}</td>
              <td>{payerLine(row)}</td>
              <td>
                <div>{row.jobLabel}</div>
                <div className="muted">{row.address}</div>
                <div className="muted">{jobStamp(row)}</div>
              </td>
              <td>{amountLine(row)}</td>
              <td>
                {row.status === 'none' ? (
                  <span className="muted">Not charged</span>
                ) : (
                  <StatusBadge status={row.status} />
                )}
              </td>
              <td>
                <StatusBadge status={row.requestStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AgencyPaymentsPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  const loadAgencies = useCallback(async () => {
    const list = await api('/api/agencies/mine');
    setAgencies(list);
    setAgencyId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
  }, []);

  const loadPayments = useCallback(async (id) => {
    if (!id) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows(await api(`/api/agencies/${id}/payments`));
      setError('');
    } catch (err) {
      setRows([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    loadAgencies().catch((err) => setError(err.message));
  }, [user, loadAgencies]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !agencyId) return;
    loadPayments(agencyId);
  }, [user, agencyId, loadPayments]);

  if (!user || user.mustSetPassword) return null;

  const paid = rows.filter((row) => row.status === 'paid');
  const waiting = rows.filter((row) => row.status !== 'paid');
  const paidTotal = paid.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <div className="shell">
      <TopBar title="Payments" />
      <p className="muted">
        <Link href="/agency">Back to agency home</Link>
        {' · '}
        <Link href="/agency/receipts">Payment receipts</Link>
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
      <div className="stack">
        <div className="card stack">
          <h2>Paid</h2>
          <p className="muted">
            Money already paid by a business or a personal client.
            {paid.length ? ` Total ${formatGbp(paidTotal)}.` : ''}
          </p>
          {loading ? <p className="muted">Loading…</p> : <PaymentTable rows={paid} />}
        </div>
        <div className="card stack">
          <h2>Not paid yet</h2>
          <p className="muted">
            Jobs locked to your agency that are still unpaid, pending, failed, or not charged.
          </p>
          {loading ? <p className="muted">Loading…</p> : <PaymentTable rows={waiting} />}
        </div>
      </div>
    </div>
  );
}
