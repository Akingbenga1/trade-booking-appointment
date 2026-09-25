import { NotificationJob } from '../models/NotificationJob.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { emitNotificationToUser, isUserLive } from './realtime.js';
import { sendPushToUser } from './fcm.js';
import { enqueueEmail } from './emailQueue.js';

/** Events that get device push (cleaners + business) and email fallback. */
export const URGENT_TYPES = new Set(['new_offer', 'assigned', 'cancelled']);

const PUSH_ROLES = new Set(['cleaner', 'business']);

let processing = false;
let intervalStarted = false;

function backoffMs(attempts) {
  // 2s, 4s, 8s, 16s, 32s (capped)
  return Math.min(32_000, 1000 * 2 ** attempts);
}

function notificationPayload(job) {
  return {
    _id: job.notificationId,
    userId: job.userId,
    type: job.type,
    title: job.title,
    body: job.body,
    requestId: job.requestId,
    read: false,
    createdAt: job.createdAt,
  };
}

/**
 * Enqueue delivery work after inbox rows are saved.
 * Never throws — booking paths must not fail because of delivery enqueue.
 */
export async function enqueueDeliveries(notificationDocs) {
  const list = Array.isArray(notificationDocs)
    ? notificationDocs
    : notificationDocs
      ? [notificationDocs]
      : [];
  if (!list.length) return;

  try {
    const jobs = list.map((doc) => ({
      kind: 'deliver',
      notificationId: doc._id,
      userId: doc.userId,
      type: doc.type,
      title: doc.title,
      body: doc.body,
      requestId: doc.requestId,
      status: 'pending',
      attempts: 0,
      maxAttempts: config.notify.maxAttempts,
      nextAttemptAt: new Date(),
      result: { live: false, push: false, email: false },
    }));
    await NotificationJob.insertMany(jobs);
    // Kick processing without blocking the booking caller
    void processDeliveryQueue();
  } catch (err) {
    console.error('[notify-queue] enqueue failed:', err.message);
  }
}

export function startDeliveryQueueWorker() {
  if (intervalStarted) return;
  intervalStarted = true;
  console.log(
    `[notify-queue] worker started emailFallbackSeconds=${config.notify.emailFallbackSeconds} maxAttempts=${config.notify.maxAttempts}`
  );
  setInterval(() => {
    processDeliveryQueue().catch((e) =>
      console.error('[notify-queue] worker error', e.message)
    );
  }, 1500);
}

/** @type {Promise<void> | null} */
let activeRun = null;

export async function processDeliveryQueue() {
  // Coalesce concurrent callers onto one run that drains the queue
  if (activeRun) {
    await activeRun;
    // If new jobs arrived while we waited, drain again
    if (await hasDueJobs()) {
      return processDeliveryQueue();
    }
    return;
  }

  activeRun = (async () => {
    processing = true;
    try {
      while (await hasDueJobs()) {
        for (let i = 0; i < 20; i++) {
          const job = await NotificationJob.findOneAndUpdate(
            {
              status: 'pending',
              nextAttemptAt: { $lte: new Date() },
            },
            { $inc: { attempts: 1 } },
            { sort: { nextAttemptAt: 1 }, new: true }
          );
          if (!job) break;
          await runJob(job);
        }
      }
    } finally {
      processing = false;
    }
  })();

  try {
    await activeRun;
  } finally {
    activeRun = null;
  }
}

async function hasDueJobs() {
  const n = await NotificationJob.countDocuments({
    status: 'pending',
    nextAttemptAt: { $lte: new Date() },
  });
  return n > 0;
}

/** Wait until the in-flight drain finishes (tests). */
export async function flushDeliveryQueue() {
  await processDeliveryQueue();
  if (activeRun) await activeRun;
}

