'use client';

/* Free-text intent → criteria, with optional immediate search. */

import { useEffect, useRef, useState } from 'react';
import type { LabelQuery, PreFilter, TargetDb } from './types';
import { fromWire, fromWirePrefilters } from './types';
import { EXTERNAL_QUERY_START, externalAiInstructions, parseExternalQuery } from './externalAiQuery';
import type { OptionLists } from './CriterionCard';
import { QUERY_CODE_PREFIX, decodeQueryCode, type SavedQuery } from './queryCode';
import { PreFilterChips } from './PreFilterChips';
import { queryErrorMessage, readQueryResponse } from './apiResponse';

/* Clean SVG icons for professional scientific workbench */
function AssistantIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <path d="m11 8 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
    </svg>
  );
}

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'fdl-spin 1s linear infinite' }} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ClockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ChevronDownIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronUpIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

const EXAMPLES = [
  {
    category: 'Single-ingredient name expansion',
    prompt: 'Find labels for metformin',
    display: 'Metformin name expansion',
  },
  {
    category: 'Combination drug expansion',
    prompt: 'Find fixed-dose combination products containing both amoxicillin and clavulanate',
    display: 'Amoxicillin/clavulanate combination',
  },
  {
    category: 'MedDRA adverse-event expansion',
    prompt: 'Find labels mentioning nausea as an adverse event',
    display: 'Nausea MedDRA expansion',
  },
];

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function getLiveStatusText(sec: number): string {
  if (sec < 6) return 'Analyzing clinical intent and extracting entities…';
  if (sec < 16) return 'Mapping drug names, active moieties & marketing categories…';
  if (sec < 28) return 'Searching MedDRA adverse event hierarchy & pharmacologic classes…';
  return 'Structuring FDA label search criteria & compiling query…';
}

