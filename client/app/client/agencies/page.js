'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { StatusBadge, TopBar, useRequireRole } from '../../../components/ui';
import FilterBar, { matchesQuery } from '../../../components/FilterBar';

const SECTION_LABELS = {
  all: 'All three lists',
  available: 'Available',
  nearby: 'Nearby',
  interested: 'Showed interest',
};

function matchesAgency(query, row) {
  return matchesQuery(query, [row.name, row.phone, row.address, row.jobLabel]);
}

export default function BusinessAgenciesPage() {
  const router = useRouter();
  const user = useRequireRole('business');
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState('');
  const [board, setBoard] = useState(null);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('all');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pickingId, setPickingId] = useState('');

  useEffect(() => {
    if (user?.mustSetPassword) router.replace('/auth/set-password');
  }, [user, router]);

  const loadBoard = useCallback(async (id) => {
    if (!id) {
      setBoard(null);
      return;
    }
    const data = await api(`/api/businesses/${id}/agencies`);
    setBoard(data);
    setError('');
  }, []);

  useEffect(() => {
    if (!user || user.mustSetPassword) return;
    api('/api/businesses')
      .then((list) => {
        setBusinesses(list);
        setBusinessId((current) => current || (list[0]?._id ? String(list[0]._id) : ''));
      })
      .catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!user || user.mustSetPassword || !businessId) return;
    loadBoard(businessId).catch((err) => setError(err.message));
  }, [user, businessId, loadBoard]);

  async function pick(row) {
    setError('');
    setMessage('');
    setPickingId(String(row.id));
    try {
      await api(`/api/requests/${row.requestId}/pick-agency`, {
        method: 'POST',
        body: { agencyId: row.agencyId },
      });
      setMessage(`${row.name} is selected for ${row.jobLabel}.`);
      await loadBoard(businessId);
    } catch (err) {
      setError(err.message);
    } finally {
      setPickingId('');
    }
  }

  if (!user || user.mustSetPassword) return null;

  const available = (board?.available || []).filter((row) => matchesAgency(query, row));
  const nearby = (board?.nearby || []).filter((row) => matchesAgency(query, row));
  const interested = (board?.interested || []).filter((row) => matchesAgency(query, row));
  const show = {
    available: section === 'all' || section === 'available',
    nearby: section === 'all' || section === 'nearby',
    interested: section === 'all' || section === 'interested',
  };
  const shownCount =
    (show.available ? available.length : 0) +
    (show.nearby ? nearby.length : 0) +
    (show.interested ? interested.length : 0);
  const totalCount =
    (show.available ? board?.available?.length || 0 : 0) +
    (show.nearby ? board?.nearby?.length || 0 : 0) +
    (show.interested ? board?.interested?.length || 0 : 0);
  const radius = board?.radiusKm;

  return (
    <div className="shell">
      <TopBar title="Agencies" />
      <p className="muted">
        <Link href="/client">Back to business home</Link>
      </p>
      {message ? <div className="success">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="card stack">
        <div>
          <h2 style={{ marginBottom: 6 }}>Agencies</h2>
          <p className="muted">
            Available means the agency has staff who are on duty. Nearby means the office, or an
            on-duty staff member, is within {radius || 20} km of this business address. Showed
            interest means the agency asked to take one of this business’s jobs.
          </p>
        </div>

        <label>
          Business
          <select value={businessId} onChange={(event) => setBusinessId(event.target.value)}>
            {businesses.length === 0 ? <option value="">No businesses yet</option> : null}
            {businesses.map((row) => (
              <option key={row._id} value={row._id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>

        <FilterBar
          query={query}
          onQuery={setQuery}
          placeholder="Search name, address, phone, or job"
          count={shownCount}
          total={totalCount}
          active={Boolean(query) || section !== 'all'}
          onClear={() => {
            setQuery('');
            setSection('all');
          }}
        >
          <select value={section} onChange={(event) => setSection(event.target.value)} aria-label="Which list">
            {Object.entries(SECTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FilterBar>

        {show.available ? (
          <AgencySection
            title="Available agencies"
            empty={query ? 'No agencies match.' : 'No agencies have staff on duty right now.'}
            rows={available}
            renderMeta={(row) =>
              `${row.availableStaff} staff on duty`
            }
          />
        ) : null}

        {show.nearby ? (
          <AgencySection
            title="Nearby agencies"
            empty={
              query
                ? 'No agencies match.'
                : board?.business?.address
                  ? `No agencies are within ${radius} km of ${board.business.address}.`
                  : 'No agencies are close to this business.'
            }
            rows={nearby}
            renderMeta={(row) =>
              `${row.distanceKm} km away${row.availableStaff ? ` · ${row.availableStaff} staff on duty` : ''}`
            }
          />
        ) : null}

        {show.interested ? (
          <section className="stack">
            <h3 style={{ margin: 0 }}>Showed interest</h3>
            {interested.length === 0 ? (
              <p className="muted">
                {query ? 'No agencies match.' : 'No agency has shown interest in this business’s jobs.'}
              </p>
            ) : (
              <div className="list">
                {interested.map((row) => (
                  <div className="item stack" key={String(row.id)}>
                    <div className="row">
                      <strong>{row.name}</strong>
                      <StatusBadge status={row.status} />
                      {row.jobStatus ? <StatusBadge status={row.jobStatus} /> : null}
                      {row.jobArchived ? <span className="muted">Archived job</span> : null}
                    </div>
                    <div>{row.jobLabel}</div>
                    <div className="muted">
                      {row.phone}
                      {row.address ? ` · ${row.address}` : ''}
                    </div>
                    {row.status === 'interested' && row.jobStatus === 'open' && !row.jobArchived ? (
                      <div>
                        <button
                          type="button"
                          disabled={pickingId === String(row.id)}
                          onClick={() => pick(row)}
                        >
                          {pickingId === String(row.id) ? 'Selecting…' : `Pick ${row.name}`}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function AgencySection({ title, empty, rows, renderMeta }) {
  return (
    <section className="stack">
      <h3 style={{ margin: 0 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="list">
          {rows.map((row) => (
            <div className="item stack" key={String(row.id)}>
              <strong>{row.name}</strong>
              <div className="muted">{renderMeta(row)}</div>
              <div className="muted">
                {row.phone}
                {row.address ? ` · ${row.address}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
