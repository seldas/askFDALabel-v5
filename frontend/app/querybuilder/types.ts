/*
 * The criteria tree, and the catalog describing how each criterion renders.
 *
 * Shapes here mirror backend/labelquery/compiler.py exactly — a criterion's
 * `value` is posted verbatim. Keep the two in step: the compiler rejects unknown
 * types outright, and silently ignores keys it does not read.
 *
 * `uid` is client-only (React keys, remove buttons) and is stripped before the
 * query is sent.
 */

export type CriterionType =
  | 'labelingType'
  | 'applicationType'
  | 'productName'
  | 'fullText'
  | 'labelingSection'
  | 'marketStatus'
  | 'meddra'
  | 'chemicalStructure'
  | 'route'
  | 'pharmClass'
  | 'identifier';

export type CriterionValue = Record<string, unknown>;

export interface Criterion {
  uid: string;
  type: CriterionType;
  value: CriterionValue;
}

export interface CriteriaGroup {
  uid: string;
  criteria: Criterion[];
}

export interface LabelQuery {
  groups: CriteriaGroup[];
}

/** Wire format — what /api/labelquery/execute accepts and /translate returns. */
export interface WireQuery {
  groups: Array<{ criteria: Array<{ type: CriterionType; value: CriterionValue }> }>;
}

export interface QuickPick {
  label: string;
  /** Sent as-is; `%` makes it a LIKE pattern against the `; `-joined column. */
  value: string;
}

export interface CriterionDef {
  type: CriterionType;
  title: string;
  /** Shown in the "Add more criteria" row. */
  shortTitle: string;
  quickPicks?: QuickPick[];
  /** Which /api/labelquery/options list feeds this card's dropdown. */
  optionsKey?: 'labelingTypes' | 'applicationTypes' | 'routes' | 'sections';
  defaultValue: () => CriterionValue;
}

