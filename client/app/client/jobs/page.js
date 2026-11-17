'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { TopBar, useRequireRole } from '../../../components/ui';
import MyRequests from '../../../components/MyRequests';

export default function BusinessJobsPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  const load = useCallback(async () => {
    const mine = await api('/api/requests/mine');
    setRequests(Array.isArray(mine) ? mine : []);
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    load().catch((err) => setError(err.message));
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [user, load]);

  if (!user || user.mustSetPassword) return null;

  return (
    <div className="shell">
      <TopBar title="Your jobs" />
      <p className="muted">
        <Link href="/client">Back to business home</Link>
      </p>
      {message ? <div className="success">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}
      <div className="card stack">
        <MyRequests
          title="Jobs you created"
          requests={requests}
          user={user}
          onReload={load}
          setError={setError}
          setMessage={setMessage}
        />
      </div>
    </div>
  );
}
