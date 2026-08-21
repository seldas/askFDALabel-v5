'use client';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OptionLists } from '../querybuilder/CriterionCard';
import type { QueryFacets } from '../querybuilder/ResultsTable';
import {
  CRITERION_DEFS,
  type Criterion,
  type CriterionType,
  type LabelQuery,
  countFilled,
  isCriterionEmpty,
  isCriterionSupported,
  makeCriterion,
  type TargetDb,
} from '../querybuilder/types';
import { isPickSelected, pickMatches } from '../querybuilder/controls';

interface SidebarFiltersProps {
  query: LabelQuery;
  onChange: (newQuery: LabelQuery) => void;
  options: OptionLists;
  targetDb: TargetDb;
  onTargetDbChange: (db: TargetDb) => void;
  oracleAvailable: boolean;
  totalResults?: number;
  loading?: boolean;
  onClearAll?: () => void;
  facets?: QueryFacets;
  facetsLoading?: boolean;
  className?: string;
}

interface PickItem {
  value: string;
  label: string;
  count: number;
  disabledReason?: string | null;
}

interface ModalData {
  id: string;
  title: string;
  items: Array<{ value: string; label: string; count: number; disabledReason?: string | null }>;
  selectedValues: string[];
  type: CriterionType;
  field: string;
}

