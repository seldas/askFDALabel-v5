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
  type TargetDb,
  uid,
  unsupportedReason,
} from './types';

export function QueryPanel({
  query,
  onChange,
  options,
  targetDb = 'local',
}: {
  query: LabelQuery;
  onChange: (query: LabelQuery) => void;
  options: OptionLists;
  targetDb?: TargetDb;
}) {
  // Track collapsed sections per group by section key ("groupUid_sectionId")
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const replaceGroup = (index: number, group: CriteriaGroup | null) => {
    const groups = query.groups.slice();
    if (group) groups.splice(index, 1, group);
    else groups.splice(index, 1);
    // Never leave the page with nothing
    onChange({ groups: groups.length ? groups : [makeDefaultGroup()] });
  };

  return (
    <div className="fdl-sectioned-builder">
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
            {SEARCH_SECTIONS.map((sec) => {
              const secKey = `${group.uid}_${sec.id}`;
              const isCollapsed = Boolean(collapsedSections[secKey]);

              // Filter criteria belonging to this section
              const sectionCriteria = group.criteria.filter(
                (c) =>
                  sec.criterionTypes.includes(c.type) && !isCriterionHidden(c.type, targetDb),
              );

              // Count active (non-empty) criteria in this section
              const activeCount = sectionCriteria.filter((c) => !isCriterionEmpty(c)).length;

              return (
                <section
                  key={sec.id}
                  className={`fdl-step-section ${isCollapsed ? 'is-collapsed' : ''}`}
                >
                  <header
                    className="fdl-step-header"
                    onClick={() => toggleSection(secKey)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSection(secKey);
                      }
                    }}
                  >
                    <div className="fdl-step-header__left">
                      <span className="fdl-step-badge">{sec.stepNumber}</span>
                      <div className="fdl-step-header__titles">
                        <h3 className="fdl-step-title">{sec.title}</h3>
                        <p className="fdl-step-subtitle">{sec.subtitle}</p>
                      </div>
                    </div>
                    <div className="fdl-step-header__right">
                      {activeCount > 0 ? (
                        <span className="fdl-active-tag fdl-active-tag--highlight">
                          {activeCount} active
                        </span>
                      ) : sectionCriteria.length > 0 ? (
                        <span className="fdl-active-tag">{sectionCriteria.length} added</span>
                      ) : (
                        <span className="fdl-active-tag fdl-active-tag--none">Optional</span>
                      )}
                      <span className="fdl-collapse-arrow">{isCollapsed ? '▼' : '▲'}</span>
                    </div>
                  </header>

                  {!isCollapsed && (
                    <div className="fdl-step-body">
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
          onClick={() => onChange({ groups: [...query.groups, { uid: uid(), criteria: [] }] })}
        >
          + Add Alternative Criteria Group (OR Logic)
        </button>
      </div>
    </div>
  );
}
