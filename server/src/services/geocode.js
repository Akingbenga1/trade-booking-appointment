import { config } from '../config.js';

/**
 * Forward-geocode a free-text address via OpenCage (or stub for local/tests).
 * @returns {{ address: string, lat: number, lng: number }}
 */
export async function geocodeAddress(address) {
  const trimmed = String(address || '').trim();
  if (!trimmed) {
    const err = new Error('Address is required');
    err.status = 400;
    throw err;
  }

  if (config.opencageStub) {
    return { address: trimmed, lat: 51.5074, lng: -0.1278 };
  }

  if (!config.opencageApiKey) {
    const err = new Error('Geocoding is not configured (OPENCAGE_API_KEY)');
    err.status = 503;
    throw err;
  }

  const url = new URL('https://api.opencagedata.com/geocode/v1/json');
  url.searchParams.set('q', trimmed);
  url.searchParams.set('key', config.opencageApiKey);
  url.searchParams.set('limit', '1');
  url.searchParams.set('no_annotations', '1');

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('Geocoding service unavailable');
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit?.geometry) {
    const err = new Error('Could not geocode that address');
    err.status = 400;
    throw err;
  }

  return {
    address: hit.formatted || trimmed,
    lat: hit.geometry.lat,
    lng: hit.geometry.lng,
  };
}
