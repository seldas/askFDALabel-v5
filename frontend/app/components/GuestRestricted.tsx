'use client';

/*
 * Shown in place of a page the guest account cannot use.
 *
 * Query history and saved preferences are per-user state stored against a row
 * that every anonymous visitor shares, so one visitor would be reading and
 * overwriting another's. The entry points are hidden in the header, but the
 * routes are still reachable by typing the URL — this is what they get.
 *
 * The API returns 403 for these features independently; this is the friendly
 * face of the same rule, not the rule itself.
 */

import Link from 'next/link';

export default function GuestRestricted({ feature }: { feature: string }) {
  return (
    <div
      style={{
        padding: '3rem 1.5rem',
        maxWidth: '560px',
        margin: '0 auto',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }} aria-hidden="true">
        🔒
      </div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--afl-n-900, #0f172a)', marginBottom: '0.5rem' }}>
        {feature} is not available for guests
      </h1>
      <p style={{ color: 'var(--afl-n-500, #64748b)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        The guest account is shared by everyone browsing without signing in, so it
        cannot keep per-account data. Register or sign in with your own account to
        use {feature.toLowerCase()}.
      </p>
      <Link
        href="/"
        style={{
          display: 'inline-block',
          padding: '0.6rem 1.25rem',
          borderRadius: '8px',
          background: 'var(--afl-info-500, #2563eb)',
          color: '#fff',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Back to Search
      </Link>
    </div>
  );
}
