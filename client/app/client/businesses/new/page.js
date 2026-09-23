'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { TopBar, useRequireRole } from '../../../../components/ui';
import LocationPicker from '../../../../components/LocationPicker';

export default function AddBusinessPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [form, setForm] = useState({ name: '', phone: '' });
  const [place, setPlace] = useState({
    address: '',
    latitude: null,
    longitude: null,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.mustSetPassword) {
      router.replace('/auth/set-password');
    }
  }, [user, router]);

  async function onSubmit(e) {
    e.preventDefault();
    if (
      !place.address?.trim() ||
      !Number.isFinite(Number(place.latitude)) ||
      !Number.isFinite(Number(place.longitude))
    ) {
      setError('Pick a premises address from the suggestions (or set the map pin)');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const created = await api('/api/businesses', {
        method: 'POST',
        body: {
          ...form,
          address: place.address.trim(),
          latitude: Number(place.latitude),
          longitude: Number(place.longitude),
        },
      });
      sessionStorage.setItem('tba_selected_business', String(created._id));
      router.push('/client');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Add business" />
      <div className="card stack" style={{ maxWidth: 520 }}>
        <div>
          <h2>Add another business</h2>
          <p className="muted">
            Create another Business entity linked to your account. You can post jobs for it
            from the hub.
          </p>
        </div>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          <LocationPicker
            label="Premises address"
            value={place}
            onChange={setPlace}
          />
          {error ? <div className="error">{error}</div> : null}
          <div className="row">
            <button disabled={loading} type="submit">
              {loading ? 'Adding…' : 'Add business'}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => router.push('/client')}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
