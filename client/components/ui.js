'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearSession, getStoredUser } from '../lib/api';

export function useRequireRole(role) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const allowedKey = Array.isArray(role) ? role.join(',') : String(role || '');

  useEffect(() => {
    const u = getStoredUser();
    setUser(u);
    if (!u) {
      router.replace('/');
      return;
    }
    const allowed = allowedKey ? allowedKey.split(',') : [];
    if (allowed.length && !allowed.includes(u.role)) {
      router.replace('/');
    }
  }, [router, allowedKey]);

  return user;
}

export function TopBar({ title }) {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  function logout() {
    clearSession();
    router.replace('/');
  }

  return (
    <div className="topbar">
      <div>
        <div className="brand">{title}</div>
        <div className="muted">
          {user ? `${user.name} · ${user.role}` : '\u00a0'}
        </div>
      </div>
      <button className="secondary" onClick={logout} type="button">
        Sign out
      </button>
    </div>
  );
}

export function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge ${status}`}>{status.replaceAll('_', ' ')}</span>;
}