async function runJob(job) {
  try {
    if (job.kind === 'deliver') {
      await runDeliver(job);
    } else if (job.kind === 'email_fallback') {
      await runEmailFallback(job);
    } else {
      job.status = 'failed';
      job.lastError = `Unknown kind ${job.kind}`;
      await safeSave(job);
    }
  } catch (err) {
    job.lastError = err.message;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      console.error(
        `[notify-queue] FAILED kind=${job.kind} id=${job._id} after ${job.attempts} attempts: ${err.message}`
      );
    } else {
      job.nextAttemptAt = new Date(Date.now() + backoffMs(job.attempts));
      console.warn(
        `[notify-queue] retry kind=${job.kind} id=${job._id} attempt=${job.attempts} next=${job.nextAttemptAt.toISOString()}: ${err.message}`
      );
    }
    await safeSave(job);
  }
}

async function safeSave(job) {
  try {
    await job.save();
  } catch (err) {
    // Job may have been wiped by tests or a concurrent cleanup
    if (err?.name === 'DocumentNotFoundError') return;
    throw err;
  }
}

async function runDeliver(job) {
  const payload = notificationPayload(job);

  // 1) Live WebSocket fan-out
  const liveOk = emitNotificationToUser(job.userId, payload);
  if (liveOk) job.result.live = true;

  // 2) Device push for urgent events to cleaners / business
  let pushAudience = false;
  if (URGENT_TYPES.has(job.type)) {
    const user = await User.findById(job.userId).select('role email name');
    pushAudience = Boolean(user && PUSH_ROLES.has(user.role));
    if (pushAudience) {
      const pushOk = await sendPushToUser(job.userId, {
        title: job.title,
        body: job.body,
        data: {
          type: job.type,
          notificationId: String(job.notificationId),
          requestId: job.requestId ? String(job.requestId) : '',
          link: config.clientOrigin,
        },
      });
      if (pushOk) job.result.push = true;
    }
  }

  // 3) Email fallback only for push audience (cleaners / business), when live+push miss
  if (
    URGENT_TYPES.has(job.type) &&
    pushAudience &&
    !job.result.live &&
    !job.result.push
  ) {
    const runAt = new Date(
      Date.now() + config.notify.emailFallbackSeconds * 1000
    );
    await NotificationJob.create({
      kind: 'email_fallback',
      notificationId: job.notificationId,
      userId: job.userId,
      type: job.type,
      title: job.title,
      body: job.body,
      requestId: job.requestId,
      status: 'pending',
      attempts: 0,
      maxAttempts: config.notify.maxAttempts,
      nextAttemptAt: runAt,
      result: { ...job.result },
    });
  }

  job.status = 'done';
  job.lastError = undefined;
  await safeSave(job);
}

async function runEmailFallback(job) {
  // Skip if user came online, or push somehow succeeded later
  if (isUserLive(job.userId)) {
    job.result.live = true;
    job.status = 'done';
    await safeSave(job);
    return;
  }

  // Re-check sibling deliver result (in case a later retry pushed)
  const deliver = await NotificationJob.findOne({
    kind: 'deliver',
    notificationId: job.notificationId,
    status: 'done',
  }).sort({ updatedAt: -1 });

  if (deliver?.result?.live || deliver?.result?.push) {
    job.result = { ...job.result, ...deliver.result };
    job.status = 'done';
    await safeSave(job);
    return;
  }

  const user = await User.findById(job.userId).select('email name role');
  if (!user?.email) {
    job.status = 'done';
    job.lastError = 'No email on user';
    await safeSave(job);
    return;
  }

  // Only cleaners/business get booking fallback email (same audience as push)
  if (!PUSH_ROLES.has(user.role)) {
    job.status = 'done';
    await safeSave(job);
    return;
  }

  enqueueEmail({
    to: user.email,
    subject: job.title,
    text: `Hi ${user.name},\n\n${job.body}\n\nOpen the app: ${config.clientOrigin}\n`,
    html: `<p>Hi ${user.name},</p><p>${job.body}</p><p><a href="${config.clientOrigin}">Open the app</a></p>`,
    meta: {
      kind: 'booking_fallback',
      notificationId: String(job.notificationId),
      userId: String(job.userId),
      type: job.type,
    },
  });

  job.result.email = true;
  job.status = 'done';
  await safeSave(job);
}

/** Test helpers */
export function _resetDeliveryWorkerFlag() {
  intervalStarted = false;
  processing = false;
}
