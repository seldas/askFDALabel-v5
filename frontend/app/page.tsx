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

import { useCallback, useEffect, useState } from 'react';
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
import { resultsPath } from './querybuilder/queryUrl';
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

export default function HomePage() {
  const { session, loading, refreshSession, openAuthModal } = useUser();
  const { capabilities, ready: capReady } = useCapabilities();
  const isAuthed = Boolean(session?.is_authenticated);

  const oracleAvailable = capReady && Boolean(capabilities.isInternal || capabilities.fdaAccessible || capabilities.cderAccessible);
  const [targetDb, setTargetDb] = useState<TargetDb>('oracle');

  const [query, setQuery] = useState<LabelQuery>(makeEmptyQuery);
  const [options, setOptions] = useState<OptionLists>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  // Auto-switch to local DB if Oracle is unavailable in this environment
  useEffect(() => {
    if (capReady && !oracleAvailable) {
      setTargetDb('local');
    }
  }, [capReady, oracleAvailable]);

  useEffect(() => {
    setHasSaved(Boolean(window.localStorage.getItem(LAST_QUERY_KEY)));
  }, []);

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
      const wire = toWire(query);
      window.localStorage.setItem(LAST_QUERY_KEY, JSON.stringify(wire));
      setHasSaved(true);
      window.open(withAppBase(resultsPath(wire, targetDb)), '_blank', 'noopener');
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
            onClick={() => setTargetDb('local')}
            title="Local DB — Search local structured drug and SPL records"
          >
            {TARGET_DB_LABELS.local}
          </button>
          {/* Human and All are the same Oracle database; they differ only in scope */}
          <button
            type="button"
            className={`fdl-target-db-pill ${targetDb === 'oracle' ? 'active' : ''}`}
            onClick={() => oracleAvailable && setTargetDb('oracle')}
            disabled={!oracleAvailable}
            title="CDER-CBER ver. — Search human prescription and OTC drug labeling"
          >
            {TARGET_DB_LABELS.oracle}
          </button>
          <button
            type="button"
            className={`fdl-target-db-pill ${targetDb === 'oracle_all' ? 'active' : ''}`}
            onClick={() => oracleAvailable && setTargetDb('oracle_all')}
            disabled={!oracleAvailable}
            title="FDA ver. — Search all drug labeling including human and animal records"
          >
            {TARGET_DB_LABELS.oracle_all}
          </button>
        </div>
      </div>

      <button type="button" className="fdl-btn fdl-btn--search" onClick={runSearch}>
        Search »
      </button>
    </div>
  );

  return (
    <Page>
      <Header />

      <main className="fdl-shell">
        <AiIntentPanel onQuery={setQuery} targetDb={targetDb} />

        {actionBar('top')}

        <QueryPanel query={query} onChange={setQuery} options={options} targetDb={targetDb} />

        {actionBar('bottom')}

        {error ? <p className="fdl-error">{error}</p> : null}
      </main>

      <Footer />
    </Page>
  );
}
