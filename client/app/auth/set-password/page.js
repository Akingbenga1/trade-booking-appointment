'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getStoredUser, setSession } from '../../../lib/api';

const ROLE_HOME = {
  client: '/client',
  business: '/client',
  cleaner: '/cleaner',
  admin: '/admin',
  cleaning_agency: '/agency',
  agency_staff: '/cleaner',
};

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace('/');
      return;
    }
    if (!['business', 'cleaning_agency'].includes(user.role)) {
      router.replace('/');
      return;
    }
    if (!user.mustSetPassword) {
      router.replace(ROLE_HOME[user.role] || '/');
    }
  }, [router]);

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/auth/set-password', {
        method: 'POST',
        body: { password },
      });
      setSession(data.token, data.user);
      router.replace(ROLE_HOME[data.user.role] || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div>
          <h1>Set your password</h1>
          <p className="muted">
            Password login is how you will sign in next time. Choose at least 8 characters.
          </p>
        </div>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            Password
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              required
              type="password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button disabled={loading} type="submit">
            {loading ? 'Saving…' : 'Save password and continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
