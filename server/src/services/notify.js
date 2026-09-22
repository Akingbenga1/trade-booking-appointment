import { Notification } from '../models/Notification.js';

export async function notify(userId, { type, title, body, requestId }) {
  return Notification.create({
    userId,
    type,
    title,
    body,
    requestId,
  });
}

export async function notifyMany(userIds, payload) {
  if (!userIds.length) return [];
  const docs = userIds.map((userId) => ({
    userId,
    ...payload,
  }));
  return Notification.insertMany(docs);
}
