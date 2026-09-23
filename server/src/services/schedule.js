/**
 * Parse and validate a preferred cleaning window (minute precision).
 * @returns {{ scheduleStart: Date, scheduleEnd: Date }}
 */
export function parseScheduleRange(scheduleStart, scheduleEnd) {
  if (scheduleStart == null || scheduleEnd == null || scheduleStart === '' || scheduleEnd === '') {
    const err = new Error('scheduleStart and scheduleEnd are required');
    err.status = 400;
    throw err;
  }

  const start = new Date(scheduleStart);
  const end = new Date(scheduleEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('Invalid scheduleStart or scheduleEnd');
    err.status = 400;
    throw err;
  }

  if (!(end.getTime() > start.getTime())) {
    const err = new Error('scheduleEnd must be after scheduleStart');
    err.status = 400;
    throw err;
  }

  // Allow ~1 minute clock skew
  if (start.getTime() < Date.now() - 60_000) {
    const err = new Error('scheduleStart must not be in the past');
    err.status = 400;
    throw err;
  }

  return { scheduleStart: start, scheduleEnd: end };
}
