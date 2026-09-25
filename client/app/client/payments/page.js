'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatGbp } from '../../../lib/jobPay';

export default function PaymentTransactionsPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.mustSetPassword) {
      router.replace('/auth/set-password');
    }
  }, [user, router]);

  const loadBusinesses = useCallback(async () => {
    const list = await api('/api/businesses');
    setBusinesses(list);
    setSelectedBusinessId((prev) => {
      if (prev && list.some((b) => String(b._id) === String(prev))) return prev;
      return list[0]?._id ? String(list[0]._id) : '';
    });
  }, []);

  const loadTransactions = useCallback(async (businessId) => {
    if (!businessId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api(
        `/api/payments/transactions?businessId=${encodeURIComponent(businessId)}`
      );
      setRows(list);
      setError('');
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    loadBusinesses().catch((e) => setError(e.message));
  }, [user, loadBusinesses]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !selectedBusinessId) return;
    loadTransactions(selectedBusinessId);
  }, [user, selectedBusinessId, loadTransactions]);

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Payment transactions" />
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <h2>Payment transactions</h2>
            <p className="muted">
              Payments for the selected business. Includes paid, unpaid, pending, failed, and
              cancelled.
            </p>
          </div>
          <Link href="/client" className="muted">
            ← Back to requests
          </Link>
        </div>

        <label>
          Business
          <select
            value={selectedBusinessId}
            onChange={(e) => setSelectedBusinessId(e.target.value)}
          >
            {businesses.length === 0 ? (
              <option value="">No businesses yet</option>
            ) : null}
            {businesses.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <p className="muted">Loading…</p> : null}

        {!loading && rows.length === 0 && selectedBusinessId ? (
          <p className="muted">No payment transactions for this business yet.</p>
        ) : null}

        {rows.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Job / request</th>
                  <th>Status</th>
                  <th>Provider id</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date ? new Date(row.date).toLocaleString() : '—'}</td>
                    <td>
                      {formatGbp(row.amount)} {row.currency || 'GBP'}
                    </td>
                    <td>
                      <Link href={`/client/pay/${row.requestId}`}>{row.jobLabel}</Link>
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {row.providerId || '—'}
                    </td>
                    <td>
                      {row.receiptUrl ? (
                        <a href={row.receiptUrl} target="_blank" rel="noreferrer">
                          Download receipt
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
