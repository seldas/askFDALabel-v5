'use client';

/*
 * Query results — the window Search opens.
 *
 * The whole criteria tree travels in the URL, so this page is self-contained:
 * reloadable, bookmarkable, and shareable, which is what makes "View Query
 * (permanent link)" nothing more than a copy of the current address.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Page } from '../platform/primitives';
import {
  ResultsTable,
  type LabelRow,
  type ResultSet,
  type ResultView,
  type SortState,
} from '../querybuilder/ResultsTable';
import { QUERY_PARAM, decodeQuery, resultsPath } from '../querybuilder/queryUrl';
import type { WireQuery } from '../querybuilder/types';
import '../querybuilder/querybuilder.css';

const PAGE_SIZE = 50;

function summarizeQuery(query: WireQuery | null): string {
  if (!query || !query.groups || query.groups.length === 0) return 'All Labels';
  const parts: string[] = [];
  for (const group of query.groups) {
    if (!group.criteria) continue;
    for (const c of group.criteria as any[]) {
      if (c.type === 'fullText' && c.text) {
        parts.push(`Full Text: "${c.text}"`);
      } else if (c.type === 'productName' && c.text) {
        parts.push(`Product Name: "${c.text}"`);
      } else if (c.type === 'labelingSection' && c.text) {
        parts.push(`Section (${(c.sections || []).join(', ') || 'All'}): "${c.text}"`);
      } else if (c.type === 'pharmClass' && (c.terms || c.text)) {
        const termsStr = Array.isArray(c.terms) ? c.terms.join(', ') : c.text;
        parts.push(`Pharm Class: ${termsStr}`);
      } else if (c.type === 'identifier' && c.text) {
        parts.push(`Identifier: ${c.text}`);
      } else if (c.type === 'meddra' && (c.terms || c.text)) {
        const termsStr = Array.isArray(c.terms) ? c.terms.join(', ') : c.text;
        parts.push(`MedDRA (${c.level || 'PT'}): ${termsStr}`);
      } else if (c.type === 'labelingType' && c.values?.length) {
        parts.push(`Label Type: ${c.values.join(', ')}`);
      } else if (c.type === 'applicationType') {
        const appParts = [];
        if (c.values?.length) appParts.push(c.values.join(', '));
        if (c.isRldRs) appParts.push('RLD/RS');
        if (c.excludeRepackager) appParts.push('Excl. Repackager');
        if (appParts.length) parts.push(`App Type: ${appParts.join('; ')}`);
      } else if (c.type === 'route' && c.values?.length) {
        parts.push(`Route: ${c.values.join(', ')}`);
      } else if (c.type === 'marketStatus') {
        const msParts = [];
        if (c.status) msParts.push(c.status);
        if (c.startDateMin) msParts.push(`Min: ${c.startDateMin}`);
        if (c.startDateMax) msParts.push(`Max: ${c.startDateMax}`);
        if (c.values?.length) msParts.push(c.values.join(', '));
        if (msParts.length) parts.push(`Market Status: ${msParts.join(' ')}`);
      }
    }
  }
  return parts.length > 0 ? parts.join('; ') : 'Label Query';
}

function ResultsPage() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get(QUERY_PARAM);
  const targetDb = searchParams.get('target_db') || 'oracle';

  const query = useMemo<WireQuery | null>(() => decodeQuery(encoded), [encoded]);

  const [data, setData] = useState<ResultSet | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorQuery, setErrorQuery] = useState<string | null>(null);
  const [view, setView] = useState<ResultView>('basic');
  const [offset, setOffset] = useState(0);
  const [sortState, setSortState] = useState<SortState>({ sort: 'revised_date', dir: 'desc' });
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // A changed query means the old page number is meaningless.
  useEffect(() => {
    setOffset(0);
  }, [encoded]);

  useEffect(() => {
    if (!query) {
      setBusy(false);
      setError(
        encoded
          ? 'This results link is not readable. Run the search again from the query builder.'
          : 'No query was provided.',
      );
      setErrorQuery(null);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);
    setErrorQuery(null);

    (async () => {
      try {
        const res = await fetch('/api/labelquery/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            limit: PAGE_SIZE,
            offset,
            sort: sortState.sort,
            dir: sortState.dir,
            target_db: targetDb,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          const errObj = new Error(json.error || `Search failed (${res.status})`);
          (errObj as any).query = json.query || json.sql || null;
          throw errObj;
        }
        setData(json as ResultSet);
        setErrorQuery(null);

        // Record search in user query history on initial search execution (offset === 0)
        if (offset === 0 && query) {
          const currentLink = typeof window !== 'undefined' 
            ? (window.location.pathname + window.location.search) 
            : resultsPath(query, targetDb as any);
          fetch('/api/dashboard/query_history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query_title: summarizeQuery(query),
              query_link: currentLink,
              query_json: query,
              result_count: json.total || 0,
              target_db: targetDb
            })
          }).catch(() => {});
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setErrorQuery(err?.query || null);
          setData(null);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query, encoded, offset, sortState]);

  const onSort = useCallback((sort: string) => {
    setOffset(0);
    setSortState((prev) =>
      prev.sort === sort
        ? { sort, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : // Dates are most useful newest-first; names A–Z.
          { sort, dir: sort === 'revised_date' || sort === 'approval_year' ? 'desc' : 'asc' },
    );
  }, []);

  const download = useCallback(
    async (format: 'csv' | 'xlsx') => {
      if (!query || downloading) return;
      setDownloading(format);
      setError(null);
      try {
        const res = await fetch('/api/labelquery/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, format, sort: sortState.sort, dir: sortState.dir, target_db: targetDb }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || `Download failed (${res.status})`);
        }
        const blob = await res.blob();
        const name =
          /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] ||
          `FDALabel_Query.${format}`;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDownloading(null);
      }
    },
    [downloading, query, sortState],
  );

  const copyPermalink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link. Copy it from the address bar instead.');
    }
  }, []);

  const rows: LabelRow[] = data?.results || [];
  const total = data?.total || 0;
  // What the pager can reach. The backend caps the browse window; `total` stays
  // exact so the header can say "most recent 3,000 / 32,422".
  const browsable = data?.browsable ?? total;
  const to = offset + rows.length;

  return (
    <Page>
      <Header />

      <main className="fdl-shell fdl-shell--results">
        <div className="fdl-resultshead">
          <h1 className="fdl-resultshead__count">
            {!query
              ? 'Query results'
              : busy && !data
                ? 'Searching…'
                : data?.capped
                  ? `Most Recent ${browsable.toLocaleString()}/${total.toLocaleString()} Labeling Results`
                  : `${total.toLocaleString()} labeling result${total === 1 ? '' : 's'}`}
          </h1>

          <div className="fdl-viewtoggle" role="group" aria-label="Result detail">
            <button
              type="button"
              className={view === 'basic' ? 'fdl-viewtoggle__on' : 'fdl-viewtoggle__off'}
              aria-pressed={view === 'basic'}
              onClick={() => setView('basic')}
            >
              Basic View
            </button>
            <button
              type="button"
              className={view === 'expanded' ? 'fdl-viewtoggle__on' : 'fdl-viewtoggle__off'}
              aria-pressed={view === 'expanded'}
              onClick={() => setView('expanded')}
            >
              Expanded View
            </button>
          </div>

          <div className="fdl-resultshead__tools">
            <span>
              Download Full Results (
              <button
                type="button"
                className="fdl-link"
                disabled={!query || downloading !== null}
                onClick={() => download('csv')}
              >
                {downloading === 'csv' ? 'CSV…' : 'CSV'}
              </button>
              {' | '}
              <button
                type="button"
                className="fdl-link"
                disabled={!query || downloading !== null}
                onClick={() => download('xlsx')}
              >
                {downloading === 'xlsx' ? 'Excel…' : 'Excel'}
              </button>
              )
            </span>
            <button type="button" className="fdl-link" onClick={copyPermalink}>
              {copied ? 'Link copied' : 'View Query (permanent link)'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="fdl-error-box">
            <p className="fdl-error">{error}</p>
            {errorQuery ? (
              <div className="fdl-error-query">
                <div className="fdl-error-query__header">
                  <span>Processed SQL Query:</span>
                  <button
                    type="button"
                    className="fdl-link"
                    style={{ color: '#a6adc8' }}
                    onClick={() => {
                      navigator.clipboard.writeText(errorQuery);
                    }}
                  >
                    Copy Query
                  </button>
                </div>
                <pre className="fdl-error-query__code"><code>{errorQuery}</code></pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {data?.warnings?.length ? (
          <ul className="fdl-results__warnings">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        {rows.length > 0 ? (
          <>
            <ResultsTable rows={rows} view={view} sortState={sortState} onSort={onSort} />
            <div className="fdl-results__bar fdl-results__bar--bottom">
              <span className="fdl-results__count">
                Showing {(offset + 1).toLocaleString()}–{to.toLocaleString()} of{' '}
                {browsable.toLocaleString()}
                {data?.capped ? ` most recent (of ${total.toLocaleString()} matching)` : ''}
              </span>
              <span className="fdl-results__pager">
                <button
                  type="button"
                  className="fdl-btn fdl-btn--quiet"
                  disabled={busy || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  className="fdl-btn fdl-btn--quiet"
                  disabled={busy || to >= browsable}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next ›
                </button>
              </span>
            </div>
          </>
        ) : !busy && !error ? (
          <p className="fdl-note">
            No labels matched. Go back to the query builder and loosen a criterion.
          </p>
        ) : null}
      </main>

      <Footer />
    </Page>
  );
}

export default function LabelQueryResultsPage() {
  // useSearchParams needs a Suspense boundary to keep the route prerenderable.
  return (
    <Suspense fallback={null}>
      <ResultsPage />
    </Suspense>
  );
}
