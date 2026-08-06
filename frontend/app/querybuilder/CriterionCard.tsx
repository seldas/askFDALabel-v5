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
    <p>
      <span className="fdl-help__term">Advanced Search</span>: Supports regular expressions, wildcards (*, ?, %, .), exact span matching with braces <code>{'{...}'}</code> (e.g., <code>{'{NDA}'}</code>), and boolean AND/OR/NOT (escape with <code>\</code>).
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
  /* LLT names under each selected PT, keyed `${level}:${term}`. A PT searches
   * its descendants, so showing them is the only way to see how wide a pick
   * really is before running it. */
  const [llts, setLlts] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (criterion.type !== 'meddra' || !v.terms || v.terms.length === 0) return;
    const level = (v.level || 'pt').toLowerCase();
    v.terms.forEach(async (t: string) => {
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
  }, [criterion.type, v.terms, v.level, targetDb, hierarchies]);

  useEffect(() => {
    // Only a PT has LLTs below it; at LLT level the term is already the leaf.
    if (criterion.type !== 'meddra' || (v.level || 'pt').toLowerCase() !== 'pt') return;
    if (!v.terms || v.terms.length === 0) return;
    v.terms.forEach(async (t: string) => {
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
  }, [criterion.type, v.terms, v.level, targetDb, llts]);

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
        `/api/labelquery/suggest/meddra?q=${encodeURIComponent(q)}&level=${v.level || 'pt'}&target_db=${targetDb}`,
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.suggestions || [];
    },
    [v.level, targetDb],
  );

  const fetchProductName = useCallback(
    async (q: string) => {
      if (q.length < 4) return [];
      const res = await fetch(
        `/api/labelquery/suggest/product_name?q=${encodeURIComponent(q)}&field=${v.field || 'any'}`,
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.suggestions || [];
    },
    [v.field],
  );

  const body = useMemo(() => {
    switch (criterion.type) {
      case 'labelingType':
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
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem', color: '#1e293b', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={!!v.isRldRs}
                  onChange={(e) => set({ isRldRs: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span>RLD / RS (Reference Listed Drug / Reference Standard)</span>
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem', color: '#1e293b', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={!!v.excludeRepackager}
                  onChange={(e) => set({ excludeRepackager: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span>Exclude repacker and repackaging</span>
              </label>
            </div>
          </>
        );

      case 'productName':
        return (
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
              value={v.op || 'contains'}
              onChange={(op) => set({ op })}
              options={[
                { value: 'contains', label: 'contains' },
                { value: 'startsWith', label: 'starts with' },
                { value: 'equals', label: 'is exactly' },
                { value: 'notContains', label: 'does not contain' },
              ]}
            />
            <AutoCompleteInput
              value={v.text || ''}
              onChange={(text) => set({ text })}
              placeholder="Enter product or ingredient name (type 4+ chars for suggestions)"
              fetchSuggestions={fetchProductName}
              minChars={4}
            />
          </div>
        );

      case 'fullText': {
        const isAdv = (v.mode || 'simple') === 'advanced';
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
                  {options.loading ? 'Loading sections…' : '-- Select a section --'}
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
            <Chips
              values={sections}
              onRemove={(value) =>
                set({ sections: sections.filter((x: string) => x !== value) })
              }
              labelFor={(value) => labelForOption(list, value)}
            />
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
        const currentLevel = (v.level || 'pt').toLowerCase();
        const terms = v.terms || [];
        return (
          <>
            <div className="fdl-row">
              <Select
                ariaLabel="MedDRA level"
                value={v.level || 'pt'}
                onChange={(level) => set({ level })}
                options={[
                  { value: 'pt', label: 'Preferred Term (PT)' },
                  { value: 'llt', label: 'Lowest Level Term (LLT)' },
                ]}
              />
              <div className="fdl-row__grow">
                <TokenInput
                  placeholder="Begin entering a MedDRA term, then select from suggestions that appear"
                  values={terms}
                  onChange={(newTerms) => set({ terms: newTerms })}
                  fetchSuggestions={fetchMeddra}
                />
              </div>
            </div>
            {terms.length > 0 && (
              <div className="fdl-meddra-hierarchies">
                {terms.map((t: string) => {
                  const path = hierarchies[`${targetDb}:${currentLevel}:${t}`];
                  const childLlts = currentLevel === 'pt' ? llts[`${targetDb}:pt:${t}`] : undefined;
                  return (
                    <div key={t} className="fdl-meddra-hier-item">
                      <span className="fdl-meddra-hier-term">• <strong>{t}</strong> ({currentLevel.toUpperCase()}):</span>
                      <span className="fdl-meddra-hier-path">
                        {path || 'Loading hierarchy…'}
                      </span>
                      {/* Runs on after the PT rather than onto its own lines:
                        * this is a footnote about what the PT covers, not a
                        * second list to read down. */}
                      {childLlts && childLlts.length > 0 ? (
                        <span className="fdl-meddra-llts">
                          {' '}
                          <span className="fdl-meddra-llts__label">
                            searches {childLlts.length} LLT{childLlts.length === 1 ? '' : 's'}:
                          </span>{' '}
                          {childLlts.join(', ')}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="fdl-note">
              Search by Preferred Term (PT) or Lowest Level Term (LLT). Selecting a PT automatically maps down to all its descendant Lowest Level Terms (LLTs) in labeling.
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
                  placeholder="Begin entering part(s) of a class name, then select from suggestions that appear"
                  values={v.terms || []}
                  onChange={(terms) => set({ terms })}
                  fetchSuggestions={fetchPharmClass}
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
              For a reference list of established pharmacologic classes (EPCs) and attributes that
              define a pharmacologic class (i.e., mechanism of action, physiologic effect, chemical
              structure), start typing above.
            </p>
          </>
        );

      case 'identifier':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Sub-panel 1: SET ID / SPL GUID */}
            <div className="fdl-subpanel">
              <div className="fdl-row fdl-row--tight" style={{ alignItems: 'center' }}>
                <span className="fdl-subpanel-label" style={{ minWidth: '130px' }}>SET ID / SPL GUID:</span>
                <input
                  className="fdl-input"
                  style={{ maxWidth: '380px', flex: '1' }}
                  type="text"
                  value={v.setSplGuid || ''}
                  placeholder="e.g. ca73b519-015a-436d-aa3c-af53492825a1"
                  onChange={(e) => set({ setSplGuid: e.target.value })}
                />
              </div>
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

            {/* Quick Free-text paste fallback */}
            <div style={{ paddingTop: '4px', borderTop: '1px dashed #e2e8f0' }}>
              <input
                className="fdl-input fdl-input--grow"
                style={{ fontSize: '0.78rem' }}
                type="text"
                value={v.text || ''}
                placeholder="Or paste multiple mixed identifiers (SET ID, UNII, Application No)..."
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          </div>
        );

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
