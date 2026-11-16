'use client';

import Link from 'next/link';

export default function PublicBar({ title, subtitle }) {
  return (
    <div className="topbar public-top">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      <div className="public-links">
        <Link href="/jobs">Job offers</Link>
        <Link href="/tools">Tools and equipment</Link>
        <Link href="/">Sign in</Link>
      </div>
    </div>
  );
}
