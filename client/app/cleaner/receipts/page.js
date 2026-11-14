'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, apiBlob } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import { formatGbp, jobStamp } from '../../../lib/jobPay';

export default function CleanerReceiptsPage() {
  const router = useRouter();
  const user = useRequireRole('cleaner');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [openId, setOpenId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [confirmed, setConfirmed] = useState({});

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const load = useCallback(async () => {
    setRows(await api('/api/payments/receipts/inbox'));
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((err) => setError(err.message));
  }, [user, load]);

  function amountsDiffer(row) {
    if (row.statedAmount == null || row.amount == null) return false;
    return Math.abs(Number(row.statedAmount) - Number(row.amount)) > 0.009;
  }

  async function viewReceipt(row) {
    setError('');
    setBusyId(row.id);
    try {
      const blob = await apiBlob(`/api/payments/receipts/${row.id}/file`);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewType(row.mimeType);
      setOpenId(row.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function markPaid(row) {
    setError('');
    setMessage('');
    if (amountsDiffer(row) && !confirmed[String(row.id)]) {
      setError('The receipt amount and the job amount differ. Tick the box after you check the file.');
      return;
    }
    setBusyId(row.id);
    try {
      const result = await api(`/api/payments/receipts/${row.id}/mark-paid`, {
        method: 'POST',
        body: { confirmMismatch: Boolean(confirmed[String(row.id)]) },
      });
      setMessage(result.alreadyPaid ? 'This job was already paid.' : 'Job marked paid from the receipt.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Payment receipts" />
      <p className="muted">
        <Link href="/cleaner/jobs">Back to assigned jobs</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="card stack">
        <h2>Uploaded receipts</h2>
        <p className="muted">
          A business can send proof they paid you outside the app. Open the file, then mark the job paid.
        </p>
        <div className="list">
          {rows.length === 0 ? <p className="muted">No receipts uploaded yet.</p> : null}
          {rows.map((row) => (
            <div className="item stack" key={String(row.id)}>
              <div className="row">
                <strong>{row.serviceDetails}</strong>
                <StatusBadge status={row.paymentStatus} />
              </div>
              <div>{row.businessName} (business)</div>
              <div className="muted">{row.address}</div>
              <div className="muted">{jobStamp(row)}</div>
              <div className="muted">
                Job {row.amount == null ? 'amount not set' : formatGbp(row.amount)}
                {row.statedAmount != null ? ` · receipt says ${formatGbp(row.statedAmount)}` : ''}
                {' · '}
                {row.originalName}
              </div>
              {amountsDiffer(row) && row.paymentStatus !== 'paid' ? (
                <label className="row">
                  <input
                    type="checkbox"
                    checked={Boolean(confirmed[String(row.id)])}
                    onChange={(event) =>
                      setConfirmed((current) => ({
                        ...current,
                        [String(row.id)]: event.target.checked,
                      }))
                    }
                  />
                  I checked the file. The amounts differ.
                </label>
              ) : null}
              <div className="row">
                <button type="button" disabled={busyId === String(row.id)} onClick={() => viewReceipt(row)}>
                  View receipt
                </button>
                {row.paymentStatus === 'paid' ? (
                  <span className="muted">Marked paid</span>
                ) : (
                  <button type="button" disabled={busyId === String(row.id)} onClick={() => markPaid(row)}>
                    Mark job paid
                  </button>
                )}
              </div>
              {openId === String(row.id) && previewUrl ? (
                previewType === 'application/pdf' ? (
                  <iframe title={row.originalName} src={previewUrl} style={{ width: '100%', height: 420, border: 0 }} />
                ) : (
                  <img src={previewUrl} alt={row.originalName} style={{ maxWidth: '100%' }} />
                )
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
