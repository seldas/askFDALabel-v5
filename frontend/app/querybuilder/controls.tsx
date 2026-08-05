'use client';

/*
 * Shared controls for the criteria cards.
 *
 * These are intentionally not the app's platform primitives: the panel has to
 * read as FDALabel, whose controls are plain HTML with a distinct rhythm
 * (link-styled quick picks, a select that acts as an "or choose from the list"
 * adder). Styling lives in querybuilder.css so the FDALabel look stays in one
 * place rather than leaking into the design system.
 */

import { useEffect, useId, useRef, useState } from 'react';

export interface Option {
  value: string;
  label?: string;
  count?: number;
  group?: string;
}

/** Removable chips for whatever the user has picked so far. */
export function Chips({
  values,
  onRemove,
  labelFor,
}: {
  values: string[];
  onRemove: (value: string) => void;
  labelFor?: (value: string) => string;
}) {
  if (!values.length) return null;
  return (
    <div className="fdl-chips">
      {values.map((v) => (
        <span key={v} className="fdl-chip">
          {labelFor ? labelFor(v) : v}
          <button
            type="button"
            className="fdl-chip__x"
            onClick={() => onRemove(v)}
            aria-label={`Remove ${labelFor ? labelFor(v) : v}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** "Choose one or more: Animal Rx  Animal OTC  …" — toggles, styled as links. */
export function QuickPicks({
  picks,
  selected,
  onToggle,
  prompt = 'Choose one or more:',
  reasonFor,
}: {
  picks: Array<{ label: string; value: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  prompt?: string;
  /** Reason a pick cannot match on the current target, or null when it can. */
  reasonFor?: (value: string) => string | null;
}) {
  return (
    <div className="fdl-quickpicks">
      <span className="fdl-quickpicks__prompt">{prompt}</span>
      {picks.map((p) => {
        // A pick already chosen stays enabled even when unavailable, so the
        // only way to clear it does not disappear along with its target.
        const reason = reasonFor?.(p.value) ?? null;
        const blocked = Boolean(reason) && !selected.includes(p.value);
        return (
        <button
          key={p.value}
          type="button"
          className={
            selected.includes(p.value) ? 'fdl-link fdl-link--on' : 'fdl-link'
          }
          aria-pressed={selected.includes(p.value)}
          disabled={blocked}
          title={reason ?? undefined}
          onClick={() => onToggle(p.value)}
        >
          {p.label}
        </button>
        );
      })}
    </div>
  );
}

/**
 * "or choose one or more from the list:" — a native select used as an adder.
 *
 * It resets to the placeholder after each pick so the same control can add a
 * second value, which is how the FDALabel control behaves.
 */
export function ListAdder({
  label = 'or choose one or more from the list:',
  options,
  selected,
  onAdd,
  loading,
}: {
  label?: string;
  options: Option[];
  selected: string[];
  onAdd: (value: string) => void;
  loading?: boolean;
}) {
  const id = useId();
  const available = options.filter((o) => !selected.includes(o.value));
  const placeholderText = loading
    ? 'Loading list…'
    : options.length > 0 && available.length === 0
    ? '(All options selected)'
    : '-- Select from list --';

  return (
    <div className="fdl-listadder">
      <label className="fdl-listadder__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="fdl-select fdl-select--wide"
        value=""
        disabled={loading || (options.length > 0 && available.length === 0)}
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
      >
        <option value="">{placeholderText}</option>
        {available.map((o) => (
          <option key={o.value} value={o.value}>
            {(o.label || o.value) +
              (o.count !== undefined && o.count !== null ? ` (${o.count.toLocaleString()})` : '')}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Free-text box with async suggestions that commits picks as chips.
 *
 * Suggestions are advisory: Enter commits whatever is typed, because the EPC
 * and MedDRA vocabularies are large enough that an unlisted term is often still
 * worth searching for.
 */
export function TokenInput({
  placeholder,
  values,
  onChange,
  fetchSuggestions,
}: {
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  fetchSuggestions?: (q: string) => Promise<string[]>;
}) {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fetchSuggestions || text.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const next = await fetchSuggestions(text.trim());
        if (!cancelled) {
          setSuggestions(next);
          setOpen(next.length > 0);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, fetchSuggestions]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const commit = (value: string) => {
    const v = value.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setText('');
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className="fdl-tokeninput" ref={boxRef}>
      <Chips values={values} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
      <input
        className="fdl-input"
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
          } else if (e.key === 'Backspace' && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul className="fdl-suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  wide,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  wide?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      className={wide ? 'fdl-select fdl-select--wide' : 'fdl-select'}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Single-line text input with async autocomplete suggestions (starts at minChars).
 */
export function AutoCompleteInput({
  value,
  onChange,
  placeholder,
  fetchSuggestions,
  minChars = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  fetchSuggestions?: (q: string) => Promise<string[]>;
  minChars?: number;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fetchSuggestions || value.trim().length < minChars) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const next = await fetchSuggestions(value.trim());
        if (!cancelled) {
          setSuggestions(next);
          setOpen(next.length > 0);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, fetchSuggestions, minChars]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectSuggestion = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: '200px' }} ref={boxRef}>
      <input
        className="fdl-input fdl-input--grow"
        style={{ width: '100%' }}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (value.trim().length >= minChars && suggestions.length > 0) setOpen(true);
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul className="fdl-suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectSuggestion(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
