'use client';

/*
 * The tick boxes for AI-suggested categorical pre-filters.
 *
 * Rendered twice from the same state: once inside the AI panel, where it
 * replaces the note that used to say categorical filters had been omitted,
 * and once under the criteria cards, where it is the last thing read before
 * Search. Both are the same list — ticking in one moves the other.
 *
 * These never join the criteria tree here. They are merged in at search time
 * by applyPrefilters(), which is what keeps them undoable right up to the
 * moment the query runs.
 */

import type { CriterionType, PreFilter } from './types';

/** Short enough to sit in front of a value on one chip. */
const TYPE_LABELS: Partial<Record<CriterionType, string>> = {
  labelingType: 'Labeling',
  applicationType: 'Application',
  marketStatus: 'Status',
  route: 'Route',
  dosageForm: 'Form',
  deaSchedule: 'DEA',
};

export function PreFilterChips({
  prefilters,
  onToggle,
  onSetAll,
  variant = 'panel',
}: {
  prefilters: PreFilter[];
  onToggle: (id: string) => void;
  onSetAll?: (checked: boolean) => void;
  variant?: 'panel' | 'ai';
}) {
  if (prefilters.length === 0) return null;

  const checked = prefilters.filter((p) => p.checked).length;
  const allChecked = checked === prefilters.length;

  return (
    <div className={`fdl-prefilters fdl-prefilters--${variant}`}>
      <div className="fdl-prefilters__head">
        <span className="fdl-prefilters__title">
          Filters detected in your description
        </span>
        <span className="fdl-prefilters__lede">
          Applied to the results after the main query runs — the header then reads
          filtered / total.
        </span>
        <span className="fdl-prefilters__count">
          {checked} of {prefilters.length} applied
        </span>
        {onSetAll ? (
          <button
            type="button"
            className="fdl-prefilters__all"
            onClick={() => onSetAll(!allChecked)}
          >
            {allChecked ? 'Uncheck all' : 'Check all'}
          </button>
        ) : null}
      </div>

      <div className="fdl-prefilters__chips">
        {prefilters.map((pre) => (
          <label
            key={pre.id}
            className={`fdl-prefilter ${pre.checked ? 'is-on' : ''}`}
            title={`${TYPE_LABELS[pre.type] || pre.type}: ${pre.value}`}
          >
            <input
              type="checkbox"
              checked={pre.checked}
              onChange={() => onToggle(pre.id)}
            />
            <span className="fdl-prefilter__type">{TYPE_LABELS[pre.type] || pre.type}</span>
            <span className="fdl-prefilter__label">{pre.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
