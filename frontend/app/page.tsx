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

import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import StartPage from './components/StartPage';
import { useUser } from './context/UserContext';
import { Page } from './platform/primitives';
import { AiIntentPanel } from './querybuilder/AiIntentPanel';
import type { OptionLists } from './querybuilder/CriterionCard';
import { QueryPanel } from './querybuilder/QueryPanel';
import { ResultsTable, type ResultSet } from './querybuilder/ResultsTable';
import {
  countFilled,
  fromWire,
  type LabelQuery,
  makeEmptyQuery,
  toWire,
  type WireQuery,
} from './querybuilder/types';
import './querybuilder/querybuilder.css';

const LAST_QUERY_KEY = 'afl.labelquery.last';
const PAGE_SIZE = 50;

const EMPTY_OPTIONS: OptionLists = {
  labelingTypes: [],
  applicationTypes: [],
  routes: [],
  sections: [],
  loading: true,
};

export default function HomePage() {
  const { session, loading, refreshSession, openAuthModal } = useUser();
  const isAuthed = Boolean(session?.is_authenticated);

  const [query, setQuery] = useState<LabelQuery>(makeEmptyQuery);
  const [options, setOptions] = useState<OptionLists>(EMPTY_OPTIONS);
  const [results, setResults] = useState<ResultSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHasSaved(Boolean(window.localStorage.getItem(LAST_QUERY_KEY)));
  }, []);

  /* Dropdown contents come from the live database, so a deployment with a
   * partial label import offers only what it actually has. */
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/labelquery/options');
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || 'Failed to load options');
        setOptions({
          labelingTypes: json.labelingTypes || [],
          applicationTypes: json.applicationTypes || [],
          routes: json.routes || [],
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
  }, [isAuthed]);

  const runSearch = useCallback(
    async (offset: number) => {
      setBusy(true);
      setError(null);
      try {
        const wire = toWire(query);
        window.localStorage.setItem(LAST_QUERY_KEY, JSON.stringify(wire));
        setHasSaved(true);

        const res = await fetch('/api/labelquery/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: wire, limit: PAGE_SIZE, offset }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
        setResults(json as ResultSet);
        // Only scroll on a fresh search; paging should hold position.
        if (offset === 0) {
          requestAnimationFrame(() =>
            resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults(null);
      } finally {
        setBusy(false);
      }
    },
    [query],
  );

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
    setResults(null);
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
      <button
        type="button"
        className="fdl-btn fdl-btn--search"
        onClick={() => runSearch(0)}
        disabled={busy}
      >
        {busy ? 'Searching…' : 'Search »'}
      </button>
    </div>
  );

  return (
    <Page>
      <Header />

      <main className="fdl-shell">
        <AiIntentPanel onQuery={setQuery} disabled={busy} />

        {actionBar('top')}

        <QueryPanel query={query} onChange={setQuery} options={options} />

        {actionBar('bottom')}

        {filled === 0 ? (
          <p className="fdl-note">
            No criteria are filled in yet — searching now returns the most recently revised
            labels.
          </p>
        ) : null}

        {error ? <p className="fdl-error">{error}</p> : null}

        <div ref={resultsRef}>
          {results ? (
            <ResultsTable data={results} busy={busy} onPage={(offset) => runSearch(offset)} />
          ) : null}
        </div>
      </main>

      <Footer />
    </Page>
  );
}
