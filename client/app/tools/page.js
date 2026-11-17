'use client';

import { useEffect, useState } from 'react';
import PublicBar from '../../components/PublicBar';
import FilterBar, { matchesQuery } from '../../components/FilterBar';
import { api } from '../../lib/api';

function sectionId(category) {
  const slug = String(category || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'section';
}

function groupTools(rows) {
  const groups = [];
  const byCategory = new Map();
  for (const item of rows) {
    const category = item.category || 'Tools';
    let group = byCategory.get(category);
    if (!group) {
      group = { category, items: [] };
      byCategory.set(category, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export default function CleaningToolsPage() {
  const [tools, setTools] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api('/api/tools')
      .then((rows) => setTools(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message));
  }, []);

  const visible = tools.filter((item) =>
    matchesQuery(query, [item.name, item.detail, item.category, item.contactName, item.email, item.phone])
  );
  const groups = groupTools(visible);

  return (
    <div className="shell">
      <PublicBar
        title="Tools and equipment"
        subtitle="Each item shows who to contact, with a name, email, and phone. No sign-in is needed."
      />
      {error ? <div className="error">{error}</div> : null}
      <form className="card stack" onSubmit={(event) => event.preventDefault()}>
        <FilterBar
          query={query}
          onQuery={setQuery}
          placeholder="Search tool, name, email, or phone"
          count={visible.length}
          total={tools.length}
          active={Boolean(query.trim())}
          onClear={() => setQuery('')}
        />
      </form>
      {tools.length === 0 && !error ? <p className="muted">No tools yet.</p> : null}
      {tools.length > 0 && visible.length === 0 ? <p className="muted">No tools match.</p> : null}
      {groups.length > 0 ? (
        <nav className="public-links" aria-label="Kit sections">
          {groups.map((group) => (
            <a key={group.category} href={`#${sectionId(group.category)}`}>
              {group.category}
            </a>
          ))}
        </nav>
      ) : null}
      {groups.map((group) => (
        <section id={sectionId(group.category)} className="stack kit-section" key={group.category}>
          <h2>{group.category}</h2>
          <div className="tool-grid">
            {group.items.map((item) => (
              <article className="card tool-card" key={item.id}>
                <h3>{item.name}</h3>
                <p className="muted">{item.detail}</p>
                <dl className="tool-contact">
                  <div>
                    <dt>Name</dt>
                    <dd>{item.contactName}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>
                      <a href={`mailto:${item.email}`}>{item.email}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>
                      <a href={`tel:${item.phone}`}>{item.phone}</a>
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
