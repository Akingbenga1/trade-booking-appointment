'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, clearSession, getStoredUser } from '../../../lib/api';
import { hasPlacePin } from '../../../lib/place';
import LocationPicker from '../../../components/LocationPicker';

export default function BusinessRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    businessName: '',
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
    if (user.role === 'business') {
      if (user.mustSetPassword) router.replace('/auth/set-password');
      else router.replace('/client');
      return;
    }
    setError('Only new signups or existing business accounts use this page.');
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
      const data = await api('/api/auth/register/business', {
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
          <h1>Register your business</h1>
          <p className="muted">
            Create a representative account and your business profile. You will set a
            password after confirming your email.
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
            Work email
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Business name
            <input
              required
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
            />
          </label>
          <LocationPicker
            label="Business premises address"
            value={place}
            onChange={setPlace}
          />
          <label>
            Business phone
            <input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          {message ? <div className="success">{message}</div> : null}
          <button disabled={loading || Boolean(message)} type="submit">
            {loading ? 'Registering…' : 'Create business account'}
          </button>
        </form>
        <p className="muted">
          Already have an account? <Link href="/">Sign in</Link>
        </p>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            clearSession();
            router.push('/');
          }}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
