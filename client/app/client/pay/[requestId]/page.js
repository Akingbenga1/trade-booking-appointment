'use client';

import { Suspense } from 'react';
import PayForServicePage from './PayForServiceClient';

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="shell">
          <p className="muted">Loading payment…</p>
        </div>
      }
    >
      <PayForServicePage />
    </Suspense>
  );
}
