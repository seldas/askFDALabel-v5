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
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const translate = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
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

  return (
    <section className="fdl-ai" aria-label="Build a query from a description">
      <div className="fdl-ai__head">
        <h2 className="fdl-ai__title">Describe what you are looking for</h2>
        <p className="fdl-ai__lede">
          Plain English is turned into the criteria below. Nothing is searched until you review
          them and press Search.
        </p>
      </div>

      <div className="fdl-ai__field">
        <textarea
          className="fdl-ai__input"
          rows={2}
          value={intent}
          disabled={disabled || busy}
          placeholder="e.g. Human prescription labels for SGLT2 inhibitors that mention ketoacidosis in Warnings"
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

      <div className="fdl-ai__examples">
        <span className="fdl-ai__exlabel">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="fdl-link"
            disabled={busy}
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
    </section>
  );
}
