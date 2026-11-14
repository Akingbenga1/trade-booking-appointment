'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { TopBar, useRequireRole } from '../../../components/ui';

const EMPTY = { accountName: '', bankName: '', sortCode: '', accountNumber: '' };

export default function AgencyBankPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    api('/api/agencies/mine')
      .then((list) => {
        setAgencies(list);
        setAgencyId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
      })
      .catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!user || !agencyId) return;
    api(`/api/agencies/${agencyId}/bank`)
      .then((row) => {
        setForm(
          row.provided
            ? {
                accountName: row.accountName || '',
                bankName: row.bankName || '',
                sortCode: row.sortCode || '',
                accountNumber: row.accountNumber || '',
              }
            : EMPTY
        );
      })
      .catch((err) => setError(err.message));
  }, [user, agencyId]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const saved = await api(`/api/agencies/${agencyId}/bank`, { method: 'PUT', body: form });
      setForm({
        accountName: saved.accountName || '',
        bankName: saved.bankName || '',
        sortCode: saved.sortCode || '',
        accountNumber: saved.accountNumber || '',
      });
      setMessage('Bank details saved. Businesses you are working with can view them.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Bank details" />
      <p className="muted">
        <Link href="/agency">Back to agency home</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <form className="card stack" onSubmit={save} style={{ maxWidth: 520 }}>
        <h2>Official bank account</h2>
        <p className="muted">
          Businesses that chose your agency, or whose job is locked to you, can see these details
          and pay by bank transfer.
        </p>
        {agencies.length > 1 ? (
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
        ) : null}
        <label>
          Account name
          <input value={form.accountName} onChange={(event) => setField('accountName', event.target.value)} />
        </label>
        <label>
          Bank name
          <input value={form.bankName} onChange={(event) => setField('bankName', event.target.value)} />
        </label>
        <label>
          Sort code
          <input
            value={form.sortCode}
            inputMode="numeric"
            placeholder="20-00-00"
            onChange={(event) => setField('sortCode', event.target.value)}
          />
        </label>
        <label>
          Account number
          <input
            value={form.accountNumber}
            inputMode="numeric"
            placeholder="12345678"
            onChange={(event) => setField('accountNumber', event.target.value)}
          />
        </label>
        <button type="submit" disabled={saving || !agencyId}>
          {saving ? 'Saving…' : 'Save bank details'}
        </button>
      </form>
    </div>
  );
}
