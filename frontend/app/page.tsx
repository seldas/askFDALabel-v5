'use client';

/*
 * Home is the query builder.
 *
 * v5 previously opened on a context finder plus recent-work cards. That put a
 * single free-text box in front of people whose actual question is structured
 * ("human Rx, NDA, oral, boxed warning mentions X"), so the page could not
 * express the query they came to run. The panel below is FDALabel's criteria
 * model, which is the vocabulary those users already work in; tasks, recent
 * conversations and the tool directory moved to /dashboard, /search and /tools,
 * all still reachable from the header.
 *
 * The AI panel on top is an accelerator, not a second search: it writes into
 * the same criteria tree and stops, so a translated query is reviewed and
 * edited before anything executes.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from './components/Header';
import Footer from './components/Footer';
import StartPage from './components/StartPage';
import { useUser } from './context/UserContext';
import { useCapabilities } from './platform/capabilities';
import { Page } from './platform/primitives';
import { withAppBase } from './utils/appPaths';
import { AiIntentPanel } from './querybuilder/AiIntentPanel';
import type { OptionLists } from './querybuilder/CriterionCard';
import { QueryPanel } from './querybuilder/QueryPanel';
import { QUERY_PARAM, decodeQuery, resultsPath } from './querybuilder/queryUrl';
import {
  countFilled,
  fromWire,
  type LabelQuery,
  makeEmptyQuery,
  TARGET_DB_LABELS,
  type TargetDb,
  toWire,
  type WireQuery,
} from './querybuilder/types';
import './querybuilder/querybuilder.css';

const LAST_QUERY_KEY = 'afl.labelquery.last';

const EMPTY_OPTIONS: OptionLists = {
  labelingTypes: [],
  applicationTypes: [],
  routes: [],
  dosageForms: [],
  sections: [],
  loading: true,
};

function HomePage() {
  const searchParams = useSearchParams();
  const { session, loading, refreshSession, openAuthModal } = useUser();
  const { capabilities, ready: capReady } = useCapabilities();
  const isAuthed = Boolean(session?.is_authenticated);

  const oracleAvailable = capReady && Boolean(capabilities.isInternal || capabilities.fdaAccessible || capabilities.cderAccessible);
  const [targetDb, setTargetDb] = useState<TargetDb>('oracle');

  const [query, setQuery] = useState<LabelQuery>(makeEmptyQuery);
  const [options, setOptions] = useState<OptionLists>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);
  // The target the user clicked, held until they confirm losing the query.
  const [pendingDb, setPendingDb] = useState<TargetDb | null>(null);

  // Auto-switch to local DB if Oracle is unavailable in this environment
  useEffect(() => {
    if (capReady && !oracleAvailable) {
      setTargetDb('local');
    }
  }, [capReady, oracleAvailable]);

  useEffect(() => {
    setHasSaved(Boolean(window.localStorage.getItem(LAST_QUERY_KEY)));
  }, []);

  // Escape cancels the switch, matching the backdrop click.
  useEffect(() => {
    if (!pendingDb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingDb(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDb]);

  /* Coming back from the results page: the criteria tree travels in the same
   * `q` parameter the results page reads, so "Back to search" reopens the panel
   * exactly as the user left it -- including filters they ticked in the results
   * sidebar, which never went through localStorage.
   *
   * Applied once per distinct parameter value. Re-applying on every render
   * would fight the user's edits, since the URL is deliberately left alone
   * afterwards. */
  const hydratedFrom = useRef<string | null>(null);
  const encodedParam = searchParams.get(QUERY_PARAM);
  const targetParam = searchParams.get('target_db');

  useEffect(() => {
    if (!encodedParam || hydratedFrom.current === encodedParam) return;
    const wire = decodeQuery(encodedParam);
    if (!wire) return;
    hydratedFrom.current = encodedParam;
    setQuery(fromWire(wire));
    if (targetParam === 'local' || targetParam === 'oracle' || targetParam === 'oracle_all') {
      setTargetDb(targetParam);
    }
  }, [encodedParam, targetParam]);

  /* Dropdown contents come from the live database, so a deployment with a
   * partial label import offers only what it actually has.
   *
   * Refetched on every target change: the lists describe the database being
   * searched, and the Oracle scopes and the local import do not hold the same
   * vocabularies. Marked loading first so the previous target's options cannot
   * be offered as though they belonged to the new one. */
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    setOptions((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        const res = await fetch(`/api/labelquery/options?target_db=${targetDb}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || 'Failed to load options');
        setOptions({
          labelingTypes: json.labelingTypes || [],
          applicationTypes: json.applicationTypes || [],
          routes: json.routes || [],
          dosageForms: json.dosageForms || [],
          sections: json.sections || [],
          loading: false,
        });
      } catch (err) {
        console.error('Failed to load query options', err);
        if (!cancelled) setOptions((prev) => ({ ...prev, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, targetDb]);

  const runSearch = useCallback(() => {
    setError(null);
    try {
      const wire = toWire(query, targetDb);
      window.localStorage.setItem(LAST_QUERY_KEY, JSON.stringify(wire));
      setHasSaved(true);
      window.location.href = withAppBase(resultsPath(wire, targetDb));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [query, targetDb]);

  const restoreLast = useCallback(() => {
    const raw = window.localStorage.getItem(LAST_QUERY_KEY);
    if (!raw) return;
    try {
      setQuery(fromWire(JSON.parse(raw) as WireQuery));
      setError(null);
    } catch {
      setError('The saved query could not be read.');
    }
  }, []);

  const clearAll = useCallback(() => {
    setQuery(makeEmptyQuery());
    setError(null);
  }, []);

  /* Switching target is destructive, so a configured query gets a confirmation
   * first. The two backends do not share fields or vocabularies — the criteria
   * one supports the other silently ignores, and the option lists behind the
   * dropdowns are refetched per target — so carrying the old tree across would
   * leave criteria that look configured but cannot run. */
  const requestTargetDb = useCallback(
    (next: TargetDb) => {
      if (next === targetDb) return;
      if (countFilled(query) > 0) {
        setPendingDb(next);
        return;
      }
      setTargetDb(next);
    },
    [targetDb, query],
  );

  const confirmTargetDb = useCallback(() => {
    if (!pendingDb) return;
    setTargetDb(pendingDb);
    setQuery(makeEmptyQuery());
    setError(null);
    setPendingDb(null);
  }, [pendingDb]);

  const handleGuestLogin = async () => {
    try {
      const res = await fetch('/api/dashboard/auth/guest-login', { method: 'POST' });
      if (res.ok) await refreshSession();
    } catch (err) {
      console.error('Guest login failed', err);
    }
  };

  if (!loading && !isAuthed) {
    return (
      <StartPage
        onLogin={() => openAuthModal('login')}
        onSignUp={() => openAuthModal('register')}
        onGuest={handleGuestLogin}
      />
    );
  }

  const filled = countFilled(query);

  const actionBar = (position: 'top' | 'bottom') => (
    <div className={position === 'top' ? 'fdl-actions' : 'fdl-actions fdl-actions--bottom'}>
      <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {filled > 0 ? (
          <span className="fdl-active-tag fdl-active-tag--highlight">
            {filled} active {filled === 1 ? 'criterion' : 'criteria'} configured
          </span>
        ) : (
          <span className="fdl-active-tag fdl-active-tag--none">
            All Labels (No filters applied)
          </span>
        )}
      </div>

      <button type="button" className="fdl-link" onClick={restoreLast} disabled={!hasSaved}>
        Restore Last Query
      </button>
      <button type="button" className="fdl-link" onClick={clearAll}>
        Clear All
      </button>

      {/* Target DB Switch (Oracle vs Local) */}
      <div
        className="fdl-target-db-container"
        title={!oracleAvailable ? "Oracle FDALabel DB is unavailable in public environment (locked to Local DB)" : "Switch search target database"}
      >
        <span className="fdl-target-db-label">DB:</span>
        <div className="fdl-target-db-pills">
          <button
            type="button"
            className={`fdl-target-db-pill ${targetDb === 'local' ? 'active' : ''}`}
            onClick={() => requestTargetDb('local')}
            title="Local DB — Search local structured drug and SPL records"
          >
            {TARGET_DB_LABELS.local}
          </button>
          {/* Human and All are the same Oracle database; they differ only in scope */}
          <button
            type="button"
            className={`fdl-target-db-pill ${targetDb === 'oracle' ? 'active' : ''}`}
            onClick={() => oracleAvailable && requestTargetDb('oracle')}
            disabled={!oracleAvailable}
            title="CDER-CBER ver. — Search human prescription and OTC drug labeling"
          >
            {TARGET_DB_LABELS.oracle}
          </button>
          <button
            type="button"
            className={`fdl-target-db-pill ${targetDb === 'oracle_all' ? 'active' : ''}`}
            onClick={() => oracleAvailable && requestTargetDb('oracle_all')}
            disabled={!oracleAvailable}
            title="FDA ver. — Search all drug labeling including human and animal records"
          >
            {TARGET_DB_LABELS.oracle_all}
          </button>
        </div>
      </div>

      <button type="button" className="fdl-btn fdl-btn--search" onClick={runSearch}>
        Search Labels »
      </button>
    </div>
  );

  return (
    <Page>
      <Header />

      <main className="fdl-shell">
        <AiIntentPanel onQuery={setQuery} targetDb={targetDb} />

        {actionBar('top')}

        <QueryPanel
          query={query}
          onChange={setQuery}
          options={options}
          targetDb={targetDb}
          visibleSections={['identifiers', 'textMatch']}
        />

        {actionBar('bottom')}

        {error ? <p className="fdl-error">{error}</p> : null}
      </main>

      {/* Outside actionBar on purpose — that helper is mounted twice. */}
      {pendingDb ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fdl-dbswitch-title"
          onClick={() => setPendingDb(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 24px 60px -12px rgba(15, 23, 42, 0.35)',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <h2
              id="fdl-dbswitch-title"
              style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}
            >
              ⚠️ Switch to {TARGET_DB_LABELS[pendingDb]}?
            </h2>
            <p
              style={{
                marginTop: '10px',
                marginBottom: 0,
                color: '#475569',
                fontSize: '0.9rem',
                lineHeight: 1.5,
              }}
            >
              You have {filled} active {filled === 1 ? 'criterion' : 'criteria'} configured.
              Switching from <strong>{TARGET_DB_LABELS[targetDb]}</strong> to{' '}
              <strong>{TARGET_DB_LABELS[pendingDb]}</strong> will clear the current query — the
              two databases do not offer the same fields or value lists, so the criteria cannot
              carry across.
            </p>
            <div
              style={{
                marginTop: '20px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                className="fdl-btn fdl-btn--quiet"
                onClick={() => setPendingDb(null)}
              >
                Keep current query
              </button>
              <button type="button" className="fdl-btn fdl-btn--search" onClick={confirmTargetDb}>
                Switch and clear
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Footer />
    </Page>
  );
}

export default function HomePageWrapper() {
  return (
    <Suspense
      fallback={
        <Page>
          <Header />
          <main className="fdl-shell" />
          <Footer />
        </Page>
      }
    >
      <HomePage />
    </Suspense>
  );
}
