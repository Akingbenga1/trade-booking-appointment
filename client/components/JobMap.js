'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

/**
 * Read-only Leaflet map showing a job address pin (cleaner offer / assigned job).
 */
export default function JobMap({ address, latitude, longitude, height = 200 }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  const lat = Number(latitude);
  const lng = Number(longitude);
  const ready = Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    if (!ready || !mapRef.current) return undefined;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current) return;

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const map = L.map(mapRef.current, {
        zoomControl: true,
        dragging: true,
        scrollWheelZoom: false,
      }).setView([lat, lng], 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      L.marker([lat, lng]).addTo(map).bindPopup(address || 'Job location');
      mapInstance.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    })();

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [lat, lng, address, ready]);

  if (!ready) {
    return <p className="muted">Map unavailable for this job.</p>;
  }

  return (
    <div className="stack">
      {address ? <div className="muted">{address}</div> : null}
      <div className="map-frame" ref={mapRef} style={{ height }} />
    </div>
  );
}
