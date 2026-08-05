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
import { AutoCompleteInput, Chips, ListAdder, type Option, QuickPicks, Select, TokenInput } from './controls';
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
      <span className="fdl-help__term">Simple Search</span>: Search for exact text using
      complete words/phrases (ignores non-alphanumeric characters, e.g., ignores &quot;-&quot;,
      &quot;%&quot;)
    </p>
    <p>
      <span className="fdl-help__term">Advanced Search</span> (from drop-down menu): Conduct a
      Boolean and/or partial word search
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

  useEffect(() => {
    if (criterion.type !== 'meddra' || !v.terms || v.terms.length === 0) return;
    const level = (v.level || 'pt').toLowerCase();
    v.terms.forEach(async (t: string) => {
      const key = `${level}:${t}`;
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

  const set = useCallback(
    (patch: Record<string, unknown>) => onChange({ ...v, ...patch }),
    [onChange, v],
  );

  const values: string[] = v.values || [];
  const toggle = useCallback(
    (value: string) =>
      set({
        values: values.includes(value) ? values.filter((x) => x !== value) : [...values, value],
      }),
    [set, values],
  );

  const list = def.optionsKey ? options[def.optionsKey] : [];

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
      case 'applicationType':
      case 'route':
      case 'dosageForm':
        return (
          <>
            {def.quickPicks ? (
              <QuickPicks picks={def.quickPicks} selected={values} onToggle={toggle} />
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

      case 'productName':
        return (
          <div className="fdl-row" style={{ position: 'relative' }}>
            <Select
              ariaLabel="Name field"
              value={v.field || 'any'}
              onChange={(field) => set({ field })}
              options={[
                { value: 'any', label: 'Trade or generic/proper name' },
                { value: 'trade', label: 'Trade name' },
                { value: 'generic', label: 'Generic/proper name' },
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
              placeholder="Enter product name (type 4+ chars for suggestions)"
              fetchSuggestions={fetchProductName}
              minChars={4}
            />
          </div>
        );

      case 'fullText':
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
                placeholder='Enter text (e.g., search for NAUSEA OR VOMITING retrieves labeling containing the phrase "nausea or vomiting")'
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
            {SEARCH_HELP}
          </>
        );

      case 'labelingSection': {
        const sections: string[] = v.sections || [];
        const available = list.filter((o) => !sections.includes(o.value));
        const groupedMap = new Map<string, typeof list>();
        for (const opt of available) {
          const g = opt.group || 'Other Sections';
          if (!groupedMap.has(g)) groupedMap.set(g, []);
          groupedMap.get(g)!.push(opt);
        }

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
                placeholder="Enter text (may leave blank to check for presence of a labeling section)"
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

      case 'marketStatus':
        return (
          <QuickPicks
            prompt="Choose one or more:"
            picks={[
              { label: 'Reference Listed Drug (RLD)', value: 'rld' },
              { label: 'Reference Standard (RS)', value: 'rs' },
              { label: 'Marketed', value: 'marketed' },
              { label: 'Discontinued', value: 'discontinued' },
            ]}
            selected={values}
            onToggle={toggle}
          />
        );

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
                  const key = `${currentLevel}:${t}`;
                  const path = hierarchies[key];
                  return (
                    <div key={t} className="fdl-meddra-hier-item">
                      <span className="fdl-meddra-hier-term">• <strong>{t}</strong> ({currentLevel.toUpperCase()}):</span>
                      <span className="fdl-meddra-hier-path">
                        {path || 'Loading hierarchy…'}
                      </span>
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

      case 'chemicalStructure':
        return (
          <>
            <div className="fdl-row">
              <input
                className="fdl-input fdl-input--grow"
                type="text"
                value={v.structure || ''}
                placeholder="Enter a SMILES string or InChI"
                onChange={(e) => set({ structure: e.target.value })}
              />
              <Select
                ariaLabel="Structure match"
                value={v.match || 'exact'}
                onChange={(match) => set({ match })}
                options={[
                  { value: 'exact', label: 'exact match' },
                  { value: 'substructure', label: 'substructure' },
                  { value: 'similarity', label: 'similarity' },
                ]}
              />
            </div>
            <p className="fdl-note fdl-note--warn">
              This deployment has no chemical structure index, so a structure entered here is
              ignored when the search runs. Use Pharmacologic Class(es) or the ingredient UNII in
              Identifiers instead.
            </p>
          </>
        );

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
          <>
            <textarea
              className="fdl-textarea"
              rows={2}
              value={v.text || ''}
              placeholder="Enter one or more identifiers (separate with a space, comma, semicolon, or colon)"
              onChange={(e) => set({ text: e.target.value })}
            />
            <div className="fdl-row fdl-row--tight">
              <span className="fdl-row__word">Ingredient type (UNII)</span>
              <Select
                ariaLabel="Ingredient type"
                value={v.ingredientType || 'active'}
                onChange={(ingredientType) => set({ ingredientType })}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </div>
            <div className="fdl-help">
              <p>Search for:</p>
              <ul className="fdl-idlist">
                <li>
                  <strong>Application Number for ANDA, BLA, or NDA:</strong> 3 to 6 digits (e.g.,
                  077844, 125118, 020977)
                </li>
                <li>
                  <strong>DEA Schedule</strong> (e.g., CII, CIII, CIV, CV)
                </li>
                <li>
                  <strong>NDC Number</strong> (e.g., 0378-4105, 49702-221)
                </li>
                <li>
                  <strong>OTC Monograph ID</strong> (e.g., M012)
                </li>
                <li>
                  <strong>SET ID:</strong> (e.g., ca73b519-015a-436d-aa3c-af53492825a1)
                </li>
                <li>
                  <strong>Unique Ingredient Identifier (UNII):</strong> alphanumeric code(s) (e.g.,
                  J220T4J9Q2)
                </li>
              </ul>
            </div>
          </>
        );

      default:
        return null;
    }
  }, [
    criterion.type,
    def,
    fetchMeddra,
    fetchPharmClass,
    list,
    options.loading,
    set,
    toggle,
    v,
    values,
  ]);

  return (
    <div className="fdl-card">
      <button
        type="button"
        className="fdl-card__x"
        onClick={onRemove}
        aria-label={`Remove ${def.title}`}
        title="Remove this criterion"
      >
        ×
      </button>
      <h2 className="fdl-card__title">{def.title}</h2>
      {unavailable ? (
        <p className="fdl-note fdl-note--warn" role="status">
          {unavailable}
        </p>
      ) : null}
      <div className="fdl-card__body">{body}</div>
    </div>
  );
}
