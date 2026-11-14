'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { TopBar, useRequireRole } from '../../../../components/ui';
import { SAMPLE_CSV, parseCsv, rowsFromMatrix, withSharedPassword } from '../../../../lib/staffBulk';

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function matrixFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return parseCsv(await file.text());
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    throw new Error('Upload a CSV or Excel file.');
  }
  const XLSX = await import('xlsx');
  const data = await file.arrayBuffer();
  const book = XLSX.read(data, { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('The Excel file has no sheet.');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}

export default function BulkStaffPage() {
  const router = useRouter();
  const user = useRequireRole('cleaning_agency');
  const [agencies, setAgencies] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [sharedPassword, setSharedPassword] = useState('');
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  const loadAgencies = useCallback(async () => {
    const list = await api('/api/agencies/mine');
    setAgencies(list);
    setAgencyId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    loadAgencies().catch((err) => setError(err.message));
  }, [user, loadAgencies]);

  const preview = withSharedPassword(rows, sharedPassword).map((row) => ({
    ...row,
    ready: row.ready && !row.outcome,
  }));
  const readyCount = preview.filter((row) => row.ready).length;

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setError('');
    setMessage('');
    if (!file) return;
    if (file.size > 1_000_000) {
      setRows([]);
      setFileName('');
      setError('That file is too large. Keep it under 1 MB.');
      return;
    }
    try {
      const matrix = await matrixFromFile(file);
      const parsed = rowsFromMatrix(matrix);
      setFileName(file.name);
      setRows(parsed.rows);
      setError(parsed.error || '');
    } catch (err) {
      setRows([]);
      setFileName('');
      setError(err.message || 'Could not read that file.');
    }
  }

  async function downloadExcelSample() {
    const XLSX = await import('xlsx');
    const matrix = SAMPLE_CSV.split('\n').map((line) => line.split(','));
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Staff');
    XLSX.writeFile(book, 'staff-sample.xlsx');
  }

  async function createStaff() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const staff = preview
        .filter((row) => row.ready)
        .map((row) => ({
          name: row.name,
          email: row.email,
          password: row.finalPassword,
        }));
      const result = await api(`/api/agencies/${agencyId}/staff/bulk`, {
        method: 'POST',
        body: { staff },
      });
      const byEmail = new Map(result.results.map((row) => [row.email, row]));
      setRows((current) =>
        current.map((row) => {
          const outcome = byEmail.get(row.email);
          if (!outcome) return row;
          if (outcome.status === 'failed') {
            return { ...row, problems: [outcome.error] };
          }
          return { ...row, problems: [], outcome: outcome.status };
        })
      );
      const parts = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.linked) parts.push(`${result.linked} linked to an existing account`);
      if (result.failed) parts.push(`${result.failed} could not be added`);
      setMessage(parts.join('. ') + '.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Add many staff" />
      <p className="muted">
        <Link href="/agency">Back to agency home</Link>
      </p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="card stack">
        <h2>Upload Excel or CSV</h2>
        <p className="muted">
          The first row must name the columns. Use name and email. Password is optional when you
          type one shared password below. Up to 100 people at a time.
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
          Shared password for rows that leave it blank
          <input
            type="text"
            autoComplete="off"
            value={sharedPassword}
            onChange={(event) => setSharedPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        <label>
          Staff file
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
          />
        </label>
        <div className="row">
          <button
            className="secondary"
            type="button"
            onClick={() => downloadText('staff-sample.csv', `${SAMPLE_CSV}\n`, 'text/csv')}
          >
            Download CSV sample
          </button>
          <button className="secondary" type="button" onClick={downloadExcelSample}>
            Download Excel sample
          </button>
        </div>
        {fileName ? <p className="muted">File: {fileName}</p> : null}
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Check before creating</h2>
          <button type="button" disabled={busy || readyCount === 0 || !agencyId} onClick={createStaff}>
            {busy ? 'Creating…' : `Create ${readyCount} staff`}
          </button>
        </div>
        {preview.length === 0 ? <p className="muted">No file loaded yet.</p> : null}
        {preview.length > 0 ? (
          <table className="tx-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Name</th>
                <th>Email</th>
                <th>Password</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.line}>
                  <td>{row.line}</td>
                  <td>{row.name || '—'}</td>
                  <td>{row.email || '—'}</td>
                  <td>{row.passwordSource}</td>
                  <td>
                    {row.outcome === 'created'
                      ? 'Created'
                      : row.outcome === 'linked'
                        ? 'Linked existing account'
                        : row.ready
                          ? 'Ready'
                          : row.problems.join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
