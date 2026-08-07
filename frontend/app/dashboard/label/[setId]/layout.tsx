'use client';

/*
 * Label workspace shell.
 *
 * Replaces the two copy-pasted label shells: the one inside this page and the
 * one in drugtox/[setId], which reimplemented the same tab bar and navigated
 * between them with full page reloads.
 *
 * Responsibilities kept here because they are label-level, not tool-level:
 * fetching the label once, the identity header, and the tool strip. Each tool
 * is now its own route under this layout, so it is addressable, back/forward
 * works, and only the active tool mounts.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import Header from '../../../components/Header';
import { Badge } from '../../../platform/primitives';
import { LabelToolStrip } from '../../../platform/ToolLauncher';
import { LabelContextProvider } from './LabelContext';
import type { LabelData } from './types';
import './labelShell.css';
import './label.css';
import '../../dashboard.css';

/** Maps the trailing route segment to the registry tool id, for highlighting. */
const SEGMENT_TO_TOOL: Record<string, string> = {
  faers: 'label-faers',
  tox: 'label-tox',
  examine: 'label-examine',
  deepdive: 'label-deepdive',
};

export default function LabelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ setId: string }>;
}) {
  const { setId } = use(params);
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const splId = searchParams.get('spl_id');

  const [data, setData] = useState<LabelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = `/api/dashboard/label/${setId}?json=1${splId ? `&spl_id=${splId}` : ''}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setId, splId, reloadToken]);

  const title = data?.brand_name || data?.drug_name || setId;

  useEffect(() => {
    if (!data) return;
    const parts = [data.brand_name || data.drug_name, data.generic_name, data.effective_time]
      .filter(Boolean)
      .join(' - ');
    if (parts) document.title = parts;
  }, [data]);

  const activeToolId = useMemo(() => {
    const segment = pathname.split('/').filter(Boolean).pop() || '';
    return SEGMENT_TO_TOOL[segment] ?? 'label-reader';
  }, [pathname]);

  const ctx = useMemo(
    () => ({ setId, splId, data, loading, error, refresh }),
    [setId, splId, data, loading, error, refresh],
  );

  const isStale = data?.openfda_status === 'Archived' || data?.is_latest === false;
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  const hideCrumbsAndTools = activeToolId !== 'label-reader';

  return (
    <div className="afl-label-shell">
      <Header activeApp="dashboard" />

      <div className="afl-label-shell__scroll">
        <div className="afl-label-shell__inner">
          {!hideCrumbsAndTools && (
            <nav className="afl-label-crumbs">
              <Link href="/dashboard">Dashboard</Link>
              <span aria-hidden="true">›</span>
              <span className="afl-label-crumbs__current">{title}</span>
            </nav>
          )}

          {error ? (
            <div className="afl-label-alert" role="alert">
              Could not load this label: {error}
            </div>
          ) : null}

          {data ? (
            <section
              className={`afl-label-identity${isStale ? ' afl-label-identity--stale' : ''}`}
              aria-label="Label identity"
              style={{
                background: (data?.openfda_status === 'Archived' || data?.is_latest === false) ? '#fdfbf7' : '#ffffff',
                padding: '24px',
                borderRadius: '16px',
                boxShadow: (data?.openfda_status === 'Archived' || data?.is_latest === false) ? '0 4px 20px rgba(60,45,30,0.04)' : '0 4px 20px rgba(0,0,0,0.04)',
                border: (data?.openfda_status === 'Archived' || data?.is_latest === false) ? '1px solid #dcd3bf' : '1px solid #e2e8f0',
                marginBottom: '20px'
              }}
            >
              <div className="afl-label-identity__title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <h1 className="afl-label-identity__title" style={{ margin: 0, textTransform: 'capitalize' }}>
                  {[data.brand_name || data.drug_name, data.effective_time]
                    .filter(Boolean)
                    .join(' - ')
                    .toLowerCase()}
                </h1>
                <div className="afl-label-identity__badges" style={{ display: 'flex', gap: '8px' }}>
                  {data.label_format ? (
                    <Badge tone={data.label_format === 'PLR' ? 'success' : 'neutral'}>
                      {data.label_format}
                    </Badge>
                  ) : null}
                  {data.is_rld ? <Badge tone="danger">RLD</Badge> : null}
                  {data.openfda_status ? (
                    <Badge tone={data.openfda_status === 'Current' ? 'info' : 'warn'}>
                      {data.openfda_status}
                    </Badge>
                  ) : null}
                </div>
              </div>

              {data.generic_name ? (
                <p className="afl-label-identity__generic" style={{ margin: '6px 0 16px 0', color: '#64748b', fontSize: '0.95rem' }}>{data.generic_name}</p>
              ) : null}

              {data.has_boxed_warning && (
                <div className="meta-item" style={{ marginBottom: '16px', backgroundColor: '#fff1f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '1.3rem', color: '#e11d48' }}>{"\u26A0"}</span>
                    <div>
                        <span style={{ display: 'block', fontSize: '0.68rem', color: '#e11d48', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>Clinical Alert</span>
                        <span style={{ fontWeight: 700, color: '#9f1239', fontSize: '0.9rem' }}>Boxed Warning Information Present</span>
                    </div>
                </div>
              )}

              <div className="label-meta-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                  <div className="meta-item">
                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.1em', marginBottom: '4px' }}>Manufacturer</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, color: '#334155', fontSize: '0.9rem' }}>{data.manufacturer_name || 'N/A'}</span>
                        {data.companies && data.companies.length > 0 && (
                          <button 
                            onClick={() => setCompanyModalOpen(true)} 
                            style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', color: '#64748b' }}
                          >
                            DETAILS
                          </button>
                        )}
                      </div>
                  </div>
                  <div className="meta-item">
                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.1em', marginBottom: '4px' }}>Market Category</span>
                      <span style={{ fontWeight: 700, color: '#334155', fontSize: '0.9rem' }}>{data.metadata?.market_category || data.document_type || 'N/A'}</span>
                  </div>
                  <div className="meta-item">
                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.1em', marginBottom: '4px' }}>Set ID</span>
                      <span style={{ fontWeight: 700, color: '#334155', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{data.set_id || 'N/A'}</span>
                  </div>
                  <div className="meta-item">
                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.1em', marginBottom: '4px' }}>Application No.</span>
                      <span style={{ fontWeight: 700, color: '#334155', fontSize: '0.9rem', fontFamily: 'ui-monospace, monospace' }}>{data.application_number || 'N/A'}</span>
                  </div>
              </div>
            </section>
          ) : null}

          {companyModalOpen && data?.companies && (
            <div onClick={() => setCompanyModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', backdropFilter: 'blur(4px)' }}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(550px, 95vw)', maxHeight: 'min(600px, 85vh)', background: 'white', borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Company Details</h3><p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Associated manufacturers and distributors</p></div>
                  <button onClick={() => setCompanyModalOpen(false)} style={{ background: 'white', border: '1px solid #e2e8f0', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {data.companies.map((comp: any, idx: number) => (
                    <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem', marginBottom: '4px' }}>{comp.name || 'Unknown Company'}</div>
                      {comp.role && <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>{comp.role}</div>}
                      {comp.duns && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>DUNS: {comp.duns}</div>}
                      {comp.address && <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>Address: {comp.address}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ padding: '20px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setCompanyModalOpen(false)} style={{ padding: '10px 24px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 800, cursor: 'pointer' }}>CLOSE</button>
                </div>
              </div>
            </div>
          )}

          {!hideCrumbsAndTools && (
            <div className="afl-label-tools">
              <LabelToolStrip setId={setId} activeToolId={activeToolId} />
            </div>
          )}

          <div className="afl-label-content">
            <LabelContextProvider value={ctx}>{children}</LabelContextProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
