'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem 1.5rem', textAlign: 'center', color: '#0f172a' }}>
 <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Something went wrong</h2>
 <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '480px', margin: '0 auto 1.5rem auto' }}>
 {error?.message || 'An unexpected application error occurred.'}
 </p>
 <button
 onClick={() => reset()}
 style={{
 padding: '0.5rem 1rem',
 background: '#0f172a',
 color: '#ffffff',
 border: 'none',
 borderRadius: '4px',
 fontSize: '0.8rem',
 fontWeight: 600,
 cursor: 'pointer',
 }}
 >
 Try again
 </button>
 </body>
 </html>
 );
}
