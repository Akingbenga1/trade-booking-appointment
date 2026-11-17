'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PublicBar from '../../../components/PublicBar';
import { api } from '../../../lib/api';
import { CLEANING_KIT } from '../../../lib/cleaningTools';

export default function NewToolPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [category, setCategory] = useState(CLEANING_KIT[0].id);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/tools', {
        method: 'POST',
        body: { name, detail, category },
      });
      router.push(`/tools#${category}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="shell">
      <PublicBar
        title="Add a tool"
        subtitle="This adds an item to the tools and equipment list. No sign-in is needed."
      />
      <form className="card stack public-form" onSubmit={onSubmit}>
        <label>
          Name
          <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          What it is for
          <textarea
            required
            maxLength={400}
            rows={3}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
        <label>
          Section
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CLEANING_KIT.map((group) => (
              <option key={group.id} value={group.id}>
                {group.title}
              </option>
            ))}
          </select>
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button disabled={loading} type="submit">
          {loading ? 'Saving…' : 'Add to the list'}
        </button>
      </form>
    </div>
  );
}
