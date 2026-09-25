import { getToken } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function wsUrl() {
  const base = API_URL.replace(/^http/, 'ws');
  return `${base}/ws`;
}

/**
 * Open a notification WebSocket. Calls onNotification for each new alert.
 * Returns a cleanup function.
 */
export function connectNotifications({ onNotification, onStatus } = {}) {
  const token = getToken();
  if (!token || typeof window === 'undefined') {
    return () => {};
  }

  let closed = false;
  let ws = null;
  let reconnectTimer = null;
  let attempt = 0;

  function setStatus(status) {
    if (typeof onStatus === 'function') onStatus(status);
  }

  function connect() {
    if (closed) return;
    const url = `${wsUrl()}?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0;
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'notification' && data.notification) {
          onNotification?.(data.notification);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      ws = null;
      if (closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }

  connect();

  const pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25_000);

  return () => {
    closed = true;
    clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };
}
