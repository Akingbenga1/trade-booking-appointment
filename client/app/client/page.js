'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../components/ui';

const HUB = { lat: 51.5074, lng: -0.1278 };

export default function ClientPage() {
  const user = useRequireRole(['client', 'business']);
  const [requests, setRequests] = useState([]);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    serviceDetails: 'Office deep clean tomorrow',
    preferredTime: '',
    address: '10 Downing Street, London',
    lat: HUB.lat,
    lng: HUB.lng,
  });

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      preferredTime: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    }));
  }, []);

  const load = useCallback(async () => {
    const [mine, notifications] = await Promise.all([
      api('/api/requests/mine'),
      api('/api/notifications'),
    ]);
    setRequests(mine);
    setNotes(notifications);
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [user, load]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const created = await api('/api/requests', {
        method: 'POST',
        body: {
          serviceDetails: form.serviceDetails,
          preferredTime: new Date(form.preferredTime).toISOString(),
          location: {
            address: form.address,
            lat: Number(form.lat),
            lng: Number(form.lng),
          },
        },
      });
      setMessage(
        created.status === 'unmatched'
          ? 'No available cleaners nearby.'
          : `Nearby cleaners notified (${created.notifiedCleanerCount}).`
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancel(id) {
    setError('');
    try {
      await api(`/api/requests/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateRequest(id, currentDetails, opts = {}) {
    const rematch = Boolean(opts.rematch);
    let serviceDetails = currentDetails;
    if (!rematch) {
      const next = window.prompt('Update service details', currentDetails || '');
      if (next == null || next.trim() === '') return;
      serviceDetails = next.trim();
    } else {
      serviceDetails = form.serviceDetails || currentDetails;
    }
    setError('');
    setMessage('');
    try {
      const body = { serviceDetails };
      if (rematch) {
        body.location = {
          address: form.address,
          lat: Number(form.lat),
          lng: Number(form.lng),
        };
      }
      const updated = await api(`/api/requests/${id}`, {
        method: 'PATCH',
        body,
      });
      setMessage(
        updated.status === 'unmatched'
          ? 'Updated — still no cleaners nearby.'
          : updated.status === 'open' && updated.notifiedCleanerCount
            ? `Updated — nearby cleaners notified (${updated.notifiedCleanerCount}).`
            : 'Request updated.'
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;

  return (
    <div className="shell">
      <TopBar title={user.role === 'business' ? 'Business' : 'Client / Business'} />
      <div className="grid grid-2">
        <div className="card stack">
          <h2>Post a cleaning need</h2>
          <form className="stack" onSubmit={submit}>
            <label>
              What is needed
              <textarea
                value={form.serviceDetails}
                onChange={(e) => setForm({ ...form, serviceDetails: e.target.value })}
              />
            </label>
            <label>
              Preferred time
              <input
                type="datetime-local"
                value={form.preferredTime}
                onChange={(e) => setForm({ ...form, preferredTime: e.target.value })}
              />
            </label>
            <label>
              Address
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </label>
            <div className="row">
              <label style={{ flex: 1 }}>
                Lat
                <input
                  type="number"
                  step="any"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                />
              </label>
              <label style={{ flex: 1 }}>
                Lng
                <input
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                />
              </label>
            </div>
            <button type="submit">Submit request</button>
          </form>
          {message ? <div className="success">{message}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="card stack">
          <h2>Notifications</h2>
          <div className="list">
            {notes.length === 0 ? <p className="muted">None yet.</p> : null}
            {notes.slice(0, 8).map((n) => (
              <div className="item" key={n._id}>
                <strong>{n.title}</strong>
                <div className="muted">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>My requests</h2>
        <div className="list">
          {requests.map((r) => (
            <div className="item stack" key={r._id}>
              <div className="row">
                <StatusBadge status={r.status} />
                <span className="muted">
                  Notified: {r.notifiedCleanerCount ?? 0}
                </span>
              </div>
              <div>{r.serviceDetails}</div>
              <div className="muted">{r.location?.address}</div>
              {r.preferredTime ? (
                <div className="muted">
                  Preferred: {new Date(r.preferredTime).toLocaleString()}
                </div>
              ) : null}
              {r.assignedCleanerId ? (
                <div className="muted">
                  Assigned: {r.assignedCleanerId.name || r.assignedCleanerId}
                </div>
              ) : null}
              {r.status === 'open' || r.status === 'unmatched' ? (
                <div className="row">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() =>
                      updateRequest(r._id, r.serviceDetails, {
                        rematch: r.status === 'unmatched',
                      })
                    }
                  >
                    {r.status === 'unmatched' ? 'Adjust & rematch' : 'Update'}
                  </button>
                  <button className="danger" type="button" onClick={() => cancel(r._id)}>
                    Cancel
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
