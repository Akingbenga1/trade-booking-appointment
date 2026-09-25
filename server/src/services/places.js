const NOMINATIM = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'trade-booking-appointment/1.0 (places-proxy)';

/**
 * Address autocomplete via Nominatim (OpenStreetMap) — same stack as Leaflet OSM tiles.
 * Proxied so the browser never talks to Nominatim directly.
 * @returns {Promise<Array<{ label: string, address: string, latitude: number, longitude: number }>>}
 */
export async function searchPlaces(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '0');
  url.searchParams.set('limit', '5');

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    const err = new Error('Places search unavailable');
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((hit) => ({
    label: hit.display_name,
    address: hit.display_name,
    latitude: Number(hit.lat),
    longitude: Number(hit.lon),
  }));
}

/**
 * Reverse-geocode a map pin to an address string.
 * @returns {Promise<{ address: string, latitude: number, longitude: number }>}
 */
export async function reverseGeocode(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error('latitude and longitude required');
    err.status = 400;
    throw err;
  }

  const url = new URL(`${NOMINATIM}/reverse`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'json');

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    const err = new Error('Reverse geocode unavailable');
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const address = data?.display_name;
  if (!address) {
    const err = new Error('Could not resolve address for that pin');
    err.status = 400;
    throw err;
  }

  return { address, latitude: lat, longitude: lng };
}
