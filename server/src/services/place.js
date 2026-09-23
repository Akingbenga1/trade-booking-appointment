/**
 * Validate and normalize flat place fields used on cleaning requests and businesses.
 * @returns {{ address: string, latitude: number, longitude: number }}
 */
export function parsePlaceFields({ address, latitude, longitude }) {
  const trimmed = String(address ?? '').trim();
  if (!trimmed) {
    const err = new Error('address is required');
    err.status = 400;
    throw err;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error('latitude and longitude must be numbers');
    err.status = 400;
    throw err;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const err = new Error('latitude/longitude out of range');
    err.status = 400;
    throw err;
  }

  return { address: trimmed, latitude: lat, longitude: lng };
}
