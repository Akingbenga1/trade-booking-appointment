'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, clearSession, getStoredUser, setSession } from '../lib/api';

const ROLE_HOME = {
  client: '/client',
  business: '/client',
  cleaner: '/cleaner',
  admin: '/admin',
  cleaning_agency: '/agency',
  agency_staff: '/cleaner',
};

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState('client@demo.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (user?.mustSetPassword) {
      router.replace('/auth/set-password');
      return;
    }
    if (user?.role && ROLE_HOME[user.role]) {
      router.replace(ROLE_HOME[user.role]);
    }
  }, [router]);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setSession(data.token, data.user);
      if (data.user.mustSetPassword) {
        router.push('/auth/set-password');
      } else {
        router.push(ROLE_HOME[data.user.role] || '/');
      }
    } catch (err) {
      clearSession();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div>
          <h1>Cleaning Booking Hub</h1>
          <p className="muted">Sign in with your password.</p>
        </div>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button disabled={loading} type="submit">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted">
          New business? <Link href="/register/business">Register your business</Link>
          {' · '}
          <Link href="/register/agency">Register a cleaning agency</Link>
        </p>
        <div className="demo">
          Demo: client@demo.com · cleaner1@demo.com · cleaner2@demo.com · admin@demo.com
          <br />
          Agency: agency@demo.com · staff1@demo.com (after seed)
          <br />
          Password: password123
          <br />
          Businesses: use Register your business (or seed)
        </div>
      </div>
    </div>
  );
}
