'use client';

/*
 * Free-text intent → criteria.
 *
 * This fills the panel below and stops there. It never runs the search: the
 * point is that the analyst sees, checks, and edits the criteria the model
 * chose before any query executes, which is also why translation notes are
 * surfaced rather than swallowed.
 */

import { useState } from 'react';
import type { LabelQuery, PreFilter, TargetDb } from './types';
import { fromWire, fromWirePrefilters } from './types';
import { PreFilterChips } from './PreFilterChips';

const EXAMPLES = [
  'Metformin or glipizide mentioning lactic acidosis in the boxed warning',
  'Kinase inhibitors mentioning QTc prolongation or cardiac toxicity',
  'Acetaminophen or aspirin labels with adverse reactions mentioning hepatic failure',
];

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
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isFolded, setIsFolded] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string>('');

  const translate = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || refining) return;
    setBusy(true);
    setError(null);
    setNotes([]);
    onPrefiltersChange([]);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
        marginBottom: '20px'
      }}
    >
      <div className="fdl-ai__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 className="fdl-ai__title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', color: '#0f172a', fontWeight: 800 }}>
            <span style={{ fontSize: '1.2rem' }}>✨</span> AskFDALabel - Describe what you are looking for
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
              placeholder="e.g. Metformin or glipizide mentioning lactic acidosis in Boxed Warning or Adverse Reactions"
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
            >
              {busy ? 'Building…' : 'Build query'}
            </button>
          </div>

          <div className="fdl-ai__examples" style={{ marginTop: '12px' }}>
            <span className="fdl-ai__exlabel">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="fdl-link"
                disabled={busy || refining}
                onClick={() => {
                  setIntent(ex);
                  translate(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>

        </>
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

      {/*
       * Outside the !isFolded block on purpose. A successful translate() sets
       * these and folds the panel on the very next line, so while they lived
       * with the textarea every translation note and error was written and
       * hidden in the same render — the user only ever saw the prompt chip.
       */}
      {error ? (
        <p className="fdl-ai__error" style={{ marginTop: '12px' }}>
          {error}
        </p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="fdl-ai__notes" style={{ marginTop: '12px', paddingLeft: '0', listStyle: 'none' }}>
          {notes.map((n) => {
            const isWarn = n.toLowerCase().includes('warning') || n.toLowerCase().includes('not available') || n.toLowerCase().includes('omitted');
            return (
              <li
                key={n}
                style={{
                  color: isWarn ? '#b45309' : '#475569',
                  fontWeight: isWarn ? 700 : 500,
                  backgroundColor: isWarn ? '#fef3c7' : 'transparent',
                  padding: isWarn ? '8px 14px' : '3px 0',
                  borderRadius: isWarn ? '8px' : '0',
                  border: isWarn ? '1px solid #f59e0b' : 'none',
                  marginBottom: isWarn ? '8px' : '4px',
                  fontSize: '0.86rem',
                  lineHeight: '1.4',
                }}
              >
                {isWarn && !n.startsWith('⚠️') ? `⚠️ ${n}` : n}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
