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

function Fact({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <span className="afl-label-fact__label">{label}</span>
      <span className={`afl-label-fact__value${mono ? ' afl-label-fact__value--mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

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

  return (
    <div className="afl-label-shell">
      <Header activeApp="dashboard" />

      <div className="afl-label-shell__scroll">
        <div className="afl-label-shell__inner">
          <nav className="afl-label-crumbs">
            <Link href="/dashboard">Dashboard</Link>
            <span aria-hidden="true">›</span>
            <span className="afl-label-crumbs__current">{title}</span>
          </nav>

          {error ? (
            <div className="afl-label-alert" role="alert">
              Could not load this label: {error}
            </div>
          ) : null}

          {data ? (
            <section
              className={`afl-label-identity${isStale ? ' afl-label-identity--stale' : ''}`}
              aria-label="Label identity"
            >
              <div className="afl-label-identity__title-row">
                <h1 className="afl-label-identity__title">
                  {[data.brand_name || data.drug_name, data.effective_time]
                    .filter(Boolean)
                    .join(' - ')
                    .toLowerCase()}
                </h1>
                <div className="afl-label-identity__badges">
                  {data.label_format ? (
                    <Badge tone={data.label_format === 'PLR' ? 'success' : 'neutral'}>
                      {data.label_format}
                    </Badge>
                  ) : null}
                  {data.is_rld ? <Badge tone="danger">RLD</Badge> : null}
                  {data.is_rs ? <Badge tone="success">RS</Badge> : null}
                  {data.openfda_status ? (
                    <Badge tone={data.openfda_status === 'Current' ? 'info' : 'warn'}>
                      {data.openfda_status}
                    </Badge>
                  ) : null}
                </div>
              </div>

              {data.generic_name ? (
                <p className="afl-label-identity__generic">{data.generic_name}</p>
              ) : null}

              {data.has_boxed_warning ? (
                <div className="afl-label-alert">
                  <span aria-hidden="true">⚠</span>
                  Boxed warning present on this label
                </div>
              ) : null}

              <div className="afl-label-identity__facts">
                <Fact label="Manufacturer" value={data.manufacturer_name} />
                <Fact label="Market category" value={data.document_type} />
                <Fact label="Application no." value={data.application_number} />
                <Fact label="Set ID" value={data.set_id} mono />
              </div>
            </section>
          ) : null}

          <div className="afl-label-tools">
            <LabelToolStrip setId={setId} activeToolId={activeToolId} />
          </div>

          <div className="afl-label-content">
            <LabelContextProvider value={ctx}>{children}</LabelContextProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
