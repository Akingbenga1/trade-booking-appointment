import { RequestEvent } from '../models/RequestEvent.js';

export async function recordRequestEvent(requestId, status, by, note) {
  await RequestEvent.create({
    requestId,
    status,
    by,
    note,
    at: new Date(),
  });
}

export async function listRequestEvents(requestId) {
  return RequestEvent.find({ requestId }).sort({ at: 1 }).lean();
}
