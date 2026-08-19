'use client';

/*
 * Shown in place of a page the current account may not use.
 *
 * Two rules land here. Query history and saved preferences are per-user state
 * on a row every anonymous visitor shares, so the guest account cannot use
 * them. LabelChat, Web-test and Local Database Search are developer-only. In
 * both cases the entry points are hidden in the header, but the routes are
 * still reachable by typing the URL — this is what they get.
 *
 * The API returns 403 for these features independently; this is the friendly
 * face of the same rule, not the rule itself.
 */

import Link from 'next/link';

export default function AccessRestricted({
  feature,
  title,
  body,
}: {
  feature: string;
  /** Overrides the heading; defaults to the guest wording. */
  title?: string;
  /** Overrides the explanation; defaults to the guest wording. */
  body?: string;
}) {
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
        {title ?? `${feature} is not available for guests`}
      </h1>
      <p style={{ color: 'var(--afl-n-500, #64748b)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        {body ??
          `The guest account is shared by everyone browsing without signing in, so it cannot keep per-account data. Register or sign in with your own account to use ${feature.toLowerCase()}.`}
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
