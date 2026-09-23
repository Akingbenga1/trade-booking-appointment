'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = { latitude: 51.5074, longitude: -0.1278 };

/**
 * Address autocomplete + Leaflet map with a draggable pin.
 * value: { address, latitude, longitude } — latitude/longitude null until a place is chosen.
 */
export default function LocationPicker({
  value,
  onChange,
  label = 'Address',
  required = true,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const LRef = useRef(null);
  const reverseLock = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [query, setQuery] = useState(value?.address || '');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hint, setHint] = useState('');

  const hasPin =
    value?.latitude != null &&
    value?.longitude != null &&
    Number.isFinite(Number(value.latitude)) &&
    Number.isFinite(Number(value.longitude));

  async function applyReverse(lat, lng) {
    reverseLock.current = true;
    setHint('Updating address from pin…');
    try {
      const place = await api(`/api/places/reverse?lat=${lat}&lng=${lng}`);
      setQuery(place.address);
      onChangeRef.current({
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
      });
      setHint('');
    } catch (err) {
      setHint(err.message || 'Could not update address');
    } finally {
      reverseLock.current = false;
    }
  }

  const applyReverseRef = useRef(applyReverse);
  applyReverseRef.current = applyReverse;

  useEffect(() => {
    setQuery(value?.address || '');
  }, [value?.address]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current) return;
      LRef.current = L;

      // Fix default marker icons under bundlers
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (mapInstance.current) return;

      const center = hasPin
        ? [Number(value.latitude), Number(value.longitude)]
        : [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude];

      const map = L.map(mapRef.current).setView(center, hasPin ? 15 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      mapInstance.current = map;

      if (hasPin) {
        const marker = L.marker(center, { draggable: true }).addTo(map);
        marker.on('dragend', async () => {
          const { lat, lng } = marker.getLatLng();
          await applyReverseRef.current(lat, lng);
        });
        markerRef.current = marker;
      }

      setTimeout(() => map.invalidateSize(), 50);
    })();

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        markerRef.current = null;
      }
    };
    // Mount once; pin updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = LRef.current;
    const map = mapInstance.current;
    if (!L || !map || reverseLock.current) return;

    if (!hasPin) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      return;
    }

    const latlng = [Number(value.latitude), Number(value.longitude)];
    if (!markerRef.current) {
      const marker = L.marker(latlng, { draggable: true }).addTo(map);
      marker.on('dragend', async () => {
        const { lat, lng } = marker.getLatLng();
        await applyReverseRef.current(lat, lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(latlng);
    }
    map.setView(latlng, Math.max(map.getZoom(), 15));
  }, [value?.latitude, value?.longitude, hasPin]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return undefined;
    }
    // Don't search when query matches the confirmed place address
    if (hasPin && q === (value?.address || '').trim()) {
      setSuggestions([]);
      return undefined;
    }

    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api(`/api/places/search?q=${encodeURIComponent(q)}`);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, hasPin, value?.address]);

  function pickSuggestion(s) {
    setSuggestions([]);
    setQuery(s.address);
    setHint('');
    onChange({
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
    });
  }

  function onType(text) {
    setQuery(text);
    // Typing clears the confirmed pin until they pick again
    onChange({
      address: text,
      latitude: null,
      longitude: null,
    });
  }

  return (
    <div className="stack location-picker">
      <label>
        {label}
        <input
          required={required}
          value={query}
          onChange={(e) => onType(e.target.value)}
          autoComplete="off"
          placeholder="Start typing an address…"
        />
      </label>
      {searching ? <p className="muted">Searching…</p> : null}
      {suggestions.length > 0 ? (
        <ul className="place-suggestions">
          {suggestions.map((s) => (
            <li key={`${s.latitude},${s.longitude},${s.label}`}>
              <button type="button" className="secondary" onClick={() => pickSuggestion(s)}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!hasPin && query.trim() ? (
        <p className="muted">Pick a suggestion or place will not submit.</p>
      ) : null}
      {hint ? <p className="muted">{hint}</p> : null}
      <div className="map-frame" ref={mapRef} />
      <p className="muted">Drag the pin to fine-tune; the address updates from the new spot.</p>
    </div>
  );
}
