'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../components/ui';

const HUB = { lat: 51.5074, lng: -0.1278 };
const NEXT_STEP = {
  assigned: 'en_route',
  en_route: 'on_site',
  on_site: 'in_progress',
  in_progress: 'completed',
};

export default function CleanerPage() {
  const user = useRequireRole('cleaner');
  const [available, setAvailable] = useState(false);
  const [lat, setLat] = useState(HUB.lat + 0.01);
  const [lng, setLng] = useState(HUB.lng + 0.01);
  const [offers, setOffers] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [offerList, assignedList, notifications, me] = await Promise.all([
      api('/api/requests/offers'),
      api('/api/requests/assigned'),
      api('/api/notifications'),
      api('/api/auth/me'),
    ]);
    setOffers(offerList);
    setAssigned(assignedList);
    setNotes(notifications);
    setAvailable(Boolean(me.isAvailable));
    if (me.currentLocation?.lat != null) {
      setLat(me.currentLocation.lat);
      setLng(me.currentLocation.lng);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [user, load]);

  async function setAvailability(next) {
    setError('');
    setMessage('');
    try {
      await api('/api/cleaners/availability', {
        method: 'POST',
        body: next
          ? { isAvailable: true, lat: Number(lat), lng: Number(lng) }
          : { isAvailable: false },
      });
      setAvailable(next);
      setMessage(next ? 'You are live for nearby matching.' : 'You are unavailable.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function respond(requestId, action) {
    setError('');
    setMessage('');
    try {
      await api(`/api/requests/${requestId}/respond`, {
        method: 'POST',
        body: { action },
      });
      setMessage(
        action === 'accept'
          ? 'You got the job.'
          : action === 'reject'
            ? 'Rejected — others may still take it.'
            : 'Ignored.'
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function progress(id, status) {
    setError('');
    try {
      await api(`/api/requests/${id}/progress`, {
        method: 'POST',
        body: { status },
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;

  const pending = offers.filter((o) => o.offer?.status === 'pending');
  const history = offers.filter((o) => o.offer && o.offer.status !== 'pending');

  return (
    <div className="shell">
      <TopBar title="Cleaner" />
      <div className="grid grid-2">
        <div className="card stack">
          <h2>Availability</h2>
          <div className="row">
            <StatusBadge status={available ? 'live' : 'unavailable'} />
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>
              Lat
              <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              Lng
              <input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <button type="button" onClick={() => setAvailability(true)}>
              Go available
            </button>
            <button className="secondary" type="button" onClick={() => setAvailability(false)}>
              Go unavailable
            </button>
          </div>
          {message ? <div className="success">{message}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="card stack">
          <h2>Notifications</h2>
          <div className="list">
            {notes.slice(0, 6).map((n) => (
              <div className="item" key={n._id}>
                <strong>{n.title}</strong>
                <div className="muted">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Nearby offers (open board)</h2>
        <div className="list">
          {pending.length === 0 ? <p className="muted">No pending nearby offers.</p> : null}
          {pending.map(({ request, offer }) => (
            <div className="item stack" key={request.id}>
              <div className="row">
                <StatusBadge status={offer.status} />
                <span className="muted">{offer.distanceKm} km away</span>
                <span className="muted">
                  Expires {new Date(offer.expiresAt).toLocaleTimeString()}
                </span>
              </div>
              <div>{request.serviceDetails}</div>
              <div className="muted">{request.location?.address}</div>
              <div className="row">
                <button type="button" onClick={() => respond(request.id, 'accept')}>
                  Accept
                </button>
                <button className="secondary" type="button" onClick={() => respond(request.id, 'reject')}>
                  Reject
                </button>
                <button className="secondary" type="button" onClick={() => respond(request.id, 'ignore')}>
                  Ignore
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card stack">
          <h2>Assigned jobs</h2>
          <div className="list">
            {assigned.map((r) => (
              <div className="item stack" key={r._id}>
                <StatusBadge status={r.status} />
                <div>{r.serviceDetails}</div>
                {NEXT_STEP[r.status] ? (
                  <button type="button" onClick={() => progress(r._id, NEXT_STEP[r.status])}>
                    Mark {NEXT_STEP[r.status].replaceAll('_', ' ')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="card stack">
          <h2>Offer history</h2>
          <div className="list">
            {history.slice(0, 12).map(({ request, offer }) => (
              <div className="item row" key={`${request.id}-${offer.id}`}>
                <StatusBadge status={offer.status} />
                <span>{request.serviceDetails}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
