'use client';

/*
 * The modern step-by-step sectioned criteria panel.
 * Grouped into 3 logical steps:
 *   1. Market & Categorical Filters
 *   2. Product Names & Identifiers
 *   3. Labeling Text & Clinical Match
 */

import { useState } from 'react';
import { CriterionCard, type OptionLists } from './CriterionCard';
import {
  CRITERION_DEFS,
  type CriteriaGroup,
  isCriterionEmpty,
  isCriterionHidden,
  type CriterionType,
  type LabelQuery,
  makeCriterion,
  makeDefaultGroup,
  SEARCH_SECTIONS,
  type SearchSectionId,
  type TargetDb,
  uid,
  unsupportedReason,
} from './types';

function ChevronDownIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronUpIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function AlertIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function QueryPanel({
  query,
  onChange,
  options,
  targetDb = 'local',
  visibleSections,
}: {
  query: LabelQuery;
  onChange: (query: LabelQuery) => void;
  options: OptionLists;
  targetDb?: TargetDb;
  visibleSections?: SearchSectionId[];
}) {
  // Track collapsed sections per group by section key ("groupUid_sectionId")
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string, defaultCollapsed = false) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultCollapsed) }));
  };

  const replaceGroup = (index: number, group: CriteriaGroup | null) => {
    const groups = query.groups.slice();
    if (group) groups.splice(index, 1, group);
    else groups.splice(index, 1);
    // Never leave the page with nothing
    onChange({ ...query, groups: groups.length ? groups : [makeDefaultGroup()] });
  };

  const setExactMatch = (exactMatch: boolean) => {
    const groups = query.groups.map((group) => ({
      ...group,
      criteria: group.criteria.map((criterion) => {
        const value = { ...criterion.value } as Record<string, any>;
        if (criterion.type === 'productName') {
          const original = Array.isArray(value.entityOriginalNames)
            ? value.entityOriginalNames
            : String(value.text || '').split(/[;,\n]/).map((name: string) => name.trim()).filter(Boolean);
          const source = exactMatch ? original : value.entityCandidateNames;
          if (Array.isArray(source)) {
            const excluded = new Set((value.entityExcludedNames || []).map((name: string) => String(name).toLowerCase()));
            value.candidateNames = source.filter((name: string) => !excluded.has(String(name).toLowerCase()));
            value.entityOriginalNames = original;
            value.entityCandidateNames = value.entityCandidateNames || original;
            if (exactMatch && value.entityExpansionApplied === undefined) value.entityExpansionApplied = false;
            if (!exactMatch && value.entityExpansionApplied === false) {
              value.entityNamesResolved = false;
            } else {
              value.entityNamesResolved = true;
              value.op = 'equals';
            }
          } else if (!exactMatch) {
            value.candidateNames = undefined;
            value.entityNamesResolved = false;
          }
        }
        if (criterion.type === 'meddra' && Array.isArray(value.entityOriginalLltTerms)) {
          const source = exactMatch ? value.entityOriginalLltTerms : value.entityCandidateLltTerms;
          if (Array.isArray(source)) value.lltTerms = source;
        }
        return { ...criterion, value };
      }),
    }));
    onChange({ ...query, exactMatch, groups });
  };

  const sectionsToRender = SEARCH_SECTIONS.filter(
    (sec) => !visibleSections || visibleSections.includes(sec.id),
  );

  return (
    <div className="fdl-sectioned-builder">
      <div className="fdl-entity-match-option">
        <label className="fdl-checkbox-label">
          <input
            type="checkbox"
            checked={query.exactMatch}
            onChange={(event) => setExactMatch(event.target.checked)}
          />
          <span>Exact Match</span>
        </label>
        <span className="fdl-entity-match-option__help">
          Use recognized drug and AE terms only; leave unchecked to include related drug names and MedDRA terms.
        </span>
      </div>
      {query.groups.map((group, gi) => (
        <div key={group.uid} className="fdl-group-container">
          {query.groups.length > 1 && (
            <div className="fdl-group-header">
              <div className="fdl-group-header__title">
                <span className="fdl-group-badge">Group {gi + 1}</span>
                {gi > 0 && <span className="fdl-group-or-tag">OR Branch</span>}
              </div>
              <button
                type="button"
                className="fdl-group-remove-btn"
                onClick={() => replaceGroup(gi, null)}
                title="Remove this group"
              >
                Remove Group
              </button>
            </div>
          )}

          <div className="fdl-sections-list">
            {sectionsToRender.map((sec, secIdx) => {
              const stepNumber = secIdx + 1;
              const secKey = `${group.uid}_${sec.id}`;
              const isTextUnavailable = sec.id === 'textMatch' && targetDb === 'local';
              const isCollapsed = isTextUnavailable
                ? (collapsedSections[secKey] ?? true)
                : Boolean(collapsedSections[secKey]);

              // Filter criteria belonging to this section
              const sectionCriteria = group.criteria.filter(
                (c) =>
                  (sec.criterionTypes.includes(c.type) || (sec.id === 'textMatch' && c.type === 'fullText')) &&
                  !isCriterionHidden(c.type, targetDb),
              );

              // Count active (non-empty) criteria in this section
              const activeCount = sectionCriteria.filter((c) => !isCriterionEmpty(c)).length;

              // Check if any text search criterion in this section or group uses Advanced mode
              const hasAdvancedSearch = group.criteria.some(
                (c) =>
                  (c.type === 'fullText' || c.type === 'labelingSection') &&
                  (c.value as any)?.mode === 'advanced',
              );

              return (
                <section
                  key={sec.id}
                  className={`fdl-step-section fdl-step-section--step-${stepNumber} fdl-step-section--${sec.id} ${isCollapsed ? 'is-collapsed' : ''} ${isTextUnavailable ? 'is-unavailable' : ''}`}
                >
                  <header
                    className="fdl-step-header"
                    onClick={() => toggleSection(secKey, isTextUnavailable)}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSection(secKey, isTextUnavailable);
                      }
                    }}
                  >
                    <div className="fdl-step-header__left">
                      <span className="fdl-step-badge">{stepNumber}</span>
                      <div className="fdl-step-header__titles">
                        <h3 className="fdl-step-title">
                          {sec.title}
                          {isTextUnavailable && (
                            <span
                              className="fdl-header-disabled-badge"
                              style={{
                                marginLeft: '10px',
                                backgroundColor: '#fef3c7',
                                color: '#92400e',
                                border: '1px solid #f59e0b',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                              }}
                            >
                              <AlertIcon size={12} />
                              <span>No label text in Local DB</span>
                            </span>
                          )}
                        </h3>
                        <p className="fdl-step-subtitle">{sec.subtitle}</p>
                      </div>
                    </div>
                    <div className="fdl-step-header__right">
                      {isTextUnavailable ? (
                        <span className="fdl-active-tag fdl-active-tag--disabled" style={{ background: '#f1f5f9', color: '#64748b' }}>
                          Unavailable (Ignored)
                        </span>
                      ) : activeCount > 0 ? (
                        <span className="fdl-active-tag fdl-active-tag--highlight">
                          {activeCount} active
                        </span>
                      ) : sectionCriteria.length > 0 ? (
                        <span className="fdl-active-tag">{sectionCriteria.length} added</span>
                      ) : (
                        <span className="fdl-active-tag fdl-active-tag--none">Optional</span>
                      )}
                      <span className="fdl-collapse-arrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isCollapsed ? <ChevronDownIcon size={12} /> : <ChevronUpIcon size={12} />}
                      </span>
                    </div>
                  </header>

                  {!isCollapsed && (
                    <div className="fdl-step-body">
                      {isTextUnavailable && (
                        <div className="fdl-local-text-unavailable" role="note">
                          Full-text and clinical text search are unavailable for the Local DB because it does not store searchable label text. Text-search criteria are disabled or ignored; Product Title and Initial U.S. Approval filters remain available.
                        </div>
                      )}
                      {sec.id === 'textMatch' && hasAdvancedSearch && (
                        <div className="fdl-advanced-warning" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span className="fdl-advanced-warning-icon" style={{ flexShrink: 0, marginTop: '2px', color: '#b45309' }}>
                            <AlertIcon size={15} />
                          </span>
                          <div>
                            <strong>Advanced Search Active:</strong> Advanced search supports regular expressions, exact span matching with braces <code>{'{...}'}</code> (e.g., <code>{'{NDA}'}</code>), wildcards (<code>*</code>, <code>?</code>, <code>%</code>, <code>.</code>), and boolean operators (<code>AND</code>, <code>OR</code>, <code>NOT</code>). Ensure syntax rules and backslash escapes (<code>\</code>) are followed to avoid unexpected search results.
                          </div>
                        </div>
                      )}
                      {/* Active Criteria Cards in this section */}
                      {sectionCriteria.length > 0 ? (
                        <div className="fdl-step-cards">
                          {sectionCriteria.map((criterion) => (
                            <div key={criterion.uid} className="fdl-step-card-wrapper">
                              <CriterionCard
                                criterion={criterion}
                                options={options}
                                targetDb={targetDb}
                                onChange={(value) =>
                                  replaceGroup(gi, {
                                    ...group,
                                    criteria: group.criteria.map((c) =>
                                      c.uid === criterion.uid ? { ...c, value } : c,
                                    ),
                                  })
                                }
                                onRemove={() =>
                                  replaceGroup(gi, {
                                    ...group,
                                    criteria: group.criteria.filter(
                                      (c) => c.uid !== criterion.uid,
                                    ),
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="fdl-step-empty">
                          <span>No criteria added in this section yet. Select an option below to configure.</span>
                        </div>
                      )}

                      {/* Add Criteria Buttons for this section */}
                      <div className="fdl-step-add-bar">
                        <span className="fdl-step-add-label">Available Filters:</span>
                        <div className="fdl-step-add-buttons">
                          {sec.criterionTypes.map((type) => {
                            const isAlreadyAdded = group.criteria.some((c) => c.type === type);
                            const reason = unsupportedReason(type, targetDb);
                            const def = CRITERION_DEFS[type];

                            return (
                              <button
                                key={type}
                                type="button"
                                className={`fdl-step-add-btn ${isAlreadyAdded ? 'is-added' : ''}`}
                                disabled={Boolean(reason)}
                                title={
                                  reason ??
                                  (isAlreadyAdded
                                    ? `${def.shortTitle} is currently added`
                                    : `Add ${def.title}`)
                                }
                                onClick={() => {
                                  if (!isAlreadyAdded) {
                                    replaceGroup(gi, {
                                      ...group,
                                      criteria: [...group.criteria, makeCriterion(type)],
                                    });
                                  }
                                }}
                              >
                                {isAlreadyAdded ? '✓ ' : '+ '}
                                {def.shortTitle}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ))}

      <div className="fdl-add-group-row">
        <button
          type="button"
          className="fdl-add-group-btn"
          onClick={() => onChange({ ...query, groups: [...query.groups, { uid: uid(), criteria: [] }] })}
        >
          + Add Alternative Criteria Group (OR Logic)
        </button>
      </div>
    </div>
  );
}
