'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setSession } from '../../../lib/api';

function MagicLinkInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Confirming your email…');
  const started = useRef(false);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Missing confirmation token.');
      setStatus('');
      return;
    }
    // Strict Mode remounts effects; magic tokens are one-time — verify only once.
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const data = await api('/api/auth/magic-link/verify', {
          method: 'POST',
          body: { token },
        });
        setSession(data.token, data.user);
        if (data.user.mustSetPassword || data.mustSetPassword) {
          router.replace('/auth/set-password');
        } else if (data.user.role === 'cleaning_agency') {
          router.replace('/agency');
        } else if (data.user.role === 'agency_staff' || data.user.role === 'cleaner') {
          router.replace('/cleaner');
        } else {
          router.replace('/client');
        }
      } catch (err) {
        setError(err.message);
        setStatus('');
      }
    })();
  }, [router, searchParams]);

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <h1>Email confirmation</h1>
        {status ? <p className="muted">{status}</p> : null}
        {error ? <div className="error">{error}</div> : null}
      </div>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense
      fallback={
        <div className="login-wrap">
          <div className="card login-card stack">
            <h1>Email confirmation</h1>
            <p className="muted">Confirming your email…</p>
          </div>
        </div>
      }
    >
      <MagicLinkInner />
    </Suspense>
  );
}
