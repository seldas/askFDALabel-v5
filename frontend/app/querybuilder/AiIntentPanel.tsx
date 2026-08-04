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
import type { LabelQuery } from './types';
import { fromWire } from './types';

const EXAMPLES = [
  'Human Rx labels for metformin that mention lactic acidosis in the boxed warning',
  'NDA reference listed drugs given intravenously that are kinase inhibitors',
  'OTC labels whose adverse reactions section mentions hepatic failure',
];

export function AiIntentPanel({
  onQuery,
  disabled,
}: {
  onQuery: (query: LabelQuery) => void;
  disabled?: boolean;
}) {
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isFolded, setIsFolded] = useState(false);

  const translate = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || refining) return;
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const res = await fetch('/api/labelquery/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Translation failed (${res.status})`);
      onQuery(fromWire(json.query));
      setNotes(json.notes || []);
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
        body: JSON.stringify({ intent: trimmed }),
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
              Plain English is turned into the criteria below. Nothing is searched until you review them and press Search.
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
          <div className="fdl-ai__field" style={{ marginTop: '16px', display: 'flex', gap: '10px', alignItems: 'stretch' }}>
            <textarea
              className="fdl-ai__input"
              rows={2}
              value={intent}
              disabled={disabled || busy || refining}
              placeholder="e.g. Human prescription labels for SGLT2 inhibitors that mention ketoacidosis in Warnings"
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  translate(intent);
                }
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                className="fdl-btn fdl-btn--ai"
                disabled={disabled || busy || refining || !intent.trim()}
                onClick={() => translate(intent)}
                style={{ flex: 1, whiteSpace: 'nowrap' }}
              >
                {busy ? 'Building…' : 'Build query'}
              </button>
              <button
                type="button"
                disabled={disabled || busy || refining || !intent.trim()}
                onClick={() => refine(intent)}
                style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  background: 'linear-gradient(135deg, #f3e8ff 0%, #e0e7ff 100%)',
                  color: '#6b21a8',
                  border: '1px solid #c084fc',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  padding: '6px 14px',
                  cursor: disabled || busy || refining || !intent.trim() ? 'not-allowed' : 'pointer',
                  opacity: disabled || busy || refining || !intent.trim() ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                {refining ? 'Refining…' : '🪄 Refine Prompt'}
              </button>
            </div>
          </div>

          {warnings.length > 0 && (
            <div style={{
              marginTop: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: '#fffbeb',
              border: '1px solid #fde047',
              color: '#92400e',
              fontSize: '0.85rem'
            }}>
              <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                ⚠️ Refinement Guidance & Warnings:
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.5 }}>
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

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

          {error ? <p className="fdl-ai__error">{error}</p> : null}
          {notes.length > 0 ? (
            <ul className="fdl-ai__notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
