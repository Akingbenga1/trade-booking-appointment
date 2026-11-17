'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PublicBar from '../../../components/PublicBar';
import { api } from '../../../lib/api';

export default function NewToolPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const saved = await api('/api/tools', {
        method: 'POST',
        body: { name, detail, category },
      });
      const slug = String(saved.category || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      router.push(`/tools#${slug || 'section'}`);
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
          <input
            required
            maxLength={80}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button disabled={loading} type="submit">
          {loading ? 'Saving…' : 'Add to the list'}
        </button>
      </form>
    </div>
  );
}
