/** True when a map pin coord is present (null/'' must not pass — Number(null) is 0). */
export function isFiniteCoord(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return false;
  }
  return Number.isFinite(Number(value));
}

export function hasPlacePin(place) {
  return Boolean(
    place?.address?.trim() && isFiniteCoord(place.latitude) && isFiniteCoord(place.longitude)
  );
}
