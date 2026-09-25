import nodemailer from 'nodemailer';
import { config } from '../config.js';

/** @type {{ to: string, subject: string, text: string, html?: string, meta?: object }[]} */
const queue = [];
let processing = false;
let transporter = null;
let intervalStarted = false;

export function isSmtpConfigured() {
  const { user, pass } = config.mailtrap;
  return Boolean(user && pass);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isSmtpConfigured()) return null;
  const { host, port, user, pass } = config.mailtrap;
  transporter = nodemailer.createTransport({
    host,
    port,
    auth: { user, pass },
  });
  return transporter;
}

/** Reset cached transport after env reload / restart. */
export function resetEmailTransport() {
  transporter = null;
}

export function enqueueEmail(job) {
  const id = `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = { ...job, meta: { ...(job.meta || {}), id, enqueuedAt: new Date().toISOString() } };
  queue.push(entry);
  console.log(
    `[email] enqueued id=${id} to=${entry.to} subject="${entry.subject}" queueDepth=${queue.length}`
  );
  void processEmailQueue();
  return id;
}

export function startEmailQueueWorker() {
  if (intervalStarted) return;
  intervalStarted = true;
  const { host, port, user, from } = config.mailtrap;
  console.log(
    `[email] worker started smtpConfigured=${isSmtpConfigured()} host=${host} port=${port} user=${user ? `${user.slice(0, 4)}…` : '(empty)'} from=${from}`
  );
  if (!isSmtpConfigured()) {
    console.warn(
      '[email] MAILTRAP_USER/MAILTRAP_PASS missing — magic links will be logged to console only'
    );
  }
  setInterval(() => {
    processEmailQueue().catch((e) => console.error('[email] queue error', e.message));
  }, 2000);
}

async function processEmailQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      await sendEmail(job);
    }
  } finally {
    processing = false;
  }
}

async function sendEmail(job) {
  const id = job.meta?.id || 'unknown';
  const attempts = Number(job.meta?.attempts || 0) + 1;
  const maxAttempts = Number(job.meta?.maxAttempts || 5);
  job.meta = { ...(job.meta || {}), attempts };

  const transport = getTransporter();
  if (!transport) {
    console.log(
      `[email] send SKIPPED (no SMTP) id=${id} to=${job.to}\n${job.text}`
    );
    return;
  }
  try {
    console.log(`[email] sending id=${id} to=${job.to} attempt=${attempts}…`);
    const info = await transport.sendMail({
      from: config.mailtrap.from,
      to: job.to,
      subject: job.subject,
      text: job.text,
      html: job.html || undefined,
    });
    console.log(
      `[email] sent id=${id} to=${job.to} messageId=${info.messageId || '(none)'} response=${info.response || '(none)'}`
    );
  } catch (err) {
    console.error(`[email] FAILED id=${id} to=${job.to}: ${err.message}`);
    if (attempts < maxAttempts) {
      const delay = Math.min(32_000, 1000 * 2 ** attempts);
      console.warn(`[email] retry id=${id} in ${delay}ms attempt=${attempts}/${maxAttempts}`);
      setTimeout(() => {
        queue.push(job);
        void processEmailQueue();
      }, delay);
      return;
    }
    console.error(`[email] giving up id=${id} after ${attempts} attempts`);
  }
}

/** Test helper */
export function _emailQueueDepth() {
  return queue.length;
}
