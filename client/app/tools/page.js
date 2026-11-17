'use client';

import { useEffect, useState } from 'react';
import PublicBar from '../../components/PublicBar';
import { api } from '../../lib/api';
import { CLEANING_KIT } from '../../lib/cleaningTools';

export default function CleaningToolsPage() {
  const [added, setAdded] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/tools')
      .then((rows) => setAdded(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="shell">
      <PublicBar
        title="Tools and equipment"
        subtitle="What a cleaner or a cleaning agency should have before taking jobs. No sign-in is needed."
      />
      <p>
        A basic kit is a vacuum, a mop, colour-coded cloths, a few labelled products, gloves, and a wet floor sign.
        Larger sites add machines. Replace cloths, bags, and liners as they wear out.
      </p>
      <p className="muted">
        Do not mix cleaning products. Bleach mixed with another cleaner can give off a dangerous gas.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <nav className="public-links" aria-label="Kit sections">
        {CLEANING_KIT.map((group) => (
          <a key={group.id} href={`#${group.id}`}>
            {group.title}
          </a>
        ))}
      </nav>
      {CLEANING_KIT.map((group) => (
        <section id={group.id} className="stack kit-section" key={group.id}>
          <div>
            <h2>{group.title}</h2>
            <p className="muted">{group.intro}</p>
          </div>
          <div className="tool-grid">
            {group.items.map((item) => (
              <article className="card tool-card" key={item.name}>
                <h3>{item.name}</h3>
                <p className="muted">{item.detail}</p>
              </article>
            ))}
            {added
              .filter((item) => item.category === group.id)
              .map((item) => (
                <article className="card tool-card" key={item.id}>
                  <h3>{item.name}</h3>
                  <p className="muted">{item.detail}</p>
                  <p className="job-kind">Added</p>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
