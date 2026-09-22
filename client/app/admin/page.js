'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../components/ui';

export default function AdminPage() {
  const user = useRequireRole('admin');
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [selected, setSelected] = useState(null);
  const [cleanerId, setCleanerId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [reqs, us, st] = await Promise.all([
      api('/api/admin/requests'),
      api('/api/admin/users'),
      api('/api/admin/stats'),
    ]);
    setRequests(reqs);
    setUsers(us);
    setStats(st);
    const cleaners = us.filter((u) => u.role === 'cleaner' && !u.isDisabled);
    if (!cleanerId && cleaners[0]) setCleanerId(cleaners[0]._id);
  }, [cleanerId]);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [user, load]);

  async function openRequest(id) {
    setError('');
    try {
      const detail = await api(`/api/admin/requests/${id}`);
      setSelected(detail);
    } catch (err) {
      setError(err.message);
    }
  }

  async function forceAssign() {
    if (!selected) return;
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/requests/${selected._id}/force-assign`, {
        method: 'POST',
        body: { cleanerId },
      });
      setMessage('Force-assigned.');
      await load();
      await openRequest(selected._id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelSelected() {
    if (!selected) return;
    setError('');
    try {
      await api(`/api/admin/requests/${selected._id}/cancel`, { method: 'POST' });
      setMessage('Cancelled.');
      await load();
      await openRequest(selected._id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function patchUser(id, body) {
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body });
      setMessage('User updated.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;

  const cleaners = users.filter((u) => u.role === 'cleaner' && !u.isDisabled);

  return (
    <div className="shell">
      <TopBar title="Admin hub" />
      <div className="card row" style={{ marginBottom: 16 }}>
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="item">
            <StatusBadge status={k} /> <strong>{v}</strong>
          </div>
        ))}
      </div>

      {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
      {message ? <div className="success" style={{ marginBottom: 12 }}>{message}</div> : null}

      <div className="grid grid-2">
        <div className="card stack">
          <h2>All requests</h2>
          <div className="list">
            {requests.map((r) => (
              <button
                key={r._id}
                type="button"
                className="secondary"
                style={{ textAlign: 'left', borderRadius: 12 }}
                onClick={() => openRequest(r._id)}
              >
                <div className="row">
                  <StatusBadge status={r.status} />
                  <span>{r.serviceDetails}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card stack">
          <h2>Request detail</h2>
          {!selected ? <p className="muted">Select a request.</p> : null}
          {selected ? (
            <>
              <div className="row">
                <StatusBadge status={selected.status} />
                <span className="muted">Notified {selected.notifiedCleanerCount}</span>
              </div>
              <div>{selected.serviceDetails}</div>
              <div className="muted">{selected.location?.address}</div>
              <div className="muted">
                Client: {selected.clientId?.name || selected.clientId}
              </div>
              <h3>Offer trail</h3>
              <div className="list">
                {(selected.offers || []).map((o) => (
                  <div className="item row" key={o._id}>
                    <StatusBadge status={o.status} />
                    <span>{o.cleanerId?.name || o.cleanerId}</span>
                    <span className="muted">{o.distanceKm} km</span>
                  </div>
                ))}
              </div>
              <label>
                Force-assign cleaner
                <select value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
                  {cleaners.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button type="button" onClick={forceAssign}>
                  Force assign
                </button>
                <button className="danger" type="button" onClick={cancelSelected}>
                  Cancel request
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Users</h2>
        <div className="list">
          {users.map((u) => (
            <div className="item stack" key={u._id}>
              <div className="row">
                {u.isDisabled ? (
                  <StatusBadge status="unavailable" />
                ) : u.role === 'cleaner' ? (
                  <StatusBadge status={u.isAvailable ? 'live' : 'unavailable'} />
                ) : (
                  <StatusBadge status={u.role} />
                )}
                <strong>{u.name}</strong>
                <span className="muted">{u.role}</span>
                <span className="muted">{u.email}</span>
                {u.isDisabled ? <span className="muted">disabled</span> : null}
              </div>
              {u.role !== 'admin' ? (
                <div className="row">
                  {u.role === 'cleaner' && !u.isDisabled ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        patchUser(u._id, { isAvailable: !u.isAvailable })
                      }
                    >
                      {u.isAvailable ? 'Set unavailable' : 'Set available'}
                    </button>
                  ) : null}
                  <button
                    className={u.isDisabled ? 'secondary' : 'danger'}
                    type="button"
                    onClick={() => patchUser(u._id, { isDisabled: !u.isDisabled })}
                  >
                    {u.isDisabled ? 'Enable account' : 'Disable account'}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
