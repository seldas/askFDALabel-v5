'use client';

/*
 * Free-text intent → criteria.
 *
 * This fills the panel below and stops there. It never runs the search: the
 * point is that the analyst sees, checks, and edits the criteria the model
 * chose before any query executes, which is also why translation notes are
 * surfaced prominently rather than swallowed.
 */

import { useEffect, useRef, useState } from 'react';
import type { LabelQuery, PreFilter, TargetDb } from './types';
import { fromWire, fromWirePrefilters } from './types';
import { PreFilterChips } from './PreFilterChips';

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

function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const EXAMPLES = [
  {
    category: 'Multiple SET-IDs',
    prompt: 'e5cbf204-c10d-444b-aba0-180a30645d55, 44fb1e25-ad03-4a7f-9f35-2e29f5025661, f7633480-25aa-4326-bec9-82835b486a20, 4b286ec6-68a7-4ec0-af07-5a27ec9cb35d',
    display: 'Multiple SET-IDs paste (e5cbf204-…, 44fb1e25-…, f7633480-…)',
  },
  {
    category: 'Drug Name + Typo',
    prompt: 'Lipitor or Metfomin with oral route',
    display: 'Drug combination ("Lipitor or Metfomin with oral route")',
  },
  {
    category: 'MedDRA Safety',
    prompt: 'Metformin labels with Boxed Warning mentioning lactic acidosis',
    display: 'MedDRA safety ("Metformin with Boxed Warning lactic acidosis")',
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
  prefilters,
  onPrefiltersChange,
  onTogglePrefilter,
  onSetAllPrefilters,
  disabled,
  targetDb = 'local',
}: {
  onQuery: (query: LabelQuery) => void;
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
}) {
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isFolded, setIsFolded] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string>('');
  const [completionToast, setCompletionToast] = useState<{ duration: string; timestamp: number } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!completionToast) return;
    const t = setTimeout(() => {
      setCompletionToast(null);
    }, 3000);
    return () => clearTimeout(t);
  }, [completionToast]);

  const translate = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || refining) return;

    const startTime = Date.now();
    setBusy(true);
    setElapsedSeconds(0);
    setError(null);
    setNotes([]);
    setCompletionToast(null);
    onPrefiltersChange([]);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 500);

    try {
      const res = await fetch('/api/labelquery/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: trimmed, target_db: targetDb }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotes(json.notes || []);
        throw new Error(json.error || `Translation failed (${res.status})`);
      }
      onQuery(fromWire(json.query));
      onPrefiltersChange(fromWirePrefilters(json.prefilters));
      setNotes(json.notes || []);
      setActivePrompt(trimmed);
      setIsFolded(true);

      const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
      setCompletionToast({ duration: `${totalSec}s`, timestamp: Date.now() });
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Refinement failed (${res.status})`);
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
              Enter clinical intent, active ingredients, application categories, or MedDRA adverse events in plain English. The query assistant maps terminology and translates your input into structured criteria below for verification before execution.
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
              placeholder="e.g. Lipitor or Metformin with oral route, or paste multiple SET-IDs, or Metformin with Boxed Warning lactic acidosis..."
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  translate(intent);
                }
              }}
            />
            <button
              type="button"
              className="fdl-btn fdl-btn--ai"
              disabled={disabled || busy || !intent.trim()}
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
                  <span>Build Criteria</span>
                </>
              )}
            </button>
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
                disabled={busy || refining}
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
            Review the populated criteria in the cards below before clicking <strong>Search Labels »</strong>.
          </p>
        </div>
      )}

      {/* Restrained completion toast popup */}
      {completionToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 10000,
            background: '#0f172a',
            color: '#ffffff',
            borderRadius: '6px',
            padding: '10px 14px',
            boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.82rem',
            animation: 'fdl-toast-slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            maxWidth: '380px',
            border: '1px solid #334155',
          }}
        >
          <div
            style={{
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <CheckIcon size={16} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Criteria Configured</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, background: '#1e293b', color: '#94a3b8', padding: '1px 6px', borderRadius: '4px', border: '1px solid #334155' }}>
                {completionToast.duration}
              </span>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '1px' }}>
              Search criteria populated in panel below.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCompletionToast(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '1rem',
              padding: '2px 4px',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label="Close notification"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}
    </section>
  );
}
