'use client';

import { useEffect, useState } from 'react';
import PublicBar from '../../components/PublicBar';
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

  useEffect(() => {
    api('/api/tools')
      .then((rows) => setTools(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message));
  }, []);

  const groups = groupTools(tools);

  return (
    <div className="shell">
      <PublicBar
        title="Tools and equipment"
        subtitle="Items saved for cleaners and cleaning agencies. No sign-in is needed."
      />
      {error ? <div className="error">{error}</div> : null}
      {tools.length === 0 && !error ? <p className="muted">No tools yet.</p> : null}
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
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
