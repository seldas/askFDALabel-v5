'use client';

/*
 * The criteria panel: groups of cards, ANDed within a group and ORed across
 * groups — the same structure the compiler expects, drawn the way FDALabel
 * draws it (an "&" gutter between cards, a nested tinted box per group).
 */

import { CriterionCard, type OptionLists } from './CriterionCard';
import {
  ADD_MORE_ORDER,
  CRITERION_DEFS,
  type CriteriaGroup,
  isCriterionHidden,
  type CriterionType,
  type LabelQuery,
  makeCriterion,
  makeDefaultGroup,
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
  const replaceGroup = (index: number, group: CriteriaGroup | null) => {
    const groups = query.groups.slice();
    if (group) groups.splice(index, 1, group);
    else groups.splice(index, 1);
    // Never leave the page with nothing to type into.
    onChange({ groups: groups.length ? groups : [makeDefaultGroup()] });
  };

  return (
    <>
      {query.groups.map((group, gi) => (
        <div key={group.uid} className="fdl-group">
          {gi > 0 && <span className="fdl-or">OR</span>}
          <div className="fdl-group__card">
            {query.groups.length > 1 && (
              <button
                type="button"
                className="fdl-group__x"
                onClick={() => replaceGroup(gi, null)}
                aria-label="Remove this group of criteria"
                title="Remove this group"
              >
                ×
              </button>
            )}

            {/* Hidden criteria stay in `group.criteria` and keep their values;
              * only the card is withheld. Edits are addressed by uid rather
              * than by index, since the rendered position no longer matches
              * the position in the query. */}
            {group.criteria
              .filter((criterion) => !isCriterionHidden(criterion.type, targetDb))
              .map((criterion, visibleIndex) => (
                <div key={criterion.uid} className="fdl-cardrow">
                  <span className="fdl-amp" aria-hidden="true">
                    {visibleIndex > 0 ? '&' : ''}
                  </span>
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
                        criteria: group.criteria.filter((c) => c.uid !== criterion.uid),
                      })
                    }
                  />
                </div>
              ))}

            <div className="fdl-addmore">
              <span className="fdl-addmore__label">Add more criteria:</span>
              {ADD_MORE_ORDER.map((type: CriterionType, i) => {
                /* The row entry stays put and goes disabled, even for criteria
                 * whose card is hidden above: it is the only place left that
                 * explains why the card is gone, and an entry vanishing from
                 * the row too would just read as a bug. */
                const reason = unsupportedReason(type, targetDb);
                return (
                  <span key={type} className="fdl-addmore__item">
                    {i > 0 ? <span className="fdl-addmore__sep">|</span> : null}
                    <button
                      type="button"
                      className="fdl-link"
                      disabled={Boolean(reason)}
                      title={reason ?? undefined}
                      aria-describedby={reason ? `fdl-unavail-${type}` : undefined}
                      onClick={() =>
                        replaceGroup(gi, {
                          ...group,
                          criteria: [...group.criteria, makeCriterion(type)],
                        })
                      }
                    >
                      {CRITERION_DEFS[type].shortTitle}
                    </button>
                    {reason ? (
                      <span id={`fdl-unavail-${type}`} className="fdl-sr-only">
                        {reason}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="fdl-link fdl-link--block"
        onClick={() => onChange({ groups: [...query.groups, { uid: uid(), criteria: [] }] })}
      >
        Add New Group of Criteria
      </button>
    </>
  );
}
