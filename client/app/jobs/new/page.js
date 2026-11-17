'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PublicBar from '../../../components/PublicBar';
import { api } from '../../../lib/api';

const EMPTY = {
  serviceDetails: '',
  address: '',
  postedBy: 'business',
  businessName: '',
  jobType: 'fixed',
  scheduleStart: '',
  scheduleEnd: '',
  recurrenceUntil: '',
  hours: '',
  payRatePerHour: '',
};

export default function NewJobOfferPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/requests/board', {
        method: 'POST',
        body: {
          ...form,
          scheduleStart: new Date(form.scheduleStart).toISOString(),
          scheduleEnd: new Date(form.scheduleEnd).toISOString(),
          recurrenceUntil: form.recurrenceUntil ? new Date(form.recurrenceUntil).toISOString() : '',
        },
      });
      router.push('/jobs');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="shell">
      <PublicBar
        title="Add a job offer"
        subtitle="This puts the job on the public list. No sign-in is needed, and it does not book a cleaner."
      />
      <form className="card stack public-form" onSubmit={onSubmit}>
        <label>
          Job name
          <input
            required
            maxLength={200}
            value={form.serviceDetails}
            onChange={(event) => setField('serviceDetails', event.target.value)}
          />
        </label>
        <label>
          Address
          <input
            required
            maxLength={300}
            value={form.address}
            onChange={(event) => setField('address', event.target.value)}
          />
        </label>
        <label>
          Who is posting
          <select value={form.postedBy} onChange={(event) => setField('postedBy', event.target.value)}>
            <option value="business">Business</option>
            <option value="personal">Personal client</option>
          </select>
        </label>
        {form.postedBy === 'business' ? (
          <label>
            Business name
            <input
              required
              maxLength={120}
              value={form.businessName}
              onChange={(event) => setField('businessName', event.target.value)}
            />
          </label>
        ) : null}
        <label>
          Schedule
          <select value={form.jobType} onChange={(event) => setField('jobType', event.target.value)}>
            <option value="fixed">One visit</option>
            <option value="recurring_indefinite">Weekly, no end</option>
            <option value="recurring_until">Weekly until a date</option>
            <option value="">One window</option>
          </select>
        </label>
        <label>
          Starts
          <input
            required
            type="datetime-local"
            value={form.scheduleStart}
            onChange={(event) => setField('scheduleStart', event.target.value)}
          />
        </label>
        <label>
          Ends
          <input
            required
            type="datetime-local"
            value={form.scheduleEnd}
            onChange={(event) => setField('scheduleEnd', event.target.value)}
          />
        </label>
        {form.jobType === 'recurring_until' ? (
          <label>
            Last visit date
            <input
              required
              type="date"
              value={form.recurrenceUntil}
              onChange={(event) => setField('recurrenceUntil', event.target.value)}
            />
          </label>
        ) : null}
        <label>
          Hours (optional)
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={form.hours}
            onChange={(event) => setField('hours', event.target.value)}
          />
        </label>
        <label>
          Pay £ per hour (optional)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.payRatePerHour}
            onChange={(event) => setField('payRatePerHour', event.target.value)}
          />
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button disabled={loading} type="submit">
          {loading ? 'Saving…' : 'Add to the job list'}
        </button>
      </form>
    </div>
  );
}
