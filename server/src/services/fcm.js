import { config } from '../config.js';
import { PushDevice } from '../models/PushDevice.js';

let messaging = null;
let initAttempted = false;

function isFcmConfigured() {
  return Boolean(
    config.fcm.projectId && config.fcm.clientEmail && config.fcm.privateKey
  );
}

async function getMessaging() {
  if (messaging) return messaging;
  if (initAttempted) return null;
  initAttempted = true;

  if (!isFcmConfigured()) {
    console.warn(
      '[fcm] not configured (FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY) — push skipped'
    );
    return null;
  }

  try {
    const admin = await import('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.fcm.projectId,
          clientEmail: config.fcm.clientEmail,
          privateKey: config.fcm.privateKey,
        }),
      });
    }
    messaging = admin.messaging();
    console.log(`[fcm] initialized project=${config.fcm.projectId}`);
    return messaging;
  } catch (err) {
    console.error('[fcm] init failed:', err.message);
    return null;
  }
}

/** Reset cached client (tests / env reload). */
export function resetFcm() {
  messaging = null;
  initAttempted = false;
}

export { isFcmConfigured };

/**
 * Send an FCM data+notification message to all active devices for a user.
 * @returns {Promise<boolean>} true if at least one device accepted the send
 */
export async function sendPushToUser(userId, { title, body, data = {} }) {
  const devices = await PushDevice.find({
    userId,
    active: true,
  }).limit(20);

  if (!devices.length) return false;

  const msg = await getMessaging();
  if (!msg) {
    // Soft success path for local/dev without FCM: treat as "not delivered"
    console.log(
      `[fcm] skip send (no FCM) user=${userId} devices=${devices.length} title="${title}"`
    );
    return false;
  }

  let anyOk = false;
  for (const device of devices) {
    try {
      await msg.send({
        token: device.token,
        notification: { title, body },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
        ),
        android: { priority: 'high' },
        webpush: {
          headers: { Urgency: 'high' },
          fcmOptions: {
            link: data.link || config.clientOrigin,
          },
        },
      });
      device.lastSeenAt = new Date();
      await device.save();
      anyOk = true;
    } catch (err) {
      const code = err?.code || err?.errorInfo?.code || '';
      console.error(
        `[fcm] send failed user=${userId} platform=${device.platform}: ${err.message}`
      );
      // Stale / invalid tokens — deactivate so we stop retrying them forever
      if (
        String(code).includes('registration-token-not-registered') ||
        String(code).includes('invalid-registration-token') ||
        /not.?registered|invalid.?token/i.test(err.message)
      ) {
        device.active = false;
        await device.save();
      } else {
        throw err;
      }
    }
  }
  return anyOk;
}
