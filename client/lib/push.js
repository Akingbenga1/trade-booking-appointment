import { api, getStoredUser } from './api';

const PUSH_ROLES = new Set(['cleaner', 'business', 'cleaning_agency', 'agency_staff']);

function firebaseWebConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !messagingSenderId || !appId) return null;
  return {
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    messagingSenderId,
    appId,
  };
}

/**
 * Register this browser for FCM web push when Firebase public config is present
 * and the signed-in user is a cleaner or business user.
 * Safe no-op when config/permission is missing.
 */
export async function registerWebPush() {
  if (typeof window === 'undefined') return null;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;

  const user = getStoredUser();
  if (!user || !PUSH_ROLES.has(user.role)) return null;

  const cfg = firebaseWebConfig();
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!cfg || !vapidKey) return null;

  try {
    const serverCfg = await api('/api/notifications/push/config');
    if (!serverCfg?.enabled) return null;
  } catch {
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');

    if (!(await isSupported())) return null;

    const app = getApps().length ? getApps()[0] : initializeApp(cfg);
    const messaging = getMessaging(app);

    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js'
    );

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;

    await api('/api/notifications/devices', {
      method: 'POST',
      body: { token, platform: 'web' },
    });
    return token;
  } catch (err) {
    console.warn('[push] web register failed', err?.message || err);
    return null;
  }
}
