'use client';

import PublicBar from '../../components/PublicBar';
import { CLEANING_KIT } from '../../lib/cleaningTools';

export default function CleaningToolsPage() {
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
          </div>
        </section>
      ))}
    </div>
  );
}
