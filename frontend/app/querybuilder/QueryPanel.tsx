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
  type CriterionType,
  type LabelQuery,
  makeCriterion,
  makeDefaultGroup,
  uid,
} from './types';

export function QueryPanel({
  query,
  onChange,
  options,
}: {
  query: LabelQuery;
  onChange: (query: LabelQuery) => void;
  options: OptionLists;
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
        <div key={group.uid}>
          {gi > 0 ? <div className="fdl-or">OR</div> : null}
          <div className="fdl-group">
            <button
              type="button"
              className="fdl-group__x"
              onClick={() => replaceGroup(gi, null)}
              aria-label="Remove this group of criteria"
              title="Remove this group"
            >
              ×
            </button>

            {group.criteria.map((criterion, ci) => (
              <div key={criterion.uid} className="fdl-cardrow">
                <span className="fdl-amp" aria-hidden="true">
                  {ci > 0 ? '&' : ''}
                </span>
                <CriterionCard
                  criterion={criterion}
                  options={options}
                  onChange={(value) => {
                    const criteria = group.criteria.slice();
                    criteria.splice(ci, 1, { ...criterion, value });
                    replaceGroup(gi, { ...group, criteria });
                  }}
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
              {ADD_MORE_ORDER.map((type: CriterionType, i) => (
                <span key={type} className="fdl-addmore__item">
                  {i > 0 ? <span className="fdl-addmore__sep">|</span> : null}
                  <button
                    type="button"
                    className="fdl-link"
                    onClick={() =>
                      replaceGroup(gi, {
                        ...group,
                        criteria: [...group.criteria, makeCriterion(type)],
                      })
                    }
                  >
                    {CRITERION_DEFS[type].shortTitle}
                  </button>
                </span>
              ))}
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
