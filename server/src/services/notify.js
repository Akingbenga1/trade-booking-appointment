import { Notification } from '../models/Notification.js';
import { enqueueDeliveries } from './deliveryQueue.js';

/**
 * Save inbox row (source of truth), then enqueue live/push/email delivery.
 * Delivery failures never block the caller once the inbox row exists.
 */
export async function notify(userId, { type, title, body, requestId }) {
  const doc = await Notification.create({
    userId,
    type,
    title,
    body,
    requestId,
  });
  await enqueueDeliveries(doc);
  return doc;
}

export async function notifyMany(userIds, payload) {
  if (!userIds.length) return [];
  const docs = userIds.map((userId) => ({
    userId,
    ...payload,
  }));
  const inserted = await Notification.insertMany(docs);
  await enqueueDeliveries(inserted);
  return inserted;
}
