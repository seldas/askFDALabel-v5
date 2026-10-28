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
 * the same criteria tree. Searches run immediately by default; users can opt
 * to review the generated criteria before execution.
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
import type { SavedQuery } from './querybuilder/queryCode';
import { AiIntentPanel } from './querybuilder/AiIntentPanel';
import type { OptionLists } from './querybuilder/CriterionCard';
import { PreFilterChips } from './querybuilder/PreFilterChips';
import { QueryPanel } from './querybuilder/QueryPanel';
import { QUERY_PARAM, decodeQuery, resultsPath } from './querybuilder/queryUrl';
import {
  applyPrefilters,
  countFilled,
  fromWire,
  hasInvalidCommonFullText,
  hasInvalidMeddraLevel,
  hasUnverifiedProductNames,
  type LabelQuery,
  makeEmptyQuery,
  type PreFilter,
  setAllPrefilters,
  TARGET_DB_LABELS,
  type TargetDb,
  togglePrefilter,
  toWire,
  type WireQuery,
} from './querybuilder/types';
import './querybuilder/querybuilder.css';

function AlertIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

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

  /* Only developers and admins choose a database. Everyone else is pinned to
   * the CDER-CBER scope; the selector remains visible so that scope is clear.
   *
   * This is presentation only -- target_db travels with every query request, so
   * the real restriction is labelquery._resolve_target_db on the backend, which
   * applies the same rule to whatever actually arrives. */
  const canSelectDb = Boolean(session?.can_select_db);

  const [targetDb, setTargetDb] = useState<TargetDb>('oracle');

  const [query, setQuery] = useState<LabelQuery>(makeEmptyQuery);
  /* The categorical picks /translate read out of the description. Held here,
   * not in the criteria tree: they stay suggestions until Search, which is
   * what lets the boxes below the cards undo one without editing the query. */
  const [prefilters, setPrefilters] = useState<PreFilter[]>([]);
  const [options, setOptions] = useState<OptionLists>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);
  const [hasPendingAiInput, setHasPendingAiInput] = useState(false);
  const [aiResetVersion, setAiResetVersion] = useState(0);
  const [pendingInputDialog, setPendingInputDialog] = useState(false);
  const [reviewHighlight, setReviewHighlight] = useState(0);
  // The target the user clicked, held until they confirm losing the query.
  const [pendingDb, setPendingDb] = useState<TargetDb | null>(null);

  /* Pin the target for anyone who cannot choose one.
   *
   * Oracle is the intended scope, but it is unreachable on a public deployment,
   * and leaving a pinned user there would mean no search at all -- so fall back
   * to the local database exactly as this page already did when Oracle was
   * down. The backend resolver makes the same substitution.
   *
   * Runs for privileged users too, to keep the pre-existing behaviour of
   * dropping off an unreachable Oracle. */
  useEffect(() => {
    if (!capReady) return;
    if (!canSelectDb) {
      setTargetDb(oracleAvailable ? 'oracle' : 'local');
    } else if (!oracleAvailable) {
      setTargetDb('local');
    }
  }, [capReady, oracleAvailable, canSelectDb]);

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
    // Ignored for pinned accounts: a shared link must not hand someone a scope
    // their role does not allow. The effect above puts them back regardless,
    // but not re-setting it here avoids a visible flip.
    if (canSelectDb && (targetParam === 'local' || targetParam === 'oracle' || targetParam === 'oracle_all')) {
      setTargetDb(targetParam);
    }
  }, [encodedParam, targetParam, canSelectDb]);

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

  const runSearch = useCallback((searchQuery: LabelQuery = query, searchPrefilters: PreFilter[] = prefilters, searchTargetDb: TargetDb = targetDb) => {
    setError(null);
    try {
      /* Ticked pre-filters are folded in only here, on the way out. They land
       * as ordinary categorical criteria, so the results sidebar shows them
       * ticked and the header reads filtered / backbone total. */
      const wire = toWire(applyPrefilters(searchQuery, searchPrefilters), searchTargetDb);
      window.localStorage.setItem(LAST_QUERY_KEY, JSON.stringify(wire));
      setHasSaved(true);
      window.location.href = withAppBase(resultsPath(wire, searchTargetDb));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [query, prefilters, targetDb]);

  const importQueryCode = useCallback((saved: SavedQuery, searchImmediately: boolean) => {
    const restored = fromWire(saved.query);
    const restoredTarget = canSelectDb ? saved.targetDb : targetDb;
    if (restoredTarget !== 'local' && !oracleAvailable) {
      throw new Error('The saved query requires an Oracle database that is unavailable in this environment.');
    }
    if (!canSelectDb && saved.targetDb !== targetDb) {
      throw new Error('The saved query uses a database scope your account cannot select.');
    }
    setQuery(restored);
    setPrefilters([]);
    setTargetDb(restoredTarget);
    setError(null);
    if (searchImmediately) runSearch(restored, [], restoredTarget);
  }, [canSelectDb, targetDb, oracleAvailable, runSearch]);

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
    setAiResetVersion((version) => version + 1);
    setQuery(makeEmptyQuery());
    setPrefilters([]);
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
    setPrefilters([]);
    setError(null);
    setPendingDb(null);
  }, [pendingDb]);

  if (!loading && !isAuthed) {
    return (
      <StartPage
        ssoEnabled={Boolean(session?.sso_enabled)}
      />
    );
  }

  const filled = countFilled(query);
  const checkedPrefilters = prefilters.filter((p) => p.checked).length;
  const hasUnverified = hasUnverifiedProductNames(query);
  const hasCommonFullText = hasInvalidCommonFullText(query);
  const hasHigherMeddra = hasInvalidMeddraLevel(query);
  const hasBlockers = hasUnverified || hasCommonFullText || hasHigherMeddra;

  const actionBar = (position: 'top' | 'bottom') => (
    <div className={position === 'top' ? 'fdl-actions' : 'fdl-actions fdl-actions--bottom'}>
      <div className="fdl-actions__summary">
        {filled > 0 ? (
          <span className="fdl-active-tag fdl-active-tag--highlight">
            {filled} {filled === 1 ? 'criterion' : 'criteria'} applied
          </span>
        ) : (
          <span className="fdl-active-tag fdl-active-tag--none">
            {checkedPrefilters > 0 ? 'No criteria applied' : 'Searching all labels'}
          </span>
        )}
        {checkedPrefilters > 0 ? (
          <span className="fdl-active-tag fdl-active-tag--prefilter">
            {checkedPrefilters} {checkedPrefilters === 1 ? 'filter' : 'filters'} applied
          </span>
        ) : null}
        {hasUnverified && (
          <span className="fdl-warning-tag">
            <AlertIcon size={13} />
            <span>Please confirm name(s) / MedDRA term(s)</span>
          </span>
        )}
        {hasCommonFullText && (
          <span className="fdl-warning-tag">
            <AlertIcon size={13} />
            <span>Please refine common full-text term(s)</span>
          </span>
        )}
        {hasHigherMeddra && (
          <span className="fdl-warning-tag">
            <AlertIcon size={13} />
            <span>MedDRA levels above PT are disabled (use PT/LLT)</span>
          </span>
        )}
      </div>

      <button type="button" className="fdl-link" onClick={clearAll}>
        Clear All
      </button>

      {/* Everyone can see the current data scope. Only accounts granted
          db_selection receive the other choices; the backend enforces the
          same restriction on every request. */}
      <label
        className="fdl-target-db-container"
        title={canSelectDb
          ? (!oracleAvailable ? "Oracle FDALabel DB is unavailable in this environment" : "Switch search target database")
          : "Your account searches the CDER-CBER database scope"}
      >
        <span className="fdl-target-db-label">DB</span>
        <select
          className="fdl-target-db-select"
          aria-label="Search database"
          value={canSelectDb ? targetDb : 'oracle'}
          onChange={(event) => {
            if (canSelectDb) requestTargetDb(event.target.value as TargetDb);
          }}
        >
          {canSelectDb && <option value="local">{TARGET_DB_LABELS.local}</option>}
          <option value="oracle" disabled={canSelectDb && !oracleAvailable}>{TARGET_DB_LABELS.oracle}</option>
          {canSelectDb && <option value="oracle_all" disabled={!oracleAvailable}>{TARGET_DB_LABELS.oracle_all}</option>}
        </select>
      </label>
      <button type="button" className="fdl-link" onClick={restoreLast} disabled={!hasSaved}>
        Restore Last Query
      </button>
      <button
        type="button"
        className="fdl-btn fdl-btn--search"
        onClick={() => {
          if (hasPendingAiInput) { setPendingInputDialog(true); return; }
          runSearch();
        }}
        disabled={hasBlockers}
        style={hasBlockers ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        title={
          hasUnverified
            ? 'Please confirm all product names and MedDRA terms by selecting from standard suggestions'
            : hasCommonFullText
            ? 'Full-text search for common/generic words is restricted to prevent slow queries'
            : hasHigherMeddra
            ? 'MedDRA searches above Preferred Term (PT) level are disabled'
            : undefined
        }
      >
        Search Labels »
      </button>
    </div>
  );

  return (
    <Page>
      <Header />

      <main className="fdl-shell">
        {actionBar('top')}

        <AiIntentPanel
          onQuery={setQuery}
          onQuickSearch={runSearch}
          onPendingInputChange={setHasPendingAiInput}
          resetVersion={aiResetVersion}
          onReviewReady={() => setReviewHighlight((version) => version + 1)}
          onImportQuery={importQueryCode}
          options={options}
          prefilters={prefilters}
          onPrefiltersChange={setPrefilters}
          onTogglePrefilter={(id) => setPrefilters((prev) => togglePrefilter(prev, id))}
          onSetAllPrefilters={(checked) => setPrefilters((prev) => setAllPrefilters(prev, checked))}
          targetDb={targetDb}
          exactMatch={query.exactMatch}
        />

        <div key={reviewHighlight} className={reviewHighlight ? "fdl-review-highlight" : undefined}>
        <QueryPanel
          query={query}
          onChange={setQuery}
          options={options}
          targetDb={targetDb}
          visibleSections={['identifiers', 'textMatch']}
        />
        </div>

        {/* Last thing read before Search, and the same list the AI panel shows. */}
        <PreFilterChips
          prefilters={prefilters}
          onToggle={(id) => setPrefilters((prev) => togglePrefilter(prev, id))}
          onSetAll={(checked) => setPrefilters((prev) => setAllPrefilters(prev, checked))}
        />

        {actionBar('bottom')}

        {error ? <p className="fdl-error">{error}</p> : null}
      </main>

      {pendingInputDialog && (
        <div className="fdl-confirm-backdrop" onClick={() => setPendingInputDialog(false)}>
          <div className="fdl-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pending-input-title" aria-describedby="pending-input-description" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setPendingInputDialog(false); }}>
            <h2 id="pending-input-title">AI input not yet applied</h2>
            <p id="pending-input-description">The text in AI Search Assistant has not been applied. Continue with the currently configured criteria and filters?</p>
            <div className="fdl-confirm-actions">
              <button type="button" className="fdl-btn fdl-btn--quiet" autoFocus onClick={() => setPendingInputDialog(false)}>Return to AI Search Assistant</button>
              <button type="button" className="fdl-btn fdl-btn--search" onClick={() => { setPendingInputDialog(false); runSearch(); }}>Search current criteria</button>
            </div>
          </div>
        </div>
      )}

      {/* Keep the database switch dialog outside the status bar. */}
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
            backgroundColor: 'rgba(7, 31, 61, 0.58)',
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
              background: 'var(--fdl-paper, #ffffff)',
              borderRadius: 'var(--fdl-radius-sm, 2px)',
              border: '1px solid var(--fdl-line, #b8c8d7)',
              borderTop: '3px solid var(--fdl-navy-800, #12375b)',
              boxShadow: '0 16px 36px rgba(7, 31, 61, 0.24)',
              padding: '20px 24px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <h2
              id="fdl-dbswitch-title"
              style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)' }}
            >
              ⚠️ Switch to {TARGET_DB_LABELS[pendingDb]}?
            </h2>
            <p
              style={{
                marginTop: '10px',
                marginBottom: 0,
                color: 'var(--fdl-muted, #5e6e7c)',
                fontSize: '0.88rem',
                lineHeight: 1.5,
              }}
            >
              You have {filled} {filled === 1 ? 'criterion' : 'criteria'} applied.
              Switching from <strong>{TARGET_DB_LABELS[targetDb]}</strong> to{' '}
              <strong>{TARGET_DB_LABELS[pendingDb]}</strong> will clear the current query — the
              two databases do not offer the same fields or value lists, so the criteria cannot
              carry across.
            </p>
            <div
              style={{
                marginTop: '18px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
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
