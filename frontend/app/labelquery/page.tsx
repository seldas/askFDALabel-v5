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
import Link from 'next/link';
import Header from '../components/Header';
import Footer from '../components/Footer';
import SidebarFilters from '../components/SidebarFilters';
import { Page } from '../platform/primitives';
import { useUser } from '../context/UserContext';
import { useCapabilities } from '../platform/capabilities';
import {
  ResultsTable,
  type LabelRow,
  type QueryFacets,
  type ResultSet,
  type ResultView,
  type SortState,
} from '../querybuilder/ResultsTable';
import type { OptionLists } from '../querybuilder/CriterionCard';
import { QUERY_PARAM, decodeQuery, encodeQuery, resultsPath } from '../querybuilder/queryUrl';
import { fromWire, stripFacetFilters, toWire, type LabelQuery, type TargetDb, type WireQuery } from '../querybuilder/types';
import { withAppBase } from '../utils/appPaths';
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
        const secList = (c.sections || []).join(', ');
        parts.push(secList ? `Section (${secList}): "${c.text}"` : `Full Text: "${c.text}"`);
      } else if (c.type === 'pharmClass' && (c.terms || c.text)) {
        const termsStr = Array.isArray(c.terms) ? c.terms.join(', ') : c.text;
        parts.push(`Pharm Class: ${termsStr}`);
      } else if (c.type === 'identifier' && c.text) {
        parts.push(`Identifier: ${c.text}`);
      } else if (c.type === 'meddra' && (c.ptTerms?.length || c.lltTerms?.length || c.terms || c.text)) {
        // PTs and LLTs are named separately, and the excluded LLTs with them:
        // "minus Hepatic coma" is the part of the search a reader cannot infer
        // from the PT, and the summary is the only place it shows.
        const meddraParts: string[] = [];
        if (c.ptTerms?.length) meddraParts.push(`PT: ${c.ptTerms.join(', ')}`);
        if (c.lltTerms?.length) meddraParts.push(`LLT: ${c.lltTerms.join(', ')}`);
        if (!meddraParts.length) {
          const termsStr = Array.isArray(c.terms) ? c.terms.join(', ') : c.text;
          meddraParts.push(`${String(c.level || 'pt').toUpperCase()}: ${termsStr}`);
        }
        if (c.excludedLlts?.length) meddraParts.push(`excluding ${c.excludedLlts.join(', ')}`);
        parts.push(`MedDRA (${meddraParts.join('; ')})`);
      } else if (c.type === 'labelingType') {
        const ltParts = [];
        if (c.values?.length) ltParts.push(c.values.join(', '));
        if (c.plr === 'plr') ltParts.push('PLR Format');
        if (c.plr === 'non_plr' || c.plr === 'non-plr') ltParts.push('non-PLR Format');
        if (ltParts.length) parts.push(`Label Type: ${ltParts.join('; ')}`);
      } else if (c.type === 'applicationType') {
        const appParts = [];
        if (c.isRld) appParts.push('RLD');
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
  const initialTargetDb = searchParams.get('target_db') || 'oracle';
  const { session, openAuthModal } = useUser();
  const { capabilities, ready: capReady } = useCapabilities();
  const oracleAvailable = capReady && Boolean(capabilities.isInternal || capabilities.fdaAccessible || capabilities.cderAccessible);

  const initialWireQuery = useMemo<WireQuery | null>(() => decodeQuery(encoded), [encoded]);

  const [overrideWireQuery, setOverrideWireQuery] = useState<WireQuery | null>(null);
  const [overrideTargetDb, setOverrideTargetDb] = useState<TargetDb | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Sync state when URL searchParams changes
  useEffect(() => {
    setOverrideWireQuery(null);
    setOverrideTargetDb(null);
  }, [encoded]);

  const activeWireQuery = overrideWireQuery ?? initialWireQuery;
  const currentTargetDb = (overrideTargetDb || initialTargetDb) as TargetDb;
  const labelQuery = useMemo<LabelQuery>(() => fromWire(activeWireQuery || { groups: [] }), [activeWireQuery]);

  const [options, setOptions] = useState<OptionLists>({
    labelingTypes: [],
    applicationTypes: [],
    routes: [],
    dosageForms: [],
    sections: [],
    loading: true,
  });

  const [data, setData] = useState<ResultSet | null>(null);
  const [facets, setFacets] = useState<QueryFacets | undefined>(undefined);
  const [facetsBusy, setFacetsBusy] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorQuery, setErrorQuery] = useState<string | null>(null);
  const [view, setView] = useState<ResultView>('basic');
  const [offset, setOffset] = useState(0);
  const [sortState, setSortState] = useState<SortState>({ sort: 'revised_date', dir: 'desc' });
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  // Task creation and Export menu states
  const [exportOpen, setExportOpen] = useState(false);
  const [is3000WarningOpen, setIs3000WarningOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskTitleInput, setTaskTitleInput] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskSuccessMsg, setTaskSuccessMsg] = useState<{ title: string; count: number; id: number } | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.fdl-export-dropdown')) {
        setExportOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Fetch option lists when currentTargetDb changes
  useEffect(() => {
    let cancelled = false;
    setOptions((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const res = await fetch(`/api/labelquery/options?target_db=${currentTargetDb}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setOptions({
            labelingTypes: json.labelingTypes || [],
            applicationTypes: json.applicationTypes || [],
            routes: json.routes || [],
            dosageForms: json.dosageForms || [],
            sections: json.sections || [],
            loading: false,
          });
        }
      } catch {
        if (!cancelled) setOptions((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTargetDb]);

  // A changed query means the old page number is meaningless.
  useEffect(() => {
    setOffset(0);
  }, [encoded]);

  useEffect(() => {
    if (!activeWireQuery) {
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
            query: activeWireQuery,
            limit: PAGE_SIZE,
            offset,
            sort: sortState.sort,
            dir: sortState.dir,
            target_db: currentTargetDb,
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
        if (offset === 0 && activeWireQuery) {
          const currentLink = typeof window !== 'undefined' 
            ? (window.location.pathname + window.location.search) 
            : resultsPath(activeWireQuery, currentTargetDb);
          fetch('/api/dashboard/query_history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query_title: summarizeQuery(activeWireQuery),
              query_link: currentLink,
              query_json: activeWireQuery,
              result_count: json.total || 0,
              target_db: currentTargetDb
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
  }, [activeWireQuery, currentTargetDb, offset, sortState]);

  // The counts describe the search, not the filter panel: they are computed
  // over the query with every sidebar filter stripped, so ticking one narrows
  // the results while the numbers beside each option stay put -- which is the
  // only way they can tell you what ticking the *next* one would do.
  //
  // That backbone is therefore the cache key, not the query. Sidebar edits
  // leave it byte-identical, so the effect does not refire and the panel is
  // never asked to recompute an answer it already has. Only a real change to
  // the search criteria costs a second pass.
  const facetWireQuery = useMemo(
    () => (activeWireQuery ? stripFacetFilters(activeWireQuery) : null),
    [activeWireQuery],
  );
  const facetQueryKey = useMemo(
    () => (facetWireQuery ? JSON.stringify(facetWireQuery) : null),
    [facetWireQuery],
  );

  // Facets ride a separate request. Exact counts mean an aggregate pass over
  // the whole matched set, which on Oracle costs about what the search does --
  // the table should not wait on it, and a facet failure should not take the
  // results down with it.
  useEffect(() => {
    if (!facetQueryKey) {
      setFacets(undefined);
      return;
    }

    let cancelled = false;
    setFacetsBusy(true);

    (async () => {
      try {
        const res = await fetch('/api/labelquery/facets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: JSON.parse(facetQueryKey), target_db: currentTargetDb }),
        });
        const json = await res.json();
        if (cancelled) return;
        setFacets(res.ok ? (json.facets as QueryFacets) : undefined);
      } catch {
        if (!cancelled) setFacets(undefined);
      } finally {
        if (!cancelled) setFacetsBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facetQueryKey, currentTargetDb]);

  /**
   * Where "Back to search" goes: home, carrying the criteria tree the user is
   * looking at right now -- sidebar edits included, which the browser's own
   * Back button would lose since those only ever replaceState'd. Home reads the
   * same `q` parameter the results page does.
   *
   * A tree too large to encode falls back to a bare home link rather than
   * throwing on render; the panel is then empty, but the page still works.
   */
  const editSearchPath = useMemo(() => {
    if (!activeWireQuery) return '/';
    try {
      return `/?${QUERY_PARAM}=${encodeQuery(activeWireQuery)}&target_db=${currentTargetDb}`;
    } catch {
      return '/';
    }
  }, [activeWireQuery, currentTargetDb]);

  const handleSidebarQueryChange = useCallback(
    (newLabelQuery: LabelQuery) => {
      const newWire = toWire(newLabelQuery);
      setOverrideWireQuery(newWire);
      setOffset(0);
      const newPath = withAppBase(resultsPath(newWire, currentTargetDb));
      window.history.replaceState(null, '', newPath);
    },
    [currentTargetDb],
  );

  const handleTargetDbChange = useCallback(
    (newDb: TargetDb) => {
      setOverrideTargetDb(newDb);
      setOffset(0);
      const wireToUse = activeWireQuery || { groups: [] };
      const newPath = withAppBase(resultsPath(wireToUse, newDb));
      window.history.replaceState(null, '', newPath);
    },
    [activeWireQuery],
  );

  const handleClearAllSidebarFilters = useCallback(() => {
    if (!activeWireQuery) return;
    const nonSidebarTypes = ['productName', 'fullText', 'labelingSection', 'meddra', 'identifier'];
    const newWire: WireQuery = {
      groups: (activeWireQuery.groups || []).map((g) => ({
        criteria: (g.criteria || []).filter((c) => nonSidebarTypes.includes(c.type)),
      })),
    };
    setOverrideWireQuery(newWire);
    setOffset(0);
    window.history.replaceState(null, '', withAppBase(resultsPath(newWire, currentTargetDb)));
  }, [activeWireQuery, currentTargetDb]);

  const onSort = useCallback((sort: string) => {
    setOffset(0);
    setSortState((prev) =>
      prev.sort === sort
        ? { sort, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { sort, dir: 'asc' },
    );
  }, []);

  const download = useCallback(
    async (format: 'csv' | 'xlsx') => {
      if (!activeWireQuery || downloading) return;
      setDownloading(format);
      setError(null);
      try {
        const res = await fetch('/api/labelquery/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: activeWireQuery, format, sort: sortState.sort, dir: sortState.dir, target_db: currentTargetDb }),
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
    [downloading, activeWireQuery, sortState, currentTargetDb],
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

  const handleInitiateTaskCreation = () => {
    if (!session?.is_authenticated) {
      if (openAuthModal) openAuthModal('login');
      else setError('Please sign in to save query results as a task.');
      return;
    }
    const totalCount = data?.total || 0;
    setTaskTitleInput(summarizeQuery(activeWireQuery));

    if (totalCount > 3000) {
      setIs3000WarningOpen(true);
    } else {
      setIsTaskModalOpen(true);
    }
  };

  const handleSaveTask = async () => {
    if (!taskTitleInput.trim() || taskSaving) return;
    setTaskSaving(true);
    setError(null);
    try {
      const totalCount = data?.total || 0;
      let targetRows: any[] = data?.results || [];

      // If total results exceed loaded page size, fetch the full result set up to 3,000
      if (activeWireQuery && totalCount > targetRows.length) {
        try {
          const fetchRes = await fetch('/api/labelquery/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: activeWireQuery,
              limit: Math.min(totalCount, 3000),
              offset: 0,
              sort: sortState.sort,
              dir: sortState.dir,
              target_db: currentTargetDb,
            }),
          });
          if (fetchRes.ok) {
            const fetchJson = await fetchRes.json();
            if (fetchJson.results?.length) {
              targetRows = fetchJson.results;
            }
          }
        } catch (e) {
          console.error('Failed to fetch results for task', e);
        }
      }

      // Send the rows themselves, not just the ids. The task fills its columns
      // from these: looking them up again server-side would hit the local
      // Postgres import even when these results came from Oracle, which is
      // where the blank product name / manufacturer / effective time came from.
      const labels = targetRows
        .filter((r) => r?.set_id)
        .map((r) => ({
          set_id: r.set_id,
          product_names: r.product_names,
          generic_names: r.generic_names,
          manufacturer: r.manufacturer,
          market_categories: r.market_categories,
          appr_num: r.appr_num,
          ndc_codes: r.ndc_codes,
          revised_date: r.revised_date,
          active_ingredients: r.active_ingredients,
          doc_type: r.doc_type,
          dosage_forms: r.dosage_forms,
          routes: r.routes,
          epc: r.epc,
        }));

      const res = await fetch('/api/dashboard/create_task_from_query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitleInput.trim(),
          labels,
          target_db: currentTargetDb,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to create task.');
      }

      setIsTaskModalOpen(false);
      setTaskSuccessMsg({
        title: resData.project_title,
        count: resData.added_count,
        id: resData.project_id,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save task.');
    } finally {
      setTaskSaving(false);
    }
  };

  const rows: LabelRow[] = data?.results || [];
  const total = data?.total || 0;
  const unfilteredTotal = (data as any)?.unfiltered_total ?? total;
  const browsable = data?.browsable ?? total;
  const to = offset + rows.length;

  return (
    <Page>
      <Header />

      <main className="fdl-shell fdl-shell--results">
        <div className="fdl-mobile-filter-bar">
          <button
            type="button"
            className="fdl-btn fdl-btn--mobile-filter"
            onClick={() => setMobileSidebarOpen((prev) => !prev)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Filters</span>
          </button>
        </div>

        <div className="fdl-results-layout">
          <aside className={`fdl-results-sidebar ${mobileSidebarOpen ? 'is-mobile-open' : ''}`}>
            {mobileSidebarOpen && (
              <div className="fdl-mobile-sidebar-close">
                <span>Filter Results</span>
                <button type="button" onClick={() => setMobileSidebarOpen(false)}>✕ Close</button>
              </div>
            )}
            <SidebarFilters
              query={labelQuery}
              onChange={handleSidebarQueryChange}
              options={options}
              targetDb={currentTargetDb}
              onTargetDbChange={handleTargetDbChange}
              oracleAvailable={oracleAvailable}
              totalResults={unfilteredTotal}
              loading={busy}
              onClearAll={handleClearAllSidebarFilters}
              facets={facets}
              facetsLoading={facetsBusy}
            />
          </aside>

          <div className="fdl-results-main">
            <div className="fdl-results-back">
              <Link className="fdl-backlink" href={editSearchPath}>
                <span aria-hidden="true">‹</span> Back to search
              </Link>
            </div>

            <div className="fdl-resultshead">
              <h1 className="fdl-resultshead__count">
                {!activeWireQuery
                  ? 'Query results'
                  : busy
                    ? data
                      ? 'Updating results…'
                      : 'Searching…'
                    : `${total.toLocaleString()}/${unfilteredTotal.toLocaleString()} Labeling Results`}
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

              {/* Unified Export Dropdown Button */}
              <div className="fdl-export-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  type="button"
                  className="fdl-btn fdl-btn--export"
                  onClick={() => setExportOpen((prev) => !prev)}
                  disabled={!activeWireQuery || downloading !== null}
                  style={{
                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 18px',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.2)',
                  }}
                >
                  <span>Export</span>
                  <span style={{ fontSize: '0.7rem' }}>▼</span>
                </button>

                {exportOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 6px)',
                      background: '#ffffff',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.2)',
                      minWidth: '240px',
                      zIndex: 1000,
                      padding: '6px',
                    }}
                  >
                    <button
                      type="button"
                      disabled={downloading !== null}
                      onClick={() => { setExportOpen(false); download('csv'); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'transparent',
                        color: '#1e293b',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      <span>{downloading === 'csv' ? 'Exporting CSV…' : 'Export as CSV'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={downloading !== null}
                      onClick={() => { setExportOpen(false); download('xlsx'); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'transparent',
                        color: '#1e293b',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                      <span>{downloading === 'xlsx' ? 'Exporting Excel…' : 'Export as Excel (.xlsx)'}</span>
                    </button>

                    <div style={{ height: '1px', background: '#f1f5f9', margin: '4px 0' }} />

                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); copyPermalink(); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'transparent',
                        color: '#1e293b',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span>{copied ? 'Link Copied!' : 'Copy Permanent Link'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); handleInitiateTaskCreation(); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'transparent',
                        color: '#2563eb',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><polyline points="9 14 11 16 15 12"/></svg>
                      <span>Save Query Results as Task</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Task Creation Success Banner */}
            {taskSuccessMsg && (
              <div
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  padding: '12px 18px',
                  borderRadius: '10px',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>✓</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                    Task <strong>"{taskSuccessMsg.title}"</strong> created with{' '}
                    <strong>{taskSuccessMsg.count.toLocaleString()}</strong> labeling record(s)!
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Link
                    href={`/dashboard?projectId=${taskSuccessMsg.id}`}
                    style={{
                      background: '#059669',
                      color: '#ffffff',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    View Task in Dashboard →
                  </Link>
                  <button
                    type="button"
                    onClick={() => setTaskSuccessMsg(null)}
                    style={{ background: 'none', border: 'none', color: '#047857', cursor: 'pointer', fontWeight: 800, fontSize: '1rem' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

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

            {/* Active query summary tag pill */}
            <div className="fdl-results-summary-bar">
              <span className="fdl-results-summary-label">Query Criteria:</span>
              <span className="fdl-results-summary-text">{summarizeQuery(activeWireQuery)}</span>
              {data?.sql ? (
                <button
                  type="button"
                  className="fdl-link fdl-link--sql"
                  onClick={() => setSqlOpen((prev) => !prev)}
                >
                  {sqlOpen ? 'Hide SQL' : 'View SQL'}
                </button>
              ) : null}
            </div>

            {sqlOpen && data?.sql ? (
              <div className="fdl-sql-panel">
                <div className="fdl-sql-panel__head">
                  <span className="fdl-sql-panel__title">Generated SQL Query</span>
                  <button
                    type="button"
                    className={`fdl-sql-panel__copy${sqlCopied ? ' is-copied' : ''}`}
                    onClick={() => {
                      navigator.clipboard.writeText(data.sql!);
                      setSqlCopied(true);
                      setTimeout(() => setSqlCopied(false), 2000);
                    }}
                  >
                    {sqlCopied ? '✓ Copied!' : 'Copy SQL'}
                  </button>
                </div>
                <pre className="fdl-sql-panel__code">{data.sql}</pre>
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
              // The rows on screen belong to the previous filter set until the
              // refetch lands; dimming them says so, instead of letting a stale
              // table read as "the filter did nothing".
              <div className={busy ? 'fdl-results-stale' : undefined} aria-busy={busy}>
                <ResultsTable rows={rows} view={view} sortState={sortState} onSort={onSort} targetDb={currentTargetDb} />
                <div className="fdl-results__bar fdl-results__bar--bottom">
                  <span className="fdl-results__count">
                    Showing {offset + 1}–{to} of {browsable.toLocaleString()}
                  </span>
                  <div className="fdl-pager">
                    <button
                      type="button"
                      className="fdl-btn fdl-btn--ghost"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      ‹ Previous
                    </button>
                    <button
                      type="button"
                      className="fdl-btn fdl-btn--ghost"
                      disabled={to >= browsable}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Next ›
                    </button>
                  </div>
                </div>
              </div>
            ) : !busy ? (
              <div className="fdl-empty">
                <p>No labeling matched your criteria.</p>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {/* Customized Result Truncation Warning Modal (>3000 results) */}
      {is3000WarningOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              border: '1px solid #cbd5e1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: '#fef3c7',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Result Limit Truncation Notice
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                  Query results exceed task capacity limit
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 20px 0', fontSize: '0.9rem', color: '#334155', lineHeight: 1.55 }}>
              This search query returned <strong>{(data?.total || 0).toLocaleString()}</strong> labeling results. Tasks support a maximum of <strong>3,000</strong> items. Only the first <strong>3,000</strong> results will be saved into the task.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setIs3000WarningOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIs3000WarningOpen(false);
                  setIsTaskModalOpen(true);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
                }}
              >
                Proceed & Save (First 3,000)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customized Task Creation Modal */}
      {isTaskModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '500px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              border: '1px solid #cbd5e1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><polyline points="9 14 11 16 15 12"/></svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Save Query Results as Task
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                  Organize query set into My Dashboard tasks
                </span>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                Task Title
              </label>
              <input
                type="text"
                value={taskTitleInput}
                onChange={(e) => setTaskTitleInput(e.target.value)}
                placeholder="e.g. Full Text: aspirin"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  background: '#f8fafc',
                  color: '#0f172a',
                  fontWeight: 600,
                }}
              />
            </div>

            <div
              style={{
                background: '#f1f5f9',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                color: '#475569',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Records to be saved:</span>
              <strong style={{ color: '#1d4ed8' }}>
                {Math.min(data?.total || 0, 3000).toLocaleString()} labeling record(s)
              </strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                disabled={taskSaving}
                onClick={() => setIsTaskModalOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={taskSaving || !taskTitleInput.trim()}
                onClick={handleSaveTask}
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: taskSaving ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {taskSaving ? 'Saving Task…' : 'Create & Save Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </Page>
  );
}

export default function ResultsPageWrapper() {
  return (
    <Suspense
      fallback={
        <Page>
          <Header />
          <main className="fdl-shell fdl-shell--results">
            <div className="fdl-empty">
              <p>Loading results…</p>
            </div>
          </main>
          <Footer />
        </Page>
      }
    >
      <ResultsPage />
    </Suspense>
  );
}