let counter = 0;
export const uid = () => `c${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/*
 * Quick-pick values are LIKE patterns rather than exact doc_type strings on
 * purpose: SPL document types vary ("HUMAN PRESCRIPTION DRUG LABEL",
 * "PRESCRIPTION DRUG LABEL FOR HUMAN USE"), and a substring is the only match
 * that survives that. The dropdown below each row still offers exact values
 * pulled live from the database.
 */
export const CRITERION_DEFS: Record<CriterionType, CriterionDef> = {
  labelingType: {
    type: 'labelingType',
    title: 'Labeling Types',
    shortTitle: 'Labeling Types',
    optionsKey: 'labelingTypes',
    quickPicks: [
      { label: 'Animal Rx', value: '%ANIMAL%PRESCRIPTION%' },
      { label: 'Animal OTC', value: '%ANIMAL%OTC%' },
      { label: 'Human Rx', value: '%HUMAN PRESCRIPTION%' },
      { label: 'Human OTC', value: '%HUMAN OTC%' },
      { label: 'Vaccine', value: '%VACCINE%' },
    ],
    defaultValue: () => ({ values: [] }),
  },
  applicationType: {
    type: 'applicationType',
    title: 'Application Types or Marketing Categories',
    shortTitle: 'Application Types or Marketing Categories',
    optionsKey: 'applicationTypes',
    quickPicks: [
      { label: 'ANDA', value: 'ANDA' },
      { label: 'BLA', value: 'BLA' },
      { label: 'NDA', value: 'NDA' },
      { label: 'NDA Authorized Generic', value: 'NDA authorized generic' },
      { label: 'OTC Monograph Drug', value: 'OTC monograph' },
    ],
    defaultValue: () => ({ values: [] }),
  },
  productName: {
    type: 'productName',
    title: 'Product Name(s)',
    shortTitle: 'Product Name(s)',
    defaultValue: () => ({ field: 'any', op: 'contains', text: '' }),
  },
  fullText: {
    type: 'fullText',
    title: 'Labeling Full Text Search',
    shortTitle: 'Labeling Full Text Search',
    defaultValue: () => ({ mode: 'simple', text: '' }),
  },
  labelingSection: {
    type: 'labelingSection',
    title: 'Labeling Section(s)',
    shortTitle: 'Labeling Section(s)',
    optionsKey: 'sections',
    defaultValue: () => ({ mode: 'simple', text: '', sections: [] }),
  },
  marketStatus: {
    type: 'marketStatus',
    title: 'Market Status',
    shortTitle: 'Market Status',
    defaultValue: () => ({ values: [] }),
  },
  meddra: {
    type: 'meddra',
    title: 'MedDRA Terms',
    shortTitle: 'MedDRA Terms',
    defaultValue: () => ({ level: 'pt', terms: [] }),
  },
  chemicalStructure: {
    type: 'chemicalStructure',
    title: 'Chemical Structure',
    shortTitle: 'Chemical Structure',
    defaultValue: () => ({ structure: '', match: 'exact' }),
  },
  route: {
    type: 'route',
    title: 'Route(s) of Administration',
    shortTitle: 'Route(s) of Administration',
    optionsKey: 'routes',
    quickPicks: [
      { label: 'Inhalation', value: 'INHALATION' },
      { label: 'Intramuscular', value: 'INTRAMUSCULAR' },
      { label: 'Intravenous', value: 'INTRAVENOUS' },
      { label: 'Ophthalmic', value: 'OPHTHALMIC' },
      { label: 'Oral', value: 'ORAL' },
      { label: 'Subcutaneous', value: 'SUBCUTANEOUS' },
      { label: 'Topical', value: 'TOPICAL' },
    ],
    defaultValue: () => ({ values: [] }),
  },
  pharmClass: {
    type: 'pharmClass',
    title: 'Pharmacologic Class(es)',
    shortTitle: 'Pharmacologic Class(es)',
    defaultValue: () => ({ classType: 'any', terms: [] }),
  },
  identifier: {
    type: 'identifier',
    title: 'Labeling, Product and Ingredient Identifiers',
    shortTitle: 'Labeling, Product and Ingredient Identifiers',
    defaultValue: () => ({ text: '', ingredientType: 'active' }),
  },
};

/** The cards FDALabel shows on a fresh search, in its order. */
export const DEFAULT_CARDS: CriterionType[] = [
  'labelingType',
  'applicationType',
  'productName',
  'fullText',
  'labelingSection',
  'route',
  'pharmClass',
  'identifier',
];

/** The "Add more criteria" row, in FDALabel's order. */
export const ADD_MORE_ORDER: CriterionType[] = [
  'fullText',
  'productName',
  'labelingSection',
  'labelingType',
  'pharmClass',
  'applicationType',
  'marketStatus',
  'meddra',
  'chemicalStructure',
  'route',
  'identifier',
];

export function makeCriterion(type: CriterionType): Criterion {
  return { uid: uid(), type, value: CRITERION_DEFS[type].defaultValue() };
}

export function makeDefaultGroup(): CriteriaGroup {
  return { uid: uid(), criteria: DEFAULT_CARDS.map(makeCriterion) };
}

export function makeEmptyQuery(): LabelQuery {
  return { groups: [makeDefaultGroup()] };
}

/** Drops client-only ids so the tree matches what the compiler expects. */
export function toWire(query: LabelQuery): WireQuery {
  return {
    groups: query.groups.map((g) => ({
      criteria: g.criteria.map((c) => ({ type: c.type, value: c.value })),
    })),
  };
}

/** Rehydrates a wire query (from /translate or localStorage) with fresh uids. */
export function fromWire(wire: WireQuery): LabelQuery {
  const groups = (wire.groups || [])
    .map((g) => ({
      uid: uid(),
      criteria: (g.criteria || [])
        .filter((c) => c && CRITERION_DEFS[c.type])
        .map((c) => ({
          uid: uid(),
          type: c.type,
          // Merge over the default so a partial value from the model still
          // renders every control the card expects.
          value: { ...CRITERION_DEFS[c.type].defaultValue(), ...(c.value || {}) },
        })),
    }))
    .filter((g) => g.criteria.length > 0);

  return groups.length ? { groups } : makeEmptyQuery();
}

/** True when a criterion would contribute nothing to the SQL. */
export function isCriterionEmpty(c: Criterion): boolean {
  const v = c.value as Record<string, any>;
  switch (c.type) {
    case 'labelingType':
    case 'applicationType':
    case 'route':
    case 'marketStatus':
      return !(v.values?.length > 0);
    case 'meddra':
    case 'pharmClass':
      return !(v.terms?.length > 0);
    case 'labelingSection':
      return !String(v.text || '').trim() && !(v.sections?.length > 0);
    case 'chemicalStructure':
      return !String(v.structure || '').trim();
    default:
      return !String(v.text || '').trim();
  }
}

export function countFilled(query: LabelQuery): number {
  return query.groups.reduce(
    (n, g) => n + g.criteria.filter((c) => !isCriterionEmpty(c)).length,
    0,
  );
}
