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
import { QUERY_PARAM, decodeQuery } from '../querybuilder/queryUrl';
import type { WireQuery } from '../querybuilder/types';
import '../querybuilder/querybuilder.css';

const PAGE_SIZE = 50;

function ResultsPage() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get(QUERY_PARAM);

  const query = useMemo<WireQuery | null>(() => decodeQuery(encoded), [encoded]);

  const [data, setData] = useState<ResultSet | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);

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
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
        setData(json as ResultSet);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
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
          body: JSON.stringify({ query, format, sort: sortState.sort, dir: sortState.dir }),
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
                : `${total.toLocaleString()}${data?.capped ? '+' : ''} labeling result${total === 1 ? '' : 's'}`}
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

        {error ? <p className="fdl-error">{error}</p> : null}

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
                {total.toLocaleString()}
                {data?.capped ? '+' : ''}
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
                  disabled={busy || to >= total}
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