export function AiIntentPanel({
  onQuery,
  onQuickSearch,
  onImportQuery,
  options,
  prefilters,
  onPrefiltersChange,
  onTogglePrefilter,
  onSetAllPrefilters,
  disabled,
  targetDb = 'local',
  exactMatch = false,
}: {
  onQuery: (query: LabelQuery) => void;
  onQuickSearch: (query: LabelQuery, prefilters: PreFilter[]) => void;
  onImportQuery: (saved: SavedQuery, searchImmediately: boolean) => void;
  options: OptionLists;
  /* Categorical picks the model read out of the description. They are held by
   * the page rather than here, because the same list is rendered again under
   * the criteria cards and merged into the query at search time. */
  prefilters: PreFilter[];
  onPrefiltersChange: (prefilters: PreFilter[]) => void;
  onTogglePrefilter: (id: string) => void;
  onSetAllPrefilters: (checked: boolean) => void;
  disabled?: boolean;
  /* The three databases do not answer the same questions, so the model is told
   * which one before it picks criteria. */
  targetDb?: TargetDb;
  exactMatch?: boolean;
}) {
  const [intent, setIntent] = useState('');
  const [reviewBeforeSearch, setReviewBeforeSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isFolded, setIsFolded] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string>('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (exactMatch) {
      setNotes((current) => current.filter((note) => !note.startsWith('Drug name ') && !note.startsWith('AE term ')));
    }
  }, [exactMatch]);

  const translate = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled || busy || refining) return;

    const startTime = Date.now();
    setBusy(true);
    setElapsedSeconds(0);
    setError(null);
    setNotes([]);
    onPrefiltersChange([]);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 500);

    try {
      if (trimmed.includes(EXTERNAL_QUERY_START)) {
        const saved = parseExternalQuery(trimmed);
        onImportQuery(saved, !reviewBeforeSearch && saved.unsupported.length === 0);
        setActivePrompt('Imported from external AI');
        setIsFolded(true);
        setNotes([
          'External AI query imported. Drug names and MedDRA terms still require vocabulary confirmation.',
          ...saved.notes,
          ...saved.unsupported.map(item => `Warning: unsupported condition — ${item}. Review before searching.`),
        ]);
        return;
      }
      if (trimmed.startsWith('FDALABEL-')) {
        const saved = await decodeQueryCode(trimmed);
        onImportQuery(saved, !reviewBeforeSearch);
        setActivePrompt('Restored from query code');
        setIsFolded(true);
        setNotes(['Query conditions and filters restored from the saved code.']);
        return;
      }
      const res = await fetch('/api/labelquery/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: trimmed, target_db: targetDb, exact_match: exactMatch }),
      });
      const json = await readQueryResponse(res);
      if (!res.ok) {
        setNotes(json.notes || []);
        throw new Error(queryErrorMessage(json, `Translation failed (${res.status})`));
      }
      const translatedQuery = fromWire(json.query);
      const translatedPrefilters = fromWirePrefilters(json.prefilters);
      onQuery(translatedQuery);
      onPrefiltersChange(translatedPrefilters);
      setNotes(json.notes || []);
      setActivePrompt(trimmed);
      setIsFolded(true);

      if (!reviewBeforeSearch) onQuickSearch(translatedQuery, translatedPrefilters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setBusy(false);
    }
  };

  const refine = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || refining || busy) return;
    setRefining(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await fetch('/api/labelquery/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: trimmed, target_db: targetDb }),
      });
      const json = await readQueryResponse(res);
      if (!res.ok) throw new Error(queryErrorMessage(json, `Refinement failed (${res.status})`));
      if (json.refined_intent) {
        setIntent(json.refined_intent);
      }
      setWarnings(json.warnings || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefining(false);
    }
  };

  return (
    <section className="fdl-ai" aria-label="Natural Language Query Assistant">
      <div className="fdl-ai__head">
        <div>
          <div className="fdl-ai__heading">
            <div className="fdl-ai__icon">
              <AssistantIcon size={16} />
            </div>
            <h2 className="fdl-ai__title">AI Query Builder</h2>
          </div>
          {!isFolded && (
            <p className="fdl-ai__lede">
              Enter clinical intent, active ingredients, application categories, or MedDRA adverse events in plain English. {!reviewBeforeSearch
                ? 'The query assistant maps terminology, builds criteria, and searches automatically.'
                : 'The query assistant maps terminology and translates your input into structured criteria below for verification before execution.'}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsFolded(!isFolded)}
          className="fdl-ai__collapse"
        >
          <span>{isFolded ? 'Expand Assistant' : 'Collapse'}</span>
          {isFolded ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </button>
      </div>

      {!isFolded && (
        <>
          <div className="fdl-ai__field">
            <textarea
              className="fdl-ai__input"
              rows={2}
              value={intent}
              disabled={disabled || busy}
              placeholder="Describe a search, paste SET-IDs, or paste a query code / external AI query to restore criteria..."
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  translate(intent);
                }
              }}
            />
            <div className="fdl-ai__input-actions">
            <button
              type="button"
              className="fdl-btn fdl-btn--ai"
              disabled={disabled || busy || refining || !intent.trim()}
              onClick={() => translate(intent)}
              style={{
                minWidth: busy ? '160px' : '136px',
              }}
            >
              {busy ? (
                <>
                  <SpinnerIcon size={16} />
                  <span>Parsing ({formatElapsed(elapsedSeconds)})</span>
                </>
              ) : (
                <>
                  <AssistantIcon size={16} />
                  <span>{!reviewBeforeSearch ? 'Search' : (intent.trim().startsWith(QUERY_CODE_PREFIX) || intent.includes(EXTERNAL_QUERY_START)) ? 'Restore Query' : 'Build Criteria'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="fdl-link fdl-ai__clear"
              disabled={disabled || busy || refining || !intent}
              onClick={() => setIntent('')}
              title="Clear all text in the query input"
            >
              Clear all
            </button>
            </div>
          </div>

          <div className="fdl-ai__examples">
            <span className="fdl-ai__examples-label">
              Suggested Queries:
            </span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.prompt}
                type="button"
                className="fdl-link"
                disabled={disabled || busy || refining}
                onClick={() => {
                  setIntent(ex.prompt);
                  translate(ex.prompt);
                }}
                title={ex.prompt}
              >
                {ex.display}
              </button>
            ))}
          </div>
          <div className="fdl-ai__query-options">
            <label
              className="fdl-ai__quick-search"
            >
              <input
                type="checkbox"
                checked={reviewBeforeSearch}
                disabled={disabled || busy || refining}
                onChange={(event) => setReviewBeforeSearch(event.target.checked)}
                aria-describedby="review-before-search-tooltip"
              />
              <span>Review before search</span>
              <span className="fdl-ai__quick-search-info" tabIndex={0}>
                <InfoIcon />
                <span id="review-before-search-tooltip" role="tooltip" className="fdl-ai__quick-search-tooltip">
                  Build query conditions for you to review and edit before searching.
                </span>
              </span>
            </label>
            <div className="fdl-ai__external-instructions">
              <button
                type="button"
                className="fdl-link"
                disabled={disabled || busy || refining || options.loading}
                aria-describedby="external-ai-instructions-tooltip"
                onClick={() => {
                  const blob = new Blob([externalAiInstructions(targetDb, options, exactMatch)], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = `fdalabel-external-ai-instructions-v1-${targetDb}.txt`;
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download External AI Instructions
              </button>
              <span className="fdl-ai__quick-search-info" tabIndex={0} aria-describedby="external-ai-instructions-tooltip">
                <InfoIcon />
                <span id="external-ai-instructions-tooltip" role="tooltip" className="fdl-ai__quick-search-tooltip">
                  Download instructions for Elsa, Gemini, or other AI chat tools. Paste the generated query response here to restore criteria.
                </span>
              </span>
            </div>
          </div>
        </>
      )}

      {/* Clean, professional progress indicator when building query */}
      {busy && (
        <div className="fdl-ai__progress">
          <div className="fdl-ai__progress-icon">
            <SpinnerIcon size={18} />
          </div>
          <div className="fdl-ai__progress-content">
            <div className="fdl-ai__progress-heading">
              <span>
                Translating Query to Structured Criteria…
              </span>
              <span className="fdl-ai__elapsed">
                <ClockIcon size={13} />
                <span>Elapsed: {formatElapsed(elapsedSeconds)}</span>
              </span>
            </div>
            <div className="fdl-ai__progress-status">
              {getLiveStatusText(elapsedSeconds)}
            </div>
          </div>
        </div>
      )}

      {activePrompt && (
        <div className={`fdl-ai-applied-intent ${isFolded ? 'is-folded' : ''}`}>
          <span className="fdl-ai-applied-intent__label">Active Intent</span>
          <span className="fdl-ai-applied-intent__text">
            “{activePrompt}”
          </span>
        </div>
      )}

      <PreFilterChips
        prefilters={prefilters}
        onToggle={onTogglePrefilter}
        onSetAll={onSetAllPrefilters}
        variant="ai"
      />

      {error ? (
        <p className="fdl-ai__error" style={{ marginTop: '12px' }}>
          {error}
        </p>
      ) : null}

      {/* Structured Query Translation Audit Trail Panel */}
      {notes.length > 0 && (
        <div className="fdl-ai-response-card">
          <div className="fdl-ai-response-card__head">
            <div className="fdl-ai-response-card__title">
              <div className="fdl-ai-response-card__check">
                <CheckIcon size={16} />
              </div>
              <h3>
                Query Translation & Entity Mapping Audit
              </h3>
            </div>
            <span className="fdl-ai-response-card__status">
              Criteria Configured Below
            </span>
          </div>

          <div className="fdl-ai-response-card__notes">
            {notes.map((n, idx) => {
              const isWarn = n.toLowerCase().includes('warning') || n.toLowerCase().includes('not available') || n.toLowerCase().includes('omitted');
              return (
                <div
                  key={idx}
                  className={`fdl-ai-response-note ${isWarn ? 'is-warning' : ''}`}
                >
                  <span className="fdl-ai-response-note__icon">
                    {isWarn ? <AlertIcon size={14} /> : <InfoIcon size={14} />}
                  </span>
                  <div>
                    <span>{n.replace(/^⚠️\s*/, '')}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="fdl-ai-response-card__hint">
            {!reviewBeforeSearch ? 'Search runs automatically using the generated criteria.' : <>Review the populated criteria in the cards below before clicking <strong>Search Labels »</strong>.</>}
          </p>
        </div>
      )}

    </section>
  );
}