export default function SidebarFilters({
  query,
  onChange,
  options,
  targetDb,
  onTargetDbChange,
  oracleAvailable,
  totalResults,
  loading = false,
  onClearAll,
  facets,
  facetsLoading = false,
  className = '',
}: SidebarFiltersProps) {
  // Local draft state for unapplied sidebar filter selections
  const [draftQuery, setDraftQuery] = useState<LabelQuery>(query);
  const [prevQueryProp, setPrevQueryProp] = useState<LabelQuery>(query);

  if (query !== prevQueryProp) {
    setPrevQueryProp(query);
    setDraftQuery(query);
  }

  // Collapsed states per accordion section
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    labelingType: true,
    labelingFormat: true,
    applicationType: true,
    rldFilter: true,
    marketStatus: false,
    route: true,
    dosageForm: false,
    pharmClass: true,
    deaSchedule: false,
  });

  // Modal sub-window state for "Other..." categories
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [modalSearch, setModalSearch] = useState('');

  const toggleAccordion = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Helper to retrieve criterion from first group of draftQuery
  const getGroup = () => draftQuery.groups[0] || { uid: 'g1', criteria: [] };

  const getCriterion = (type: CriterionType): Criterion | undefined => {
    return getGroup().criteria.find((c) => c.type === type);
  };

  const updateCriterion = useCallback(
    (type: CriterionType, valueUpdater: (prevValue: Record<string, any>) => Record<string, any>) => {
      setDraftQuery((prev) => {
        const g = prev.groups[0] || { uid: 'g1', criteria: [] };
        const existingIndex = g.criteria.findIndex((c) => c.type === type);
        let updatedCriteria = [...g.criteria];

        if (existingIndex >= 0) {
          const existing = g.criteria[existingIndex];
          const nextValue = valueUpdater(existing.value as Record<string, any>);
          const updatedCriterion = { ...existing, value: nextValue };

          if (isCriterionEmpty(updatedCriterion)) {
            updatedCriteria.splice(existingIndex, 1);
          } else {
            updatedCriteria[existingIndex] = updatedCriterion;
          }
        } else {
          const fresh = makeCriterion(type);
          const nextValue = valueUpdater(fresh.value as Record<string, any>);
          const newCriterion = { ...fresh, value: nextValue };

          if (!isCriterionEmpty(newCriterion)) {
            updatedCriteria.push(newCriterion);
          }
        }

        const updatedGroups = [{ ...g, criteria: updatedCriteria }, ...prev.groups.slice(1)];
        return { groups: updatedGroups };
      });
    },
    [],
  );

  // Quick helper to toggle array item values
  const toggleArrayValue = (
    type: CriterionType,
    field: string,
    itemValue: string,
  ) => {
    updateCriterion(type, (prevValue) => {
      const currentList: string[] = prevValue[field] || [];
      // Unticking has to drop whatever spelling of this selection is actually
      // stored -- an AI-built query holds "Serotonin Reuptake Inhibitor" where
      // the facet row says "Serotonin Reuptake Inhibitor [EPC]". Matching by
      // equality here would leave the old value in place and append a second.
      const matched = currentList.filter((v) => pickMatches(itemValue, v));

      const nextList = matched.length
        ? currentList.filter((v) => !pickMatches(itemValue, v))
        : [...currentList, itemValue];

      return {
        ...prevValue,
        [field]: nextList,
      };
    });
  };

  // Helper to get count for a facet item
  const getFacetCount = (cat: keyof QueryFacets, val: string): number => {
    if (!facets || !facets[cat]) return 0;
    const item = facets[cat]?.find(
      (f) =>
        f.value === val ||
        f.value.toUpperCase() === val.toUpperCase() ||
        f.label.toUpperCase() === val.toUpperCase(),
    );
    return item ? item.count : 0;
  };

  // Current values
  const ltCrit = getCriterion('labelingType');
  const ltValues: string[] = Array.isArray(ltCrit?.value?.values) ? (ltCrit.value.values as string[]) : [];
  const ltPlr: string = typeof ltCrit?.value?.plr === 'string' ? ltCrit.value.plr : 'all';

  const appCrit = getCriterion('applicationType');
  const appValues: string[] = Array.isArray(appCrit?.value?.values) ? (appCrit.value.values as string[]) : [];
  const isRld = Boolean(appCrit?.value?.isRld);

  const msCrit = getCriterion('marketStatus');
  const msValues: string[] = Array.isArray(msCrit?.value?.values) ? (msCrit.value.values as string[]) : [];
  const msMin: string = typeof msCrit?.value?.startDateMin === 'string' ? msCrit.value.startDateMin : '';
  const msMax: string = typeof msCrit?.value?.startDateMax === 'string' ? msCrit.value.startDateMax : '';

  const routeCrit = getCriterion('route');
  const routeValues: string[] = Array.isArray(routeCrit?.value?.values) ? (routeCrit.value.values as string[]) : [];

  const dosageCrit = getCriterion('dosageForm');
  const dosageValues: string[] = Array.isArray(dosageCrit?.value?.values) ? (dosageCrit.value.values as string[]) : [];

  const pcCrit = getCriterion('pharmClass');
  const pcTerms: string[] = Array.isArray(pcCrit?.value?.terms) ? (pcCrit.value.terms as string[]) : [];

  const deaCrit = getCriterion('deaSchedule');
  const deaValues: string[] = Array.isArray(deaCrit?.value?.values) ? (deaCrit.value.values as string[]) : [];

  // Filter 0-count items PubMed style
  const hasFacets = Boolean(facets && Object.keys(facets).length > 0);

  /**
   * Whether the backend actually counted this category. A category it never
   * computed reads as all-zero, which is not the same claim as "nothing
   * matches" -- hiding its options on that basis emptied the whole panel.
   */
  const isCounted = (cat: keyof QueryFacets) => Array.isArray(facets?.[cat]);

  /**
   * Drops the options nothing in the current result set matches. Two things
   * are never dropped: what the user has ticked, and everything in a category
   * they have already narrowed -- the backend counts such a category with its
   * own filter lifted, so those counts are real and are what the user needs to
   * widen the filter again.
   */
  const visibleItems = (
    cat: keyof QueryFacets,
    sourceItems: PickItem[],
    selectedValues: string[],
  ): PickItem[] => {
    const counted = isCounted(cat);
    // A selection with no row to sit on -- an EPC outside the top 30, or a
    // criterion the model phrased its own way -- gets one. Without it the
    // panel counts the filter as active in its header and offers nothing to
    // untick.
    const orphans = selectedValues
      .filter((sel) => sel && !sourceItems.some((item) => pickMatches(item.value, sel)))
      .map((sel) => ({ value: sel, label: sel, count: 0 }));
    const items = orphans.length ? [...sourceItems, ...orphans] : sourceItems;

    const kept = items.filter((item) => {
      // Always show selected items so the user can untick them.
      if (isPickSelected(item.value, selectedValues)) return true;
      // If the backend never computed counts for this category, show everything.
      if (!counted) return true;
      // When facets are available, show all items (including 0-count ones) so
      // the user can see which options are unavailable under the current filters.
      return true;
    });
    if (!counted) return kept;
    // Only the first five are shown outright, so what the result set actually
    // contains has to lead -- otherwise a retained 0-count sibling pushes a
    // real option into the "Other…" modal.
    return kept
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        if (a.item.count !== b.item.count) return b.item.count - a.item.count;
        return a.index - b.index;
      })
      .map(({ item }) => item);
  };

  // 1. Labeling Types
  const facetLabelingTypes = visibleItems('labelingTypes', facets?.labelingTypes || [], ltValues);
  const fallbackLabelingTypes = visibleItems(
    'labelingTypes',
    (CRITERION_DEFS.labelingType.quickPicks || []).map((pick) => ({
      value: pick.value,
      label: pick.label,
      count: getFacetCount('labelingTypes', pick.value),
      disabledReason: pick.unavailableOn?.targets.includes(targetDb) ? pick.unavailableOn.reason : null,
    })),
    ltValues,
  );
  const labelingPicks = facetLabelingTypes.length > 0 ? facetLabelingTypes : fallbackLabelingTypes;

  // 2. Application Types
  const appPicks = visibleItems(
    'applicationTypes',
    (CRITERION_DEFS.applicationType.quickPicks || []).map((pick) => ({
      value: pick.value,
      label: pick.label,
      count: getFacetCount('applicationTypes', pick.value),
    })),
    appValues,
  );
  const rldCount = getFacetCount('applicationTypes', 'RLD');

  // 3. Market Status
  const statusPicks = visibleItems(
    'marketStatus',
    ['Prescription', 'OTC', 'Discontinued'].map((st) => ({
      value: st,
      label: st,
      count: getFacetCount('marketStatus', st),
    })),
    msValues,
  );

  // 4. Routes
  const facetRoutes = visibleItems('routes', facets?.routes || [], routeValues);
  const fallbackRoutes = visibleItems(
    'routes',
    (CRITERION_DEFS.route.quickPicks || []).map((pick) => ({
      value: pick.value,
      label: pick.label,
      count: getFacetCount('routes', pick.value),
    })),
    routeValues,
  );
  const routeItems = facetRoutes.length > 0 ? facetRoutes : fallbackRoutes;

  // 5. Dosage Forms
  const facetDosages = visibleItems('dosageForms', facets?.dosageForms || [], dosageValues);
  const fallbackDosages = visibleItems(
    'dosageForms',
    (CRITERION_DEFS.dosageForm.quickPicks || []).map((pick) => ({
      value: pick.value,
      label: pick.label,
      count: getFacetCount('dosageForms', pick.value),
    })),
    dosageValues,
  );
  const dosageItems = facetDosages.length > 0 ? facetDosages : fallbackDosages;

  // 6. Pharm Classes (EPC)
  const facetEpcs = visibleItems('pharmClasses', facets?.pharmClasses || [], pcTerms);

  // 7. DEA Schedule
  const deaPicks = visibleItems(
    'deaSchedule',
    (CRITERION_DEFS.deaSchedule.quickPicks || []).map((pick) => ({
      value: pick.value,
      label: pick.label,
      count: getFacetCount('deaSchedule', pick.value),
    })),
    deaValues,
  );

  const totalFilled = countFilled(query);

  // Top-5 category renderer helper with "Other..." modal trigger
  const renderCategorySection = (
    sectionId: string,
    sectionTitle: string,
    items: Array<{ value: string; label: string; count: number; disabledReason?: string | null }>,
    selectedValues: string[],
    type: CriterionType,
    field: string = 'values',
    facetCategory?: keyof QueryFacets,
  ) => {
    // getFacetCount reports 0 for a category the backend never counted, which
    // reads as "no labels match" when it means "no number was computed". Only
    // show the badge for a category the payload actually carries.
    const showCounts = hasFacets && (!facetCategory || isCounted(facetCategory));
    const top5 = items.slice(0, 5);
    const remaining = items.slice(5);

    return (
      <>
        <div className="fdl-filter-checkboxes">
          {top5.map((pick) => {
            const isChecked = isPickSelected(pick.value, selectedValues);
            return (
              <label
                key={pick.value}
                className={`fdl-checkbox-label ${pick.disabledReason ? 'is-disabled' : ''}`}
                title={pick.disabledReason || pick.label}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={Boolean(pick.disabledReason)}
                  onChange={() => toggleArrayValue(type, field, pick.value)}
                />
                <span>{pick.label}</span>
                {showCounts && <span className={`fdl-facet-count${pick.count === 0 ? ' fdl-facet-count--zero' : ''}`}>({pick.count.toLocaleString()})</span>}
              </label>
            );
          })}
        </div>

        {remaining.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <button
              type="button"
              className="fdl-link"
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#2563eb',
                background: 'none',
                border: 'none',
                padding: '2px 0',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onClick={() => {
                setModalSearch('');
                setModalData({
                  id: sectionId,
                  title: sectionTitle,
                  items,
                  selectedValues,
                  type,
                  field,
                });
              }}
            >
              <span>Other ({remaining.length} more)…</span>
            </button>
          </div>
        )}
      </>
    );
  };

  // Filtered items inside active modal sub-window
  const activeModalSelectedValues = modalData
    ? (getCriterion(modalData.type)?.value?.[modalData.field] as string[]) || []
    : [];

  const modalFilteredItems = (modalData?.items || []).filter(
    (item) =>
      item.label.toLowerCase().includes(modalSearch.toLowerCase()) ||
      item.value.toLowerCase().includes(modalSearch.toLowerCase()),
  );

  const hasPendingChanges = JSON.stringify(draftQuery) !== JSON.stringify(query);

  const handleApplyFilters = () => {
    onChange(draftQuery);
  };

  return (
    <div className={`fdl-sidebar-filters ${className}`} aria-busy={loading}>
      {/* Sticky Header Container (Sticks to top when scrolling) */}
      <div className="fdl-sidebar-filters__sticky-header">
        <div className="fdl-sidebar-filters__head" style={{ marginBottom: '10px', borderBottom: 'none', paddingBottom: 0 }}>
          <div className="fdl-sidebar-filters__title-row">
            <h3 className="fdl-sidebar-filters__title">Filter Results</h3>
          </div>

          {/* Status spinner */}
          <div className="fdl-sidebar-filters__status" role="status" aria-live="polite">
            {loading || facetsLoading ? (
              <>
                <span className="fdl-sidebar-filters__spinner" aria-hidden="true" />
                <span>{loading ? 'Updating results…' : 'Counting…'}</span>
              </>
            ) : null}
          </div>
          {totalFilled > 0 && onClearAll && (
            <button
              type="button"
              className="fdl-sidebar-filters__clear"
              onClick={onClearAll}
            >
              Clear All
            </button>
          )}
        </div>

        {/* Prominent Apply Filters Button at Top */}
        <button
          type="button"
          className={`fdl-sidebar-filters__apply-btn ${hasPendingChanges ? 'has-changes' : ''}`}
          onClick={handleApplyFilters}
          disabled={loading}
          style={{ marginBottom: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>
            {hasPendingChanges ? 'Apply Filters (Pending Changes)' : 'Apply Filters'}
          </span>
        </button>
      </div>

      <div className="fdl-sidebar-filters__accordions">
        {/* 1. Labeling Types */}
        {labelingPicks.length > 0 && (
          <div className={`fdl-filter-group ${openSections.labelingType ? 'is-open' : ''}`}>
            <button
              type="button"
              className="fdl-filter-group__header"
              onClick={() => toggleAccordion('labelingType')}
            >
              <span className="fdl-filter-group__name">Labeling Type</span>
              <span className="fdl-filter-group__right">
                {ltValues.length > 0 && (
                  <span className="fdl-filter-group__count">{ltValues.length}</span>
                )}
                <span className="fdl-filter-group__arrow">{openSections.labelingType ? '▲' : '▼'}</span>
              </span>
            </button>

            {openSections.labelingType && (
              <div className="fdl-filter-group__body">
                {renderCategorySection('labelingType', 'Labeling Types', labelingPicks, ltValues, 'labelingType', 'values', 'labelingTypes')}
              </div>
            )}
          </div>
        )}

        {/* 2. Standalone Labeling Format Panel */}
        {/*
          FORMAT_GROUP (PLR / non-PLR) is only classified on the CDER-CBER
          Oracle rollup (DGV_SUM_RX_SPL) -- see oracle_compiler._compile_labeling_type.
          Local Postgres and the "FDA ver." Oracle scope (SUM_SPL) have no such
          column, so the panel is folded shut and unclickable there rather than
          left open to a filter that silently does nothing.
        */}
        {(() => {
          const labelingFormatSupported = targetDb === 'oracle';
          const labelingFormatReason =
            'Labeling Format (PLR / non-PLR) is only classified for the CDER-CBER Oracle database and is not available here.';
          const isOpen = labelingFormatSupported && openSections.labelingFormat;
          return (
            <div
              className={`fdl-filter-group ${isOpen ? 'is-open' : ''} ${
                labelingFormatSupported ? '' : 'is-disabled'
              }`}
              title={labelingFormatSupported ? undefined : labelingFormatReason}
            >
              <button
                type="button"
                className="fdl-filter-group__header"
                disabled={!labelingFormatSupported}
                onClick={() => labelingFormatSupported && toggleAccordion('labelingFormat')}
              >
                <span className="fdl-filter-group__name">Labeling Format</span>
                <span className="fdl-filter-group__right">
                  {ltPlr !== 'all' && (
                    <span className="fdl-filter-group__count">1</span>
                  )}
                  <span className="fdl-filter-group__arrow">{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>

              {isOpen && (
                <div className="fdl-filter-group__body">
                  <div className="fdl-radio-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { id: 'all', label: 'All Formats', count: totalResults },
                      { id: 'plr', label: 'PLR Format', count: getFacetCount('labelingFormat', 'plr') },
                      { id: 'non_plr', label: 'non-PLR Format', count: getFacetCount('labelingFormat', 'non_plr') },
                      { id: 'unclassified', label: 'Unclassified / Other', count: getFacetCount('labelingFormat', 'unclassified') },
                    ].map((fmt) => (
                      <label key={fmt.id} className="fdl-radio-label">
                        <input
                          type="radio"
                          name="labelingFormatOption"
                          checked={ltPlr === fmt.id}
                          onChange={() =>
                            updateCriterion('labelingType', (prev) => ({ ...prev, plr: fmt.id }))
                          }
                        />
                        <span>{fmt.label}</span>
                        {hasFacets && isCounted('labelingFormat') && fmt.count !== undefined && (
                          <span className={`fdl-facet-count${fmt.count === 0 ? ' fdl-facet-count--zero' : ''}`}>
                            ({fmt.count.toLocaleString()})
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 3. Marketing Categories / Application Types */}
        {isCriterionSupported('applicationType', targetDb) && (appPicks.length > 0 || appValues.length > 0) && (
          <div className={`fdl-filter-group ${openSections.applicationType ? 'is-open' : ''}`}>
            <button
              type="button"
              className="fdl-filter-group__header"
              onClick={() => toggleAccordion('applicationType')}
            >
              <span className="fdl-filter-group__name">Marketing Category</span>
              <span className="fdl-filter-group__right">
                {appValues.length > 0 && (
                  <span className="fdl-filter-group__count">{appValues.length}</span>
                )}
                <span className="fdl-filter-group__arrow">
                  {openSections.applicationType ? '▲' : '▼'}
                </span>
              </span>
            </button>

            {openSections.applicationType && (
              <div className="fdl-filter-group__body">
                {renderCategorySection('applicationType', 'Marketing Categories', appPicks, appValues, 'applicationType', 'values', 'applicationTypes')}
              </div>
            )}
          </div>
        )}

        {/* 3b. Reference Listed Drug (RLD) — standalone filter */}
        {isCriterionSupported('applicationType', targetDb) && (rldCount > 0 || isRld || !hasFacets) && (
          <div className={`fdl-filter-group ${openSections.rldFilter ? 'is-open' : ''}`}>
            <button
              type="button"
              className="fdl-filter-group__header"
              onClick={() => toggleAccordion('rldFilter')}
            >
              <span className="fdl-filter-group__name">Reference Listed Drug</span>
              <span className="fdl-filter-group__right">
                {isRld && <span className="fdl-filter-group__count">1</span>}
                <span className="fdl-filter-group__arrow">
                  {openSections.rldFilter ? '▲' : '▼'}
                </span>
              </span>
            </button>

            {openSections.rldFilter && (
              <div className="fdl-filter-group__body">
                <div className="fdl-filter-checkboxes">
                  <label className="fdl-checkbox-label">
                    <input
                      type="checkbox"
                      checked={isRld}
                      onChange={(e) =>
                        updateCriterion('applicationType', (prev) => ({
                          ...prev,
                          isRld: e.target.checked,
                        }))
                      }
                    />
                    <span>Reference Listed Drug (RLD)</span>
                    {hasFacets && isCounted('applicationTypes') && (
                      <span className={`fdl-facet-count${rldCount === 0 ? ' fdl-facet-count--zero' : ''}`}>({rldCount.toLocaleString()})</span>
                    )}
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. Market Status */}
        {(statusPicks.length > 0 || msMin || msMax) && (
          <div className={`fdl-filter-group ${openSections.marketStatus ? 'is-open' : ''}`}>
            <button
              type="button"
              className="fdl-filter-group__header"
              onClick={() => toggleAccordion('marketStatus')}
            >
              <span className="fdl-filter-group__name">Market Status</span>
              <span className="fdl-filter-group__right">
                {msValues.length + (msMin || msMax ? 1 : 0) > 0 && (
                  <span className="fdl-filter-group__count">
                    {msValues.length + (msMin || msMax ? 1 : 0)}
                  </span>
                )}
                <span className="fdl-filter-group__arrow">
                  {openSections.marketStatus ? '▲' : '▼'}
                </span>
              </span>
            </button>

            {openSections.marketStatus && (
              <div className="fdl-filter-group__body">
                {renderCategorySection('marketStatus', 'Market Status', statusPicks, msValues, 'marketStatus', 'values', 'marketStatus')}

                {/* Start Date Range */}
                <div className="fdl-filter-subgroup" style={{ marginTop: '10px' }}>
                  <span className="fdl-filter-subgroup__title">Marketing Start Date:</span>
                  <div className="fdl-date-range">
                    <input
                      type="date"
                      className="fdl-date-input"
                      value={msMin}
                      onChange={(e) =>
                        updateCriterion('marketStatus', (prev) => ({
                          ...prev,
                          startDateMin: e.target.value,
                        }))
                      }
                      placeholder="Min Date"
                    />
                    <span>to</span>
                    <input
                      type="date"
                      className="fdl-date-input"
                      value={msMax}
                      onChange={(e) =>
                        updateCriterion('marketStatus', (prev) => ({
                          ...prev,
                          startDateMax: e.target.value,
                        }))
                      }
                      placeholder="Max Date"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. Route of Administration */}
        <div className={`fdl-filter-group ${openSections.route ? 'is-open' : ''}`}>
          <button
            type="button"
            className="fdl-filter-group__header"
            onClick={() => toggleAccordion('route')}
          >
            <span className="fdl-filter-group__name">Route of Administration</span>
            <span className="fdl-filter-group__right">
              {routeValues.length > 0 && (
                <span className="fdl-filter-group__count">{routeValues.length}</span>
              )}
              <span className="fdl-filter-group__arrow">{openSections.route ? '▲' : '▼'}</span>
            </span>
          </button>

          {openSections.route && (
            <div className="fdl-filter-group__body">
              {renderCategorySection('route', 'Routes of Administration', routeItems, routeValues, 'route', 'values', 'routes')}
            </div>
          )}
        </div>

        {/* 6. Dosage Form */}
        <div className={`fdl-filter-group ${openSections.dosageForm ? 'is-open' : ''}`}>
          <button
            type="button"
            className="fdl-filter-group__header"
            onClick={() => toggleAccordion('dosageForm')}
          >
            <span className="fdl-filter-group__name">Dosage Form</span>
            <span className="fdl-filter-group__right">
              {dosageValues.length > 0 && (
                <span className="fdl-filter-group__count">{dosageValues.length}</span>
              )}
              <span className="fdl-filter-group__arrow">{openSections.dosageForm ? '▲' : '▼'}</span>
            </span>
          </button>

          {openSections.dosageForm && (
            <div className="fdl-filter-group__body">
              {renderCategorySection('dosageForm', 'Dosage Forms', dosageItems, dosageValues, 'dosageForm', 'values', 'dosageForms')}
            </div>
          )}
        </div>

        {/* 7. Pharmacologic Class (EPC) */}
        {facetEpcs.length > 0 && (
          <div className={`fdl-filter-group ${openSections.pharmClass ? 'is-open' : ''}`}>
            <button
              type="button"
              className="fdl-filter-group__header"
              onClick={() => toggleAccordion('pharmClass')}
            >
              <span className="fdl-filter-group__name">Pharm Class (EPC)</span>
              <span className="fdl-filter-group__right">
                {pcTerms.length > 0 && (
                  <span className="fdl-filter-group__count">{pcTerms.length}</span>
                )}
                <span className="fdl-filter-group__arrow">{openSections.pharmClass ? '▲' : '▼'}</span>
              </span>
            </button>

            {openSections.pharmClass && (
              <div className="fdl-filter-group__body">
                {renderCategorySection('pharmClass', 'Pharmacologic Classes (EPC)', facetEpcs, pcTerms, 'pharmClass', 'terms', 'pharmClasses')}
              </div>
            )}
          </div>
        )}

        {/* 8. DEA Schedule */}
        {isCriterionSupported('deaSchedule', targetDb) && (deaPicks.length > 0 || deaValues.length > 0) && (
          <div className={`fdl-filter-group ${openSections.deaSchedule ? 'is-open' : ''}`}>
            <button
              type="button"
              className="fdl-filter-group__header"
              onClick={() => toggleAccordion('deaSchedule')}
            >
              <span className="fdl-filter-group__name">DEA Schedule</span>
              <span className="fdl-filter-group__right">
                {deaValues.length > 0 && (
                  <span className="fdl-filter-group__count">{deaValues.length}</span>
                )}
                <span className="fdl-filter-group__arrow">
                  {openSections.deaSchedule ? '▲' : '▼'}
                </span>
              </span>
            </button>

            {openSections.deaSchedule && (
              <div className="fdl-filter-group__body">
                {renderCategorySection('deaSchedule', 'DEA Schedule', deaPicks, deaValues, 'deaSchedule', 'values', 'deaSchedule')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prominent Apply Filters Button at Bottom */}
      <div style={{ marginTop: '16px' }}>
        <button
          type="button"
          className={`fdl-sidebar-filters__apply-btn ${hasPendingChanges ? 'has-changes' : ''}`}
          onClick={handleApplyFilters}
          disabled={loading}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>
            {hasPendingChanges ? 'Apply Filters (Pending Changes)' : 'Apply Filters'}
          </span>
        </button>
      </div>

      {/* Sub-window Modal for "Other..." categories rendered via Portal to document.body */}
      {modalData && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999999,
            padding: '1rem',
          }}
          onClick={() => setModalData(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              border: '1px solid #cbd5e1',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                  All {modalData.title}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                  {modalData.items.length} matching categories
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalData(null)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '4px 10px',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  color: '#475569',
                }}
              >
                ✕ Close
              </button>
            </div>

            {/* In-Modal Search Input */}
            <div style={{ marginBottom: '14px' }}>
              <input
                type="text"
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                placeholder={`Filter ${modalData.title.toLowerCase()}...`}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  background: '#f8fafc',
                  color: '#0f172a',
                  fontWeight: 600,
                }}
              />
            </div>

            {/* Modal Scrollable List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                paddingRight: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {modalFilteredItems.map((item) => {
                const isChecked = isPickSelected(item.value, activeModalSelectedValues);
                return (
                  <label
                    key={item.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: isChecked ? '#eff6ff' : '#ffffff',
                      border: `1px solid ${isChecked ? '#93c5fd' : '#f1f5f9'}`,
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#1e293b',
                      cursor: item.disabledReason ? 'not-allowed' : 'pointer',
                      opacity: item.disabledReason ? 0.6 : 1,
                    }}
                    title={item.disabledReason || item.label}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={Boolean(item.disabledReason)}
                      onChange={() => toggleArrayValue(modalData.type, modalData.field, item.value)}
                    />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.count > 0 && (
                      <span className="fdl-facet-count">({item.count.toLocaleString()})</span>
                    )}
                  </label>
                );
              })}
              {modalFilteredItems.length === 0 && (
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center', margin: '20px 0' }}>
                  No matching categories found.
                </p>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                marginTop: '16px',
                paddingTop: '12px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={() => setModalData(null)}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 20px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
