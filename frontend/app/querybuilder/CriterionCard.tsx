'use client';

/*
 * One criteria card. The body switches on criterion type; the frame (title,
 * dismiss "×") is shared.
 *
 * Every body is a controlled editor over `criterion.value`, which is the exact
 * object posted to the compiler — there is no separate form model to keep in
 * sync, so what the card shows is what the query contains.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutoCompleteInput, Chips, isPickSelected, ListAdder, type Option, QuickPicks, Select, TokenInput } from './controls';
import {
  CRITERION_DEFS,
  type Criterion,
  type CriterionValue,
  isCommonFullTextQuery,
  type TargetDb,
  unsupportedReason,
} from './types';

export interface OptionLists {
  labelingTypes: Option[];
  applicationTypes: Option[];
  routes: Option[];
  dosageForms: Option[];
  sections: Option[];
  loading: boolean;
}

const MODE_OPTIONS = [
  { value: 'simple', label: 'Simple Search' },
  { value: 'advanced', label: 'Advanced Search' },
];

const SEARCH_HELP = (
  <div className="fdl-help">
    <p>
      <span className="fdl-help__term">Simple Search</span>: Full span phrase match. Supports uppercase AND, OR, NOT operators.
    </p>
  </div>
);

function labelForOption(options: Option[], value: string) {
  return options.find((o) => o.value === value)?.label || value;
}

export function CriterionCard({
  criterion,
  onChange,
  onRemove,
  options,
  targetDb = 'local',
}: {
  criterion: Criterion;
  onChange: (value: CriterionValue) => void;
  onRemove: () => void;
  options: OptionLists;
  targetDb?: TargetDb;
}) {
  const def = CRITERION_DEFS[criterion.type];
  const v = criterion.value as Record<string, any>;

  /* One banner on the frame, so every card reports unavailability the same
   * way instead of each body inventing its own note. */
  const unavailable = unsupportedReason(criterion.type, targetDb);

  const [hierarchies, setHierarchies] = useState<Record<string, string>>({});
  /* LLT names under each selected PT, keyed `${targetDb}:pt:${term}`. A PT
   * searches its descendants, so showing them is the only way to see how wide
   * a pick really is before running it -- and, now, to drop the ones that do
   * not belong. */
  const [llts, setLlts] = useState<Record<string, string[]>>({});
  /* The PT above each directly-picked LLT, keyed `${targetDb}:${llt}`, for the
   * "broaden to PT" control. Fetched up front rather than on click so the
   * button can name the term it would swap in. */
  const [parentPts, setParentPts] = useState<Record<string, string | null>>({});

  /* MedDRA holds two lists at once now: a PT row and an LLT row. `terms` is
   * the old single-level shape, still what /translate writes and what a saved
   * URL carries, so it is folded into whichever row `level` named. HLT / HLGT
   * / SOC have no row of their own and stay on `terms`, compiled the way they
   * always were. */
  const meddraPts: string[] = useMemo(
    () => (Array.isArray(v.ptTerms) ? v.ptTerms : []),
    [v.ptTerms],
  );
  const meddraLlts: string[] = useMemo(
    () => (Array.isArray(v.lltTerms) ? v.lltTerms : []),
    [v.lltTerms],
  );
  const meddraExcluded: string[] = useMemo(
    () => (Array.isArray(v.excludedLlts) ? v.excludedLlts : []),
    [v.excludedLlts],
  );

  useEffect(() => {
    if (criterion.type !== 'meddra') return;
    const legacy: string[] = Array.isArray(v.terms) ? v.terms : [];
    if (!legacy.length) return;
    const level = (v.level || 'llt').toLowerCase();
    if (level !== 'pt' && level !== 'llt') return;
    const field = level === 'pt' ? 'ptTerms' : 'lltTerms';
    const existing: string[] = Array.isArray(v[field]) ? v[field] : [];
    const merged = [...existing, ...legacy.filter((t) => !existing.includes(t))];
    onChange({ ...v, [field]: merged, terms: [] });
  }, [criterion.type, v, onChange]);

  useEffect(() => {
    if (criterion.type !== 'meddra') return;
    // Each row asks about its own level: a PT's path stops at the PT, an LLT's
    // runs one step further down.
    const wanted: Array<[string, string]> = [
      ...meddraPts.map((t) => ['pt', t] as [string, string]),
      ...meddraLlts.map((t) => ['llt', t] as [string, string]),
    ];
    wanted.forEach(async ([level, t]) => {
      // targetDb is part of the key: the two databases answer this from
      // different MedDRA dictionaries, so a cached answer from one is not an
      // answer for the other.
      const key = `${targetDb}:${level}:${t}`;
      if (hierarchies[key]) return;
      try {
        const res = await fetch(
          `/api/labelquery/meddra/hierarchy?term=${encodeURIComponent(t)}&level=${level}&target_db=${targetDb}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.formatted) {
            setHierarchies((prev) => ({ ...prev, [key]: data.formatted }));
          }
        }
      } catch {
        // ignore fetch error
      }
    });
  }, [criterion.type, meddraPts, meddraLlts, targetDb, hierarchies]);

  useEffect(() => {
    // Only a PT has LLTs below it; at LLT level the term is already the leaf.
    if (criterion.type !== 'meddra' || meddraPts.length === 0) return;
    meddraPts.forEach(async (t: string) => {
      const key = `${targetDb}:pt:${t}`;
      // `in`, not truthiness: an empty array is truthy, so `if (llts[key])`
      // would treat "no LLTs found" as "not fetched yet" and refetch forever.
      if (key in llts) return;
      try {
        const res = await fetch(
          `/api/labelquery/meddra/llts?term=${encodeURIComponent(t)}&target_db=${targetDb}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.llts)) {
          setLlts((prev) => ({ ...prev, [key]: data.llts }));
        }
      } catch {
        // ignore fetch error
      }
    });
  }, [criterion.type, meddraPts, targetDb, llts]);

  useEffect(() => {
    if (criterion.type !== 'meddra' || meddraLlts.length === 0) return;
    meddraLlts.forEach(async (t: string) => {
      const key = `${targetDb}:${t}`;
      if (key in parentPts) return;
      try {
        const res = await fetch(
          `/api/labelquery/meddra/parent_pt?term=${encodeURIComponent(t)}&target_db=${targetDb}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setParentPts((prev) => ({ ...prev, [key]: data.pt || null }));
      } catch {
        // ignore fetch error
      }
    });
  }, [criterion.type, meddraLlts, targetDb, parentPts]);

  const [showMultiSetIdModal, setShowMultiSetIdModal] = useState(false);

  const set = useCallback(
    (patch: Record<string, unknown>) => onChange({ ...v, ...patch }),
    [onChange, v],
  );

  const values: string[] = v.values || [];
  const toggle = useCallback(
    (value: string) => {
      const already = isPickSelected(value, values);
      if (already) {
        set({ values: values.filter((x) => !isPickSelected(value, [x])) });
      } else {
        set({ values: [...values, value] });
      }
    },
    [set, values],
  );

  const list = def.optionsKey ? options[def.optionsKey] : [];

  const quickPickReason = useCallback(
    (value: string) => {
      const gate = def.quickPicks?.find((p) => p.value === value)?.unavailableOn;
      return gate && gate.targets.includes(targetDb) ? gate.reason : null;
    },
    [def.quickPicks, targetDb],
  );

  const fetchPharmClass = useCallback(
    async (q: string) => {
      const res = await fetch(
        `/api/labelquery/suggest/pharm_class?q=${encodeURIComponent(q)}&type=${v.classType || 'any'}`,
      );
      if (!res.ok) return [];
      const json = await res.json();
      return (json.suggestions || []).map((s: { name: string }) => s.name);
    },
    [v.classType],
  );

  const fetchMeddra = useCallback(
    async (q: string) => {
      const res = await fetch(
        `/api/labelquery/suggest/meddra?q=${encodeURIComponent(q)}&level=${v.level || 'llt'}&target_db=${targetDb}`,
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.suggestions || [];
    },
    [v.level, targetDb],
  );

  const fetchProductName = useCallback(
    async (q: string) => {
      if (q.length < 2) return [];
      const res = await fetch(
        `/api/labelquery/suggest/product_name?q=${encodeURIComponent(q)}&field=${v.field || 'any'}&target_db=${targetDb}`,
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.suggestions || [];
    },
    [v.field, targetDb],
  );

  const body = useMemo(() => {
    switch (criterion.type) {
      case 'labelingType':
        return (
          <>
            {def.quickPicks ? (
              <QuickPicks
                picks={def.quickPicks}
                selected={values}
                onToggle={toggle}
                reasonFor={quickPickReason}
              />
            ) : null}
            <ListAdder
              options={list}
              selected={values}
              loading={options.loading}
              onAdd={(value) => set({ values: [...values, value] })}
            />
            <Chips
              values={values}
              onRemove={(value) => set({ values: values.filter((x: string) => x !== value) })}
              labelFor={(value) =>
                def.quickPicks?.find((p) => p.value === value)?.label || value
              }
            />
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                PLR Format:
              </span>
              {[
                { id: 'all', label: 'All (Rx, OTC, etc.)' },
                { id: 'plr', label: 'PLR Format' },
                { id: 'non_plr', label: 'non-PLR Format' },
              ].map((opt) => {
                const active = (v.plr || 'all') === opt.id;
                return (
                  <label key={opt.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: active ? 700 : 500, color: active ? '#2563eb' : '#334155' }}>
                    <input
                      type="radio"
                      name={`plr_${criterion.uid}`}
                      checked={active}
                      onChange={() => set({ plr: opt.id })}
                      style={{ cursor: 'pointer', accentColor: '#2563eb' }}
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </>
        );

      case 'route':
      case 'dosageForm':
        return (
          <>
            {def.quickPicks ? (
              <QuickPicks
                picks={def.quickPicks}
                selected={values}
                onToggle={toggle}
                reasonFor={quickPickReason}
              />
            ) : null}
            <ListAdder
              options={list}
              selected={values}
              loading={options.loading}
              onAdd={(value) => set({ values: [...values, value] })}
            />
            <Chips
              values={values}
              onRemove={(value) => set({ values: values.filter((x: string) => x !== value) })}
              labelFor={(value) =>
                def.quickPicks?.find((p) => p.value === value)?.label || value
              }
            />
          </>
        );

      case 'applicationType':
        return (
          <>
            {def.quickPicks ? (
              <QuickPicks
                picks={def.quickPicks}
                selected={values}
                onToggle={toggle}
                reasonFor={quickPickReason}
              />
            ) : null}
            <ListAdder
              options={list}
              selected={values}
              loading={options.loading}
              onAdd={(value) => set({ values: [...values, value] })}
            />
            <Chips
              values={values}
              onRemove={(value) => set({ values: values.filter((x: string) => x !== value) })}
              labelFor={(value) =>
                def.quickPicks?.find((p) => p.value === value)?.label || value
              }
            />
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem', color: '#1e293b', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={Boolean(v.isRld)}
                  onChange={(e) => set({ isRld: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span>RLD (Reference Listed Drug)</span>
              </label>
            </div>
          </>
        );

      case 'productName': {
        const op = v.op || 'equals';
        const isExact = op === 'equals';
        const isStartsWith = op === 'startsWith';
        const isFlexible = op === 'contains' || op === 'notContains';
        const isUnverified = isExact && Boolean(v.text && String(v.text).trim()) && v.verified === false;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {isUnverified && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ⚠️ Verification Required: <em>&ldquo;{v.text}&rdquo;</em>
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>
                    Selection required for exact match
                  </span>
                </div>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: '#78350f' }}>
                  Please confirm the standardized matching product or generic name below to ensure indexed exact matching:
                </p>
                <UnverifiedProductPicker
                  queryText={v.text}
                  field={v.field || 'any'}
                  targetDb={targetDb}
                  onConfirm={(confirmedName) => set({ text: confirmedName, verified: true, op: 'equals' })}
                />
              </div>
            )}

            <div className="fdl-row" style={{ position: 'relative' }}>
              <Select
                ariaLabel="Field scope"
                value={v.field || 'any'}
                onChange={(field) => set({ field })}
                options={[
                  { value: 'any', label: 'All Product Identifiers' },
                  { value: 'trade', label: 'Trade / Brand Name' },
                  { value: 'generic', label: 'Generic / Established Name' },
                  { value: 'unii', label: 'UNII / Ingredient Name' },
                ]}
              />
              <Select
                ariaLabel="Match type"
                value={v.op || 'equals'}
                onChange={(newOp) => {
                  if (newOp === 'equals') {
                    set({ op: newOp, verified: false });
                  } else {
                    set({ op: newOp, verified: true });
                  }
                }}
                options={[
                  { value: 'equals', label: 'is exactly (standardized)' },
                  { value: 'startsWith', label: 'starts with' },
                  { value: 'contains', label: 'contains' },
                  { value: 'notContains', label: 'does not contain' },
                ]}
              />
              {isFlexible ? (
                <input
                  type="text"
                  className="fdl-input"
                  value={v.text || ''}
                  onChange={(e) => set({ text: e.target.value, verified: true })}
                  placeholder="Enter partial product or ingredient name (freeform text)"
                  style={{ flex: 1 }}
                />
              ) : (
                <AutoCompleteInput
                  value={v.text || ''}
                  onChange={(text) => set({ text, verified: isStartsWith ? true : false })}
                  onSelect={(text) => set({ text, verified: true })}
                  placeholder={
                    isStartsWith
                      ? 'Enter prefix or select suggestion (e.g. Tylenol)'
                      : 'Enter product name (select suggestion to verify)'
                  }
                  fetchSuggestions={fetchProductName}
                  minChars={2}
                />
              )}
              {v.text && isExact && v.verified !== false && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    backgroundColor: '#ecfdf5',
                    color: '#065f46',
                    border: '1px solid #a7f3d0',
                    whiteSpace: 'nowrap',
                  }}
                  title="Standardized product name confirmed"
                >
                  ✓ Confirmed
                </span>
              )}
            </div>
            <p className="fdl-note">
              {isExact ? (
                v.verified !== false ? (
                  'Standardized product name is confirmed. Exact match index scan will be used.'
                ) : (
                  <span>
                    Select from auto-complete suggestions to confirm the standardized product name.
                    <span style={{ display: 'block', marginTop: '2px', color: '#0369a1', fontWeight: 600 }}>
                      💡 Tip: Change match type to &ldquo;contains&rdquo; or &ldquo;starts with&rdquo; to allow flexible matching without confirmation.
                    </span>
                  </span>
                )
              ) : isStartsWith ? (
                'Prefix match will search products starting with this term. Auto-complete suggestions are optional.'
              ) : (
                'Flexible match will search products containing this term.'
              )}
            </p>
          </div>
        );
      }

      case 'fullText': {
        const isAdv = (v.mode || 'simple') === 'advanced';
        const isCommon = isCommonFullTextQuery(v.text);
        return (
          <>
            <div className="fdl-row">
              <Select
                ariaLabel="Search mode"
                value={v.mode || 'simple'}
                onChange={(mode) => set({ mode })}
                options={MODE_OPTIONS}
              />
              <input
                className="fdl-input fdl-input--grow"
                type="text"
                value={v.text || ''}
                placeholder={
                  isAdv
                    ? 'Advanced search: regex, wildcards (*, ?, %, .), exact span {NDA}, AND/OR/NOT (escape with \\)'
                    : 'Simple search: enter phrase or text with AND, OR, NOT (e.g. "nausea or vomiting" or "nausea AND vomiting")'
                }
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
            {isCommon && (
              <div
                style={{
                  marginTop: '8px',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>⚠️</span>
                <span>
                  <strong>Generic Word Warning:</strong> Full-text search for common/generic words
                  like &ldquo;{v.text}&rdquo; matches almost all drug labels and is restricted to prevent slow query execution. Please search for a specific medical term, condition, or multi-word phrase.
                </span>
              </div>
            )}
            {SEARCH_HELP}
          </>
        );
      }

      case 'labelingSection': {
        const sections: string[] = v.sections || [];
        const available = list.filter((o) => !sections.includes(o.value));
        const groupedMap = new Map<string, typeof list>();
        for (const opt of available) {
          const g = opt.group || 'Other Sections';
          if (!groupedMap.has(g)) groupedMap.set(g, []);
          groupedMap.get(g)!.push(opt);
        }
        const isAdv = (v.mode || 'simple') === 'advanced';
        const isCommon = isCommonFullTextQuery(v.text);

        return (
          <>
            <div className="fdl-row">
              <Select
                ariaLabel="Search mode"
                value={v.mode || 'simple'}
                onChange={(mode) => set({ mode })}
                options={MODE_OPTIONS}
              />
              <input
                className="fdl-input fdl-input--grow"
                type="text"
                value={v.text || ''}
                placeholder={
                  isAdv
                    ? 'Advanced search: regex, wildcards (*, ?, %, .), exact span {NDA}, AND/OR/NOT (escape with \\)'
                    : 'Simple search: enter phrase or text with AND, OR, NOT (e.g. "nausea or vomiting" or "nausea AND vomiting")'
                }
                onChange={(e) => set({ text: e.target.value })}
              />
              <span className="fdl-row__word">within</span>
              <select
                className="fdl-select fdl-select--wide"
                value=""
                aria-label="Labeling section"
                disabled={options.loading}
                onChange={(e) => {
                  if (e.target.value && !sections.includes(e.target.value)) {
                    set({ sections: [...sections, e.target.value] });
                  }
                }}
              >
                <option value="">
                  {options.loading ? 'Loading sections…' : '-- Select a section (default: Full Text) --'}
                </option>
                {Array.from(groupedMap.entries()).map(([groupLabel, opts]) => (
                  <optgroup key={groupLabel} label={groupLabel}>
                    {opts.map((o) => (
                      <option key={`${groupLabel}-${o.value}`} value={o.value}>
                        {(o.label || o.value) +
                          (o.count !== undefined ? ` (${o.count} labeling)` : '')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {isCommon && (
              <div
                style={{
                  marginTop: '8px',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>⚠️</span>
                <span>
                  <strong>Generic Word Warning:</strong> Section text search for common/generic words
                  like &ldquo;{v.text}&rdquo; matches almost all drug labels and is restricted to prevent slow query execution. Please search for a specific medical term, condition, or multi-word phrase.
                </span>
              </div>
            )}
            {sections.length > 0 ? (
              <Chips
                values={sections}
                onRemove={(value) =>
                  set({ sections: sections.filter((x: string) => x !== value) })
                }
                labelFor={(value) => labelForOption(list, value)}
              />
            ) : (
              <div className="fdl-help-subtle" style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                Scope: Searching full text of labeling (no section filter applied)
              </div>
            )}
            {SEARCH_HELP}
          </>
        );
      }

      case 'marketStatus': {
        const currentStatus = v.status || (values?.[0] ?? '');
        const startDateMin = v.startDateMin || '';
        const startDateMax = v.startDateMax || '';

        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center', paddingTop: '4px', paddingBottom: '4px' }}>
            {/* Status Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.88rem', fontWeight: 600, color: '#334155' }}>Status</label>
              <select
                className="fdl-select"
                value={currentStatus}
                onChange={(e) => {
                  const val = e.target.value;
                  set({ status: val, values: val ? [val] : [] });
                }}
                style={{
                  height: '34px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.88rem',
                  background: '#ffffff',
                  minWidth: '130px',
                }}
              >
                <option value="">-- Select --</option>
                <option value="active">active</option>
                <option value="completed">completed</option>
                <option value="discontinued">discontinued</option>
              </select>
            </div>

            {/* Start Date Min & Max Panel (Styled exactly like attached screenshot) */}
            <div
              style={{
                background: '#e2e8f0',
                padding: '12px 18px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                border: '1px solid #cbd5e1',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Start Date, Min 📅</span>
                <input
                  type="date"
                  value={startDateMin}
                  onChange={(e) => set({ startDateMin: e.target.value })}
                  style={{
                    height: '30px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    background: '#ffffff',
                    color: '#0f172a',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Start Date, Max 📅</span>
                <input
                  type="date"
                  value={startDateMax}
                  onChange={(e) => set({ startDateMax: e.target.value })}
                  style={{
                    height: '30px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    background: '#ffffff',
                    color: '#0f172a',
                  }}
                />
              </div>
            </div>
          </div>
        );
      }

      case 'meddra': {
        const level = (v.level || 'llt').toLowerCase();

        /* Every LLT the query will actually search for, and where it came
         * from. A PT contributes its whole expansion; the LLT row contributes
         * its own picks. An LLT can be both, and an outright pick outranks an
         * exclusion -- the exclusion only says "not via this PT". */
        const derived = new Map<string, string[]>();
        meddraPts.forEach((pt) => {
          (llts[`${targetDb}:pt:${pt}`] || []).forEach((llt) => {
            derived.set(llt, [...(derived.get(llt) || []), pt]);
          });
        });
        const isExcluded = (llt: string) =>
          meddraExcluded.includes(llt) && !meddraLlts.includes(llt);
        const searchedCount =
          meddraLlts.length +
          [...derived.keys()].filter((llt) => !meddraLlts.includes(llt) && !isExcluded(llt)).length;

        const addTerm = (term: string) => {
          const field = level === 'pt' ? 'ptTerms' : 'lltTerms';
          const current: string[] = field === 'ptTerms' ? meddraPts : meddraLlts;
          const nextTerms = current.includes(term) ? current : [...current, term];
          const nextUnverified = unverifiedTerms.filter((u) => u !== term);
          // Adding a term back clears any standing exclusion of it, or the
          // pick would land already crossed out.
          set({
            [field]: nextTerms,
            excludedLlts: meddraExcluded.filter((x) => x !== term),
            verified: nextUnverified.length === 0,
            unverifiedTerms: nextUnverified,
          });
        };

        const removePt = (pt: string) =>
          set({
            ptTerms: meddraPts.filter((x) => x !== pt),
            verified: unverifiedTerms.length === 0,
          });

        const toggleExcluded = (llt: string) =>
          set({
            excludedLlts: meddraExcluded.includes(llt)
              ? meddraExcluded.filter((x) => x !== llt)
              : [...meddraExcluded, llt],
          });

        /* Swaps a directly-picked LLT for the PT above it, which pulls in
         * every sibling LLT -- the difference between the labels that use the
         * user's wording and the labels that mean the same thing. */
        const broadenToPt = (llt: string) => {
          const pt = parentPts[`${targetDb}:${llt}`];
          if (!pt) return;
          set({
            lltTerms: meddraLlts.filter((x) => x !== llt),
            ptTerms: meddraPts.includes(pt) ? meddraPts : [...meddraPts, pt],
            verified: unverifiedTerms.length === 0,
          });
        };

        const lltBadge = (llt: string, fromPts: string[]) => {
          const excluded = isExcluded(llt);
          const direct = meddraLlts.includes(llt);
          const parentPt = direct ? parentPts[`${targetDb}:${llt}`] : null;
          return (
            <span
              key={llt}
              className={`fdl-term-badge${excluded ? ' fdl-term-badge--off' : ''}${direct ? ' fdl-term-badge--direct' : ''}`}
              title={
                fromPts.length
                  ? `${llt} — under ${fromPts.join(', ')}`
                  : `${llt} — picked directly`
              }
            >
              <span className="fdl-term-badge__name">{llt}</span>
              {parentPt ? (
                <button
                  type="button"
                  className="fdl-term-badge__act"
                  onClick={() => broadenToPt(llt)}
                  title={`Broaden to its Preferred Term "${parentPt}" — searches every LLT under it`}
                  aria-label={`Broaden ${llt} to Preferred Term ${parentPt}`}
                >
                  ↑PT
                </button>
              ) : null}
              <button
                type="button"
                className="fdl-term-badge__x"
                onClick={() =>
                  direct
                    ? set({ lltTerms: meddraLlts.filter((x) => x !== llt), verified: unverifiedTerms.length === 0 })
                    : toggleExcluded(llt)
                }
                title={
                  direct
                    ? `Remove ${llt}`
                    : excluded
                      ? `Search ${llt} again`
                      : `Leave ${llt} out of the search`
                }
                aria-label={direct ? `Remove ${llt}` : excluded ? `Restore ${llt}` : `Exclude ${llt}`}
              >
                {excluded ? '+' : '×'}
              </button>
            </span>
          );
        };

        const unverifiedTerms: string[] = Array.isArray(v.unverifiedTerms) ? v.unverifiedTerms : [];

        return (
          <>
            {unverifiedTerms.length > 0 && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ⚠️ Verification Required for MedDRA Term(s)
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>
                    Select standardized PT below to enable search
                  </span>
                </div>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: '#78350f' }}>
                  Please confirm the standardized MedDRA Preferred Term (PT) for each item below:
                </p>
                {unverifiedTerms.map((term) => (
                  <div key={term} style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#78350f', marginBottom: '4px' }}>
                      Term: <em>&ldquo;{term}&rdquo;</em>
                    </div>
                    <UnverifiedMeddraPicker
                      term={term}
                      targetDb={targetDb}
                      onConfirm={(canonical, lvl) => {
                        const nextUnverified = unverifiedTerms.filter((u) => u !== term);
                        const nextPts = lvl === 'pt' && !meddraPts.includes(canonical) ? [...meddraPts, canonical] : meddraPts;
                        const nextLlts = lvl === 'llt' && !meddraLlts.includes(canonical) ? [...meddraLlts, canonical] : meddraLlts;
                        set({
                          unverifiedTerms: nextUnverified,
                          ptTerms: nextPts,
                          lltTerms: nextLlts,
                          verified: nextUnverified.length === 0,
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {['soc', 'hlgt', 'hlt'].includes(String(v.level || '').toLowerCase()) && (
              <div
                style={{
                  marginBottom: '10px',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>⚠️</span>
                <span>
                  <strong>Higher MedDRA Level Disabled:</strong> Searches above Preferred Term (PT) level (such as {String(v.level).toUpperCase()}) are disabled to prevent query timeouts. Please select Preferred Term (PT) or Lowest Level Term (LLT).
                </span>
              </div>
            )}

            <div className="fdl-row">
              <Select
                ariaLabel="MedDRA level"
                value={level}
                onChange={(next) => set({ level: next })}
                options={[
                  { value: 'llt', label: 'Lowest Level Term (LLT)' },
                  { value: 'pt', label: 'Preferred Term (PT)' },
                ]}
              />
              <div className="fdl-row__grow">
                <TokenInput
                  placeholder={
                    level === 'pt'
                      ? 'Begin entering a Preferred Term, then select from suggestions that appear'
                      : 'Begin entering a Lowest Level Term, then select from suggestions that appear'
                  }
                  onCommit={(term) => {
                    addTerm(term);
                  }}
                  fetchSuggestions={fetchMeddra}
                  requireSuggestion={true}
                />
              </div>
            </div>

            {/* The two rows are the selection: a PT is a handle for the LLTs
              * below it, so it cannot share a line with the terms it expands
              * into without reading as one flat list of equals. */}
            {meddraPts.length > 0 && (
              <div className="fdl-term-row">
                <span className="fdl-term-row__label">PT</span>
                <div className="fdl-term-row__items">
                  {meddraPts.map((pt) => {
                    const expansion = llts[`${targetDb}:pt:${pt}`];
                    return (
                      <span key={pt} className="fdl-term-badge fdl-term-badge--pt" title={hierarchies[`${targetDb}:pt:${pt}`] || pt}>
                        <span className="fdl-term-badge__name">{pt}</span>
                        <span className="fdl-term-badge__meta">
                          {expansion === undefined
                            ? '…'
                            : `${expansion.length} LLT${expansion.length === 1 ? '' : 's'}`}
                        </span>
                        <button
                          type="button"
                          className="fdl-term-badge__x"
                          onClick={() => removePt(pt)}
                          aria-label={`Remove ${pt}`}
                          title={`Remove ${pt} and the LLTs it contributes`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {(meddraLlts.length > 0 || derived.size > 0) && (
              <div className="fdl-term-row">
                <span className="fdl-term-row__label">LLT</span>
                <div className="fdl-term-row__items">
                  {meddraLlts.map((llt) => lltBadge(llt, derived.get(llt) || []))}
                  {[...derived.entries()]
                    .filter(([llt]) => !meddraLlts.includes(llt))
                    .map(([llt, fromPts]) => lltBadge(llt, fromPts))}
                </div>
              </div>
            )}

            {(meddraPts.length > 0 || meddraLlts.length > 0) && (
              <div className="fdl-meddra-hierarchies">
                {[...meddraPts.map((t) => ['pt', t]), ...meddraLlts.map((t) => ['llt', t])].map(
                  ([lvl, t]) => (
                    <div key={`${lvl}:${t}`} className="fdl-meddra-hier-item">
                      <span className="fdl-meddra-hier-term">
                        • <strong>{t}</strong> ({lvl.toUpperCase()}):
                      </span>
                      <span className="fdl-meddra-hier-path">
                        {hierarchies[`${targetDb}:${lvl}:${t}`] || 'Loading hierarchy…'}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}

            <p className="fdl-note">
              Labeling text is written at the Lowest Level Term, so that is what is searched:{' '}
              {searchedCount > 0 ? (
                <strong>
                  {searchedCount} LLT{searchedCount === 1 ? '' : 's'}
                </strong>
              ) : (
                'nothing yet'
              )}
              . Adding a Preferred Term brings in every LLT beneath it — remove any that do not
              belong with ×, or press ↑PT on an LLT to widen it to its Preferred Term.
            </p>
          </>
        );
      }

      case 'deaSchedule':
        return (
          <>
            <QuickPicks picks={def.quickPicks!} selected={values} onToggle={toggle} />
            <Chips
              values={values}
              onRemove={(value) => set({ values: values.filter((x: string) => x !== value) })}
              labelFor={(value) => def.quickPicks?.find((p) => p.value === value)?.label || value}
            />
          </>
        );

      case 'activeMoiety':
        return (
          <>
            <div className="fdl-row">
              <Select
                ariaLabel="Match type"
                value={v.op || 'equals'}
                onChange={(op) => set({ op })}
                options={[
                  { value: 'equals', label: 'is exactly' },
                  { value: 'startsWith', label: 'starts with' },
                  { value: 'contains', label: 'contains' },
                ]}
              />
              <div className="fdl-row__grow">
                <TokenInput
                  placeholder="Enter active moiety name(s) or UNII code(s)"
                  values={v.terms || []}
                  onChange={(terms) => set({ terms })}
                />
              </div>
            </div>
            <p className="fdl-note">
              The active moiety is the therapeutically active part of the molecule, so a search for
              amphetamine also returns its salts — which an active ingredient search does not.
              &ldquo;is exactly&rdquo; and &ldquo;starts with&rdquo; use an index; &ldquo;contains&rdquo;
              does not.
            </p>
          </>
        );

      case 'pharmClass':
        return (
          <>
            <div className="fdl-row">
              <div className="fdl-row__grow">
                <TokenInput
                  placeholder="Begin typing a class name, then select from suggestions that appear"
                  values={v.terms || []}
                  onChange={(terms) => set({ terms })}
                  fetchSuggestions={fetchPharmClass}
                  requireSuggestion={true}
                />
              </div>
              <span className="fdl-row__word">of type</span>
              <Select
                ariaLabel="Class type"
                value={v.classType || 'any'}
                onChange={(classType) => set({ classType })}
                options={[
                  { value: 'any', label: 'Any' },
                  { value: 'epc', label: 'Established Pharmacologic Class (EPC)' },
                  { value: 'moa', label: 'Mechanism of Action (MoA)' },
                  { value: 'pe', label: 'Physiologic Effect (PE)' },
                  { value: 'cs', label: 'Chemical Structure (CS)' },
                ]}
              />
            </div>
            <p className="fdl-note">
              Select one or more standardized pharmacologic classes from the suggestions.
              Exact-match indexing will be applied.
            </p>
          </>
        );

      case 'identifier': {
        const multiGuids: string[] = Array.isArray(v.setSplGuids) ? v.setSplGuids : [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Sub-panel 1: SET ID / SPL GUID */}
            <div className="fdl-subpanel">
              <div className="fdl-row fdl-row--tight" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span className="fdl-subpanel-label" style={{ minWidth: '130px' }}>SET ID / SPL GUID:</span>
                <input
                  className="fdl-input"
                  style={{ maxWidth: '380px', flex: '1', minWidth: '220px' }}
                  type="text"
                  value={v.setSplGuid || ''}
                  placeholder="Single SET ID (e.g. ca73b519-015a-436d-aa3c-af53492825a1)"
                  onChange={(e) => set({ setSplGuid: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowMultiSetIdModal(true)}
                  style={{
                    backgroundColor: multiGuids.length > 0 ? '#2563eb' : '#f1f5f9',
                    color: multiGuids.length > 0 ? '#ffffff' : '#334155',
                    border: multiGuids.length > 0 ? '1px solid #1d4ed8' : '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                  }}
                  title="Paste and configure multiple SET-IDs"
                >
                  <span>Multi SET-IDs {multiGuids.length > 0 ? `(${multiGuids.length})` : ''}</span>
                </button>
              </div>

              {multiGuids.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: '#1e40af', fontWeight: 600 }}>
                    Configured SET-IDs ({multiGuids.length}):
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '650px' }}>
                    {multiGuids.slice(0, 5).map((id) => (
                      <span
                        key={id}
                        style={{
                          backgroundColor: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                        }}
                      >
                        {id}
                      </span>
                    ))}
                    {multiGuids.length > 5 && (
                      <span style={{ fontSize: '0.75rem', color: '#64748b', alignSelf: 'center' }}>
                        +{multiGuids.length - 5} more
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => set({ setSplGuids: [] })}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: '0 4px',
                    }}
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {/* Sub-panel 2: Application Number (digits only + optional category dropdown) */}
            <div className="fdl-subpanel">
              <div className="fdl-row fdl-row--tight" style={{ alignItems: 'center' }}>
                <span className="fdl-subpanel-label" style={{ minWidth: '130px' }}>Application No:</span>
                <Select
                  ariaLabel="Application Category (Optional)"
                  value={v.applKind || ''}
                  onChange={(applKind) => set({ applKind })}
                  options={[
                    { value: '', label: 'All Categories' },
                    { value: 'NDA', label: 'NDA' },
                    { value: 'ANDA', label: 'ANDA' },
                    { value: 'BLA', label: 'BLA' },
                  ]}
                />
                <input
                  className="fdl-input"
                  style={{ maxWidth: '280px', flex: '1' }}
                  type="text"
                  value={v.applNum || ''}
                  placeholder="3 to 6 digits (e.g. 021436 or 077844)"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    set({ applNum: digits });
                  }}
                />
              </div>
            </div>

            {/* Sub-panel 3: UNII Identifier Code */}
            <div className="fdl-subpanel">
              <div className="fdl-row fdl-row--tight" style={{ alignItems: 'center' }}>
                <span className="fdl-subpanel-label" style={{ minWidth: '130px' }}>UNII Code:</span>
                <input
                  className="fdl-input"
                  style={{ maxWidth: '240px', flex: '1' }}
                  type="text"
                  value={v.uniiCode || ''}
                  placeholder="10-char UNII (e.g. J220T4J9Q2)"
                  onChange={(e) => set({ uniiCode: e.target.value.toUpperCase() })}
                />
                <Select
                  ariaLabel="UNII Selection Target"
                  value={v.uniiTarget || 'active'}
                  onChange={(uniiTarget) => set({ uniiTarget })}
                  options={[
                    { value: 'active', label: 'Active Ingredient' },
                    { value: 'moiety', label: 'Active Moiety' },
                  ]}
                />
              </div>
            </div>

            {showMultiSetIdModal && (
              <MultiSetIdModal
                initialValues={multiGuids}
                onSave={(newGuids) => {
                  set({ setSplGuids: newGuids });
                  setShowMultiSetIdModal(false);
                }}
                onClose={() => setShowMultiSetIdModal(false)}
              />
            )}
          </div>
        );
      }

      default:
        return null;
    }
  }, [
    criterion.type,
    def,
    fetchMeddra,
    fetchPharmClass,
    fetchProductName,
    hierarchies,
    list,
    quickPickReason,
    llts,
    options.loading,
    set,
    targetDb,
    toggle,
    v,
    values,
  ]);

  return (
    <div className="fdl-card">
      <div className="fdl-card__header">
        <h2 className="fdl-card__title">{def.title}</h2>
        <button
          type="button"
          className="fdl-card__remove-btn"
          onClick={onRemove}
          aria-label={`Remove ${def.title}`}
          title="Remove this criterion"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      {unavailable ? (
        <p className="fdl-note fdl-note--warn" role="status">
          {unavailable}
        </p>
      ) : null}
      <div className="fdl-card__body">{body}</div>
    </div>
  );
}

function UnverifiedProductPicker({
  queryText,
  field,
  targetDb = 'oracle',
  onConfirm,
}: {
  queryText: string;
  field: string;
  targetDb?: TargetDb;
  onConfirm: (name: string) => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/labelquery/suggest/product_name?q=${encodeURIComponent(queryText.trim())}&field=${field}&target_db=${targetDb}`,
        );
        if (res.ok && !cancelled) {
          const json = await res.json();
          setItems(json.suggestions || []);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (queryText.trim().length >= 2) {
      load();
    } else {
      setItems([]);
    }
    return () => {
      cancelled = true;
    };
  }, [queryText, field, targetDb]);

  if (loading) {
    return <span style={{ fontSize: '0.8rem', color: '#b45309' }}>Searching matching standard names…</span>;
  }

  if (!items.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: '#b45309' }}>
          No direct exact matches found for &ldquo;{queryText}&rdquo;. Use the input box below to search suggestions, or confirm:
        </span>
        <button
          type="button"
          onClick={() => onConfirm(queryText.trim())}
          style={{
            background: '#d97706',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 10px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Confirm &ldquo;{queryText.trim()}&rdquo; as-is
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
      {items.slice(0, 10).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onConfirm(item)}
          style={{
            background: '#ffffff',
            color: '#92400e',
            border: '1px solid #d97706',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
          title={`Confirm standard name: ${item}`}
        >
          <span>✓ {item}</span>
        </button>
      ))}
    </div>
  );
}

function UnverifiedMeddraPicker({
  term,
  targetDb = 'oracle',
  onConfirm,
}: {
  term: string;
  targetDb?: TargetDb;
  onConfirm: (canonicalTerm: string, level: 'pt' | 'llt') => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/labelquery/suggest/meddra?q=${encodeURIComponent(term.trim())}&level=pt&target_db=${targetDb}`,
        );
        if (res.ok && !cancelled) {
          const json = await res.json();
          setItems(json.suggestions || []);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (term.trim().length >= 2) load();
    else setItems([]);
    return () => {
      cancelled = true;
    };
  }, [term, targetDb]);

  if (loading) {
    return <span style={{ fontSize: '0.8rem', color: '#b45309' }}>Searching matching MedDRA terms…</span>;
  }

  if (!items.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: '#b45309' }}>
          No exact MedDRA PT match found for &ldquo;{term}&rdquo;.
        </span>
        <button
          type="button"
          onClick={() => onConfirm(term.trim(), 'pt')}
          style={{
            background: '#d97706',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 10px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Confirm &ldquo;{term.trim()}&rdquo; as-is
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
      {items.slice(0, 10).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onConfirm(item, 'pt')}
          style={{
            background: '#ffffff',
            color: '#92400e',
            border: '1px solid #d97706',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '0.82rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
          title={`Confirm MedDRA Preferred Term: ${item}`}
        >
          <span>✓ {item} (PT)</span>
        </button>
      ))}
    </div>
  );
}

function MultiSetIdModal({
  initialValues,
  onSave,
  onClose,
}: {
  initialValues: string[];
  onSave: (setIds: string[]) => void;
  onClose: () => void;
}) {
  const [rawText, setRawText] = useState(initialValues.join('\n'));

  const parsedIds = useMemo(() => {
    return rawText
      .split(/[\r\n;,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [rawText]);

  // Remove duplicates while preserving order
  const uniqueIds = useMemo(() => {
    return Array.from(new Set(parsedIds));
  }, [parsedIds]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b', fontWeight: 700 }}>
            Multi SET-IDs Input
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.4 }}>
          Paste multiple <strong>SET IDs</strong> or <strong>SPL GUIDs</strong> below. Entries can be separated by
          <strong> newlines</strong>, <strong>semicolons (;)</strong>, or <strong>commas (,)</strong>.
        </p>

        <textarea
          rows={8}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`ca73b519-015a-436d-aa3c-af53492825a1\nc7247391-7fb8-4bd8-90db-2d1d072fec01\n43683519-015a-436d-aa3c-af53492825a2`}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.85rem', color: uniqueIds.length > 0 ? '#2563eb' : '#64748b', fontWeight: 600 }}>
            {uniqueIds.length} {uniqueIds.length === 1 ? 'SET-ID' : 'SET-IDs'} detected
            {parsedIds.length !== uniqueIds.length && ` (${parsedIds.length - uniqueIds.length} duplicates filtered)`}
          </span>
          {rawText.trim() && (
            <button
              type="button"
              onClick={() => setRawText('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#ef4444',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Clear Text
            </button>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(uniqueIds)}
            style={{
              padding: '8px 18px',
              borderRadius: '6px',
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Save SET-IDs ({uniqueIds.length})
          </button>
        </div>
      </div>
    </div>
  );
}
