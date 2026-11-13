'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getStoredUser } from '../../../lib/api';
import { hasPlacePin } from '../../../lib/place';
import LocationPicker from '../../../components/LocationPicker';

export default function AgencyRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    agencyName: '',
    phone: '',
  });
  const [place, setPlace] = useState({
    address: '',
    latitude: null,
    longitude: null,
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user?.role) return;
    if (user.role === 'cleaning_agency') {
      if (user.mustSetPassword) router.replace('/auth/set-password');
      else router.replace('/agency');
      return;
    }
    setError('Only new signups or existing agency accounts use this page.');
  }, [router]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!hasPlacePin(place)) {
      setError('Pick a premises address from the suggestions (or set the map pin)');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await api('/api/auth/register/agency', {
        method: 'POST',
        body: {
          ...form,
          address: place.address.trim(),
          latitude: Number(place.latitude),
          longitude: Number(place.longitude),
        },
      });
      setMessage(data.message || 'Check your email to finish signup.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card stack" style={{ width: 'min(520px, 100%)' }}>
        <div>
          <h1>Register your cleaning agency</h1>
          <p className="muted">
            Create an agency account and profile. You will set a password after confirming
            your email.
          </p>
        </div>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            Your name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Agency name
            <input
              required
              value={form.agencyName}
              onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <LocationPicker value={place} onChange={setPlace} label="Agency HQ address" />
          {error ? <div className="error">{error}</div> : null}
          {message ? <div className="success">{message}</div> : null}
          <button disabled={loading} type="submit">
            {loading ? 'Submitting…' : 'Register agency'}
          </button>
        </form>
        <p className="muted">
          Already registered? <Link href="/">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
