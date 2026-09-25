'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, clearSession, getStoredUser } from '../lib/api';
import { connectNotifications } from '../lib/realtime';
import { registerWebPush } from '../lib/push';

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

const NOTIFY_ROLES = new Set(['client', 'business', 'cleaner']);
/** Polling is a safety net; live alerts arrive over WebSocket. */
const POLL_MS_CONNECTED = 60_000;
const POLL_MS_DISCONNECTED = 15_000;

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function NotificationBell() {
  const [notes, setNotes] = useState([]);
  const [open, setOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('disconnected');
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    const list = await api('/api/notifications');
    setNotes(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  // Live delivery via WebSocket; reconnect with backoff inside helper
  useEffect(() => {
    const disconnect = connectNotifications({
      onStatus: setLiveStatus,
      onNotification: (note) => {
        setNotes((prev) => {
          if (prev.some((n) => String(n._id) === String(note._id))) return prev;
          return [note, ...prev].slice(0, 50);
        });
      },
    });
    return disconnect;
  }, []);

  // Safety-net poll — slower while live is connected
  useEffect(() => {
    const ms =
      liveStatus === 'connected' ? POLL_MS_CONNECTED : POLL_MS_DISCONNECTED;
    const t = setInterval(() => load().catch(() => {}), ms);
    return () => clearInterval(t);
  }, [load, liveStatus]);

  // Optional FCM web push for cleaners / business when Firebase is configured
  useEffect(() => {
    registerWebPush().catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  async function onItemClick(note) {
    if (note.read) return;
    try {
      await api(`/api/notifications/${note._id}/read`, { method: 'POST' });
      setNotes((prev) =>
        prev.map((n) => (n._id === note._id ? { ...n, read: true } : n))
      );
    } catch {
      /* keep list as-is on failure */
    }
  }

  const unread = notes.filter((n) => !n.read).length;
  const shown = notes.slice(0, 8);

  return (
    <div className="notify-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notify-btn"
        aria-label={
          unread > 0
            ? `Notifications, ${unread} unread`
            : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="notify-badge">{unread > 99 ? '99+' : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notify-dropdown" role="menu">
          <div className="notify-dropdown-title">Notifications</div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0, padding: '8px 12px' }}>
              None yet.
            </p>
          ) : (
            <div className="notify-list">
              {shown.map((n) => (
                <button
                  type="button"
                  key={n._id}
                  className={`notify-item${n.read ? '' : ' unread'}`}
                  role="menuitem"
                  onClick={() => onItemClick(n)}
                >
                  <strong>{n.title}</strong>
                  <div className="muted">{n.body}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
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

  const showNotify = user && NOTIFY_ROLES.has(user.role);

  return (
    <div className="topbar">
      <div>
        <div className="brand">{title}</div>
        <div className="muted">
          {user ? `${user.name} · ${user.role}` : '\u00a0'}
        </div>
      </div>
      <div className="row">
        {user?.role === 'business' || user?.role === 'client' ? (
          <Link href="/client/archived" className="muted">
            Archived
          </Link>
        ) : null}
        {user?.role === 'business' ? (
          <Link href="/client/payments" className="muted">
            Payments
          </Link>
        ) : null}
        {user?.role === 'business' ? (
          <Link href="/client/businesses/new" className="muted">
            Add another business
          </Link>
        ) : null}
        {showNotify ? <NotificationBell /> : null}
        <button className="secondary" onClick={logout} type="button">
          Sign out
        </button>
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge ${status}`}>{status.replaceAll('_', ' ')}</span>;
}
