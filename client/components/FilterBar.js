'use client';

export function matchesQuery(query, parts) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => String(part || '').toLowerCase().includes(needle));
}

export default function FilterBar({
  query,
  onQuery,
  placeholder = 'Search',
  children,
  count,
  total,
  onClear,
  active,
}) {
  return (
    <div className="filter-bar">
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {children}
      {active ? (
        <button type="button" className="secondary" onClick={onClear}>
          Clear
        </button>
      ) : null}
      {total != null ? (
        <p className="muted filter-count">
          {count === total ? `${total} shown` : `${count} of ${total}`}
        </p>
      ) : null}
    </div>
  );
}
