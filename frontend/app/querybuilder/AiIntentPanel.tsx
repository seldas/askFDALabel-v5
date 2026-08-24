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

const EXAMPLES = [
  {
    category: 'Multiple SET-IDs',
    prompt: 'ca73b519-015a-436d-aa3c-af53492825a1, c7247391-7fb8-4bd8-90db-2d1d072fec01, 88e0b675-ea22-4809-b4be-5ce26857945d',
    display: 'Multiple SET-IDs paste (ca73b519-…, c7247391-…, 88e0b675-…)',
  },
  {
    category: 'Drug Name + Typo',
    prompt: 'Lipitor or Metfomin with oral route',
    display: 'Drug combination with typo ("Lipitor or Metfomin with oral route")',
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
  if (sec < 6) return 'Analyzing clinical intent and extracting relevant entities…';
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
    <section 
      className="fdl-ai" 
      aria-label="Build a query from a description"
      style={{
        borderRadius: '16px',
        border: '2px solid transparent',
        backgroundImage: 'linear-gradient(#ffffff, #ffffff), linear-gradient(135deg, #a855f7 0%, #3b82f6 50%, #06b6d4 100%)',
        backgroundOrigin: 'border-box',
        backgroundClip: 'padding-box, border-box',
        boxShadow: '0 12px 36px -6px rgba(99, 102, 241, 0.18)',
        padding: '24px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        marginBottom: '20px',
        position: 'relative',
      }}
    >
      <div className="fdl-ai__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="fdl-ai__title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', color: '#0f172a', fontWeight: 800 }}>
            AskFDALabel - Describe what you are looking for
          </h2>
          {!isFolded && (
            <p className="fdl-ai__lede" style={{ color: '#64748b', fontSize: '0.88rem', marginTop: '4px' }}>
              Plain English is converted into product names, identifiers, or section text criteria. Categorical filters (routes, forms, market status, application types) come back as tick boxes below — checked ones are applied to the results after the main query runs.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsFolded(!isFolded)}
          style={{
            background: 'rgba(99, 102, 241, 0.08)',
            color: '#4f46e5',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: '8px',
            padding: '6px 14px',
            fontSize: '0.85rem',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap'
          }}
        >
          <span>{isFolded ? 'Expand' : 'Fold'}</span>
          <span style={{ fontSize: '0.75rem' }}>{isFolded ? '▼' : '▲'}</span>
        </button>
      </div>

      {!isFolded && (
        <>
          <div className="fdl-ai__field" style={{ marginTop: '16px' }}>
            <textarea
              className="fdl-ai__input"
              rows={2}
              value={intent}
              disabled={disabled || busy}
              placeholder="e.g. Lipitor or Metfomin oral, or paste multiple SET-IDs, or Metformin with Boxed Warning lactic acidosis..."
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
              style={{ minWidth: busy ? '140px' : '110px' }}
            >
              {busy ? `Building… (${formatElapsed(elapsedSeconds)})` : 'Build query'}
            </button>
          </div>

          <div className="fdl-ai__examples" style={{ marginTop: '12px' }}>
            <span className="fdl-ai__exlabel">Try:</span>
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

      {/* Live progress indicator with timer when building query */}
      {busy && (
        <div
          style={{
            marginTop: '16px',
            background: 'linear-gradient(135deg, #f5f3ff 0%, #eff6ff 100%)',
            border: '1px solid #c7d2fe',
            borderRadius: '12px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.1)',
            animation: 'ai-glow-pulse 2s infinite',
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '1.2rem',
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
            }}
          >
            🤖
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#3730a3', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>AI Query Translation in Progress…</span>
              </span>
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  color: '#4338ca',
                  background: '#e0e7ff',
                  padding: '3px 10px',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  border: '1px solid #c7d2fe',
                }}
              >
                ⏱️ Elapsed: {formatElapsed(elapsedSeconds)}
              </span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.4 }}>
              {getLiveStatusText(elapsedSeconds)}
            </div>
          </div>
        </div>
      )}

      {activePrompt && (
        <div
          className="fdl-ai-applied-intent"
          style={{
            marginTop: isFolded ? '8px' : '14px',
            padding: '10px 14px',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            border: '1px solid #cbd5e1',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.82rem',
          }}
        >
          <span
            style={{
              fontWeight: 800,
              color: '#4f46e5',
              fontSize: '0.72rem',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              flexShrink: 0,
              background: '#e0e7ff',
              padding: '3px 9px',
              borderRadius: '12px',
            }}
          >
            Active AI Query Prompt
          </span>
          <span
            style={{
              color: '#0f172a',
              fontWeight: 600,
              fontStyle: 'italic',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
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

      {/* Prominent AI Search Translation & Formulation Summary Card */}
      {notes.length > 0 && (
        <div
          className="fdl-ai-response-card"
          style={{
            marginTop: '16px',
            background: 'linear-gradient(135deg, #f0fdf4 0%, #f8fafc 100%)',
            border: '1px solid #86efac',
            borderRadius: '14px',
            padding: '16px 20px',
            boxShadow: '0 4px 16px rgba(22, 163, 74, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', borderBottom: '1px solid #dcfce7', paddingBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>✨</span>
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#166534', letterSpacing: '-0.01em' }}>
                AI Search Translation Summary
              </h3>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '3px 9px', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
              ✓ Search Criteria Configured Below
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {notes.map((n, idx) => {
              const isWarn = n.toLowerCase().includes('warning') || n.toLowerCase().includes('not available') || n.toLowerCase().includes('omitted');
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    backgroundColor: isWarn ? '#fffbeb' : '#ffffff',
                    border: isWarn ? '1px solid #fde68a' : '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: isWarn ? '#92400e' : '#1e293b',
                    fontSize: '0.88rem',
                    lineHeight: 1.5,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  }}
                >
                  <span style={{ fontSize: '1.05rem', flexShrink: 0, marginTop: '1px' }}>
                    {isWarn ? '⚠️' : '💡'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: isWarn ? 700 : 500 }}>{n.replace(/^⚠️\s*/, '')}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <p style={{ margin: '10px 0 0 0', fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>👇</span>
            <span>Check and modify the populated criteria cards below before clicking <strong>Search Labels »</strong>.</span>
          </p>
        </div>
      )}

      {/* Customized 3-second completion toast popup summarizing duration */}
      {completionToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: '28px',
            right: '28px',
            zIndex: 10000,
            background: '#0f172a',
            color: '#ffffff',
            borderRadius: '14px',
            padding: '14px 20px',
            boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            animation: 'fdl-toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            maxWidth: '420px',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              flexShrink: 0,
              boxShadow: '0 4px 10px rgba(16, 185, 129, 0.3)',
            }}
          >
            ⏱️
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Query Built Successfully</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, background: '#10b981', color: '#ffffff', padding: '1px 7px', borderRadius: '10px' }}>
                in {completionToast.duration}
              </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>
              Search criteria populated in the panel below.
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
              fontSize: '1.1rem',
              padding: '2px 6px',
              lineHeight: 1,
            }}
            aria-label="Close notification"
          >
            ✕
          </button>
        </div>
      )}
    </section>
  );
}
