import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const socketsByUser = new Map();

function addSocket(userId, ws) {
  const key = String(userId);
  let set = socketsByUser.get(key);
  if (!set) {
    set = new Set();
    socketsByUser.set(key, set);
  }
  set.add(ws);
}

function removeSocket(userId, ws) {
  const key = String(userId);
  const set = socketsByUser.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) socketsByUser.delete(key);
}

export function isUserLive(userId) {
  const set = socketsByUser.get(String(userId));
  return Boolean(set && set.size > 0);
}

/**
 * Push a notification payload to all open sockets for a user.
 * @returns {boolean} true if at least one socket accepted the message
 */
export function emitNotificationToUser(userId, notification) {
  const set = socketsByUser.get(String(userId));
  if (!set || set.size === 0) return false;

  const message = JSON.stringify({
    type: 'notification',
    notification,
  });

  let delivered = false;
  for (const ws of set) {
    if (ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(message);
        delivered = true;
      } catch {
        /* drop broken socket on next close */
      }
    }
  }
  return delivered;
}

/**
 * Attach WebSocket server to an existing HTTP server.
 * Clients connect to `/ws?token=<jwt>`.
 */
export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    let userId = null;
    try {
      const url = new URL(req.url || '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4401, 'Unauthorized');
        return;
      }
      const payload = jwt.verify(token, config.jwtSecret);
      const user = await User.findById(payload.id);
      if (!user || user.isDisabled) {
        ws.close(4401, 'Unauthorized');
        return;
      }
      userId = String(user._id);
      addSocket(userId, ws);
      ws.send(JSON.stringify({ type: 'connected', userId }));
    } catch {
      ws.close(4401, 'Unauthorized');
      return;
    }

    ws.on('close', () => {
      if (userId) removeSocket(userId, ws);
    });

    ws.on('error', () => {
      if (userId) removeSocket(userId, ws);
    });

    // Keep-alive: client may ignore; helps proxies detect dead links
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        /* ignore non-JSON */
      }
    });
  });

  console.log('[realtime] WebSocket listening on /ws');
  return wss;
}

/** Test helpers */
export function _liveUserCount() {
  return socketsByUser.size;
}

export function _attachTestSocket(userId, ws) {
  addSocket(userId, ws);
  return () => removeSocket(userId, ws);
}

export function _resetRealtimeForTests() {
  for (const set of socketsByUser.values()) {
    for (const ws of set) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }
  socketsByUser.clear();
}
