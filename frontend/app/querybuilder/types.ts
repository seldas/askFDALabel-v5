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
  | 'dosageForm'
  | 'deaSchedule'
  | 'activeMoiety'
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
  /**
   * Sent as-is. Matched against one element of the `; `-joined column, so a
   * bare value is an exact category ("NDA" does not match "ANDA") and a value
   * containing `%` is a LIKE pattern within a single element.
   */
  value: string;
  /**
   * Targets on which this pick can never match, and why.
   *
   * The CDER-CBER rollup contains human labeling only, so offering "Animal Rx"
   * against it produces a confident zero rather than an error — the pick is
   * disabled there instead, with the reason on the tooltip.
   */
  unavailableOn?: { targets: TargetDb[]; reason: string };
}

export interface CriterionDef {
  type: CriterionType;
  title: string;
  /** Shown in the "Add more criteria" row. */
  shortTitle: string;
  quickPicks?: QuickPick[];
  /** Which /api/labelquery/options list feeds this card's dropdown. */
  optionsKey?: 'labelingTypes' | 'applicationTypes' | 'routes' | 'dosageForms' | 'sections';
  defaultValue: () => CriterionValue;
}

let counter = 0;
export const uid = () => `c${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/*
 * Labeling-type quick picks are LIKE patterns rather than exact doc_type
 * strings on purpose: SPL document types vary ("HUMAN PRESCRIPTION DRUG LABEL",
 * "PRESCRIPTION DRUG LABEL FOR HUMAN USE"), and a substring is the only match
 * that survives that. Marketing categories and routes are stable vocabularies,
 * so those quick picks are exact — which is what keeps NDA off ANDA. The
 * dropdown below each row offers exact values pulled live from the database.
 */
/*
 * Shared by the animal labeling picks. Only the CDER-CBER rollup excludes them
 * structurally — 'All' reads the raw SUM_SPL, and the local import contains
 * whatever SPL archives were loaded, so neither can be ruled out from here.
 */
const NON_HUMAN_UNAVAILABLE = {
  targets: ['oracle'] as TargetDb[],
  reason:
    'The CDER-CBER version covers human labeling only. Switch the database to "FDA ver." to search animal labeling.',
};

export const CRITERION_DEFS: Record<CriterionType, CriterionDef> = {
  labelingType: {
    type: 'labelingType',
    title: 'Labeling Types',
    shortTitle: 'Labeling Types',
    optionsKey: 'labelingTypes',
    quickPicks: [
      { label: 'Animal Rx', value: '%ANIMAL%PRESCRIPTION%', unavailableOn: NON_HUMAN_UNAVAILABLE },
      { label: 'Animal OTC', value: '%ANIMAL%OTC%', unavailableOn: NON_HUMAN_UNAVAILABLE },
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
      // Pattern, not exact: FDA uses several monograph categories ("OTC
      // monograph drug", "OTC monograph final", "OTC monograph not final")
      // and the quick pick means all of them.
      { label: 'OTC Monograph Drug', value: '%OTC monograph%' },
    ],
    defaultValue: () => ({ values: [], isRldRs: false, excludeRepackager: false }),
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
    defaultValue: () => ({ status: '', startDateMin: '', startDateMax: '', values: [] }),
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
  dosageForm: {
    type: 'dosageForm',
    title: 'Dosage Form(s)',
    shortTitle: 'Dosage Form(s)',
    optionsKey: 'dosageForms',
    /*
     * Exact values, like routes and marketing categories: NCI dosage-form terms
     * are a controlled vocabulary. "TABLET" must not sweep in "TABLET, FILM
     * COATED" or "TABLET, EXTENDED RELEASE" — those are separate picks in the
     * dropdown below, which is fed live from the database.
     */
    quickPicks: [
      { label: 'Capsule', value: 'CAPSULE' },
      { label: 'Cream', value: 'CREAM' },
      { label: 'Injection', value: 'INJECTION' },
      { label: 'Injection, Solution', value: 'INJECTION, SOLUTION' },
      { label: 'Solution', value: 'SOLUTION' },
      { label: 'Tablet', value: 'TABLET' },
      { label: 'Tablet, Film Coated', value: 'TABLET, FILM COATED' },
    ],
    defaultValue: () => ({ values: [] }),
  },
  deaSchedule: {
    type: 'deaSchedule',
    title: 'DEA Schedule',
    shortTitle: 'DEA Schedule',
    /*
     * The SPL acceptable terms, not roman-numeral prose: PROD_DEA stores
     * "CII", never "Schedule II". Oracle only — the local import derives no
     * DEA data, and the compiler warns rather than silently widening.
     */
    quickPicks: [
      { label: 'CI — Schedule I', value: 'CI' },
      { label: 'CII — Schedule II', value: 'CII' },
      { label: 'CIII — Schedule III', value: 'CIII' },
      { label: 'CIV — Schedule IV', value: 'CIV' },
      { label: 'CV — Schedule V', value: 'CV' },
    ],
    defaultValue: () => ({ values: [] }),
  },
  activeMoiety: {
    type: 'activeMoiety',
    title: 'Active Moiety',
    shortTitle: 'Active Moiety',
    defaultValue: () => ({ op: 'equals', terms: [] }),
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
  'dosageForm',
  'deaSchedule',
  'activeMoiety',
  'identifier',
];

/*
 * Search target.
 *
 * The two Oracle values hit the same database and differ only in the summary
 * table the compiler bases on. 'oracle' uses DGV_SUM_RX_SPL, which is a curated
 * subset -- it excludes animal and other non-human labeling, so an "Animal Rx"
 * search against it returns nothing. 'oracle_all' uses the raw SUM_SPL, which
 * covers everything. Both expose every column the compiler reads.
 */
export type TargetDb = 'local' | 'oracle' | 'oracle_all';

export const isOracleTarget = (t: TargetDb) => t === 'oracle' || t === 'oracle_all';

export const TARGET_DB_LABELS: Record<TargetDb, string> = {
  local: 'Local DB',
  oracle: 'CDER-CBER ver.',
  oracle_all: 'FDA ver.',
};

/*
 * Which backends can actually evaluate a criterion.
 *
 * Absent from this map means "both", which is the common case. The entries
 * here are the exceptions, and they are the single source of truth for the
 * disabled state in the "Add more criteria" row and the banner on a card —
 * the compilers warn about the same cases server-side, but a warning that
 * only arrives with the results is a wasted round trip.
 *
 * chemicalStructure maps to the empty list deliberately: Postgres has no
 * structure index and Oracle has no structure cartridge, so it is offered but
 * never satisfiable. Keeping it visible-but-flagged beats removing it, since
 * saved queries and the AI translator can both still produce one.
 */
export const CRITERION_SUPPORT: Partial<Record<CriterionType, TargetDb[]>> = {
  deaSchedule: ['oracle', 'oracle_all'],
  activeMoiety: ['oracle', 'oracle_all'],
  applicationType: ['oracle', 'oracle_all'],
  chemicalStructure: [],
};

/**
 * Overrides the generated wording in `unsupportedReason` where "the other
 * database has it" is not the useful explanation.
 */
export const CRITERION_UNAVAILABLE_REASON: Partial<Record<CriterionType, string>> = {
  applicationType:
    'Application Types / Marketing Categories is currently not available for the Local DB.',
};

/**
 * Criteria whose card is hidden outright on a target that cannot evaluate them,
 * rather than shown with a banner.
 *
 * Only for criteria the builder adds by default: an unusable card the user
 * never asked for is clutter, and Application Types is in the starting group.
 * A criterion the user added themselves keeps its card and its banner, because
 * silently removing what someone typed is worse than showing it struck out.
 *
 * The criterion stays in the query while hidden. Dropping it would discard the
 * selections on a target switch, and the compiler already ignores it with a
 * warning; switching back brings the card and its values back intact.
 */
export const CRITERION_HIDDEN_WHEN_UNAVAILABLE: CriterionType[] = ['applicationType'];

export function isCriterionHidden(type: CriterionType, targetDb: TargetDb): boolean {
  return (
    CRITERION_HIDDEN_WHEN_UNAVAILABLE.includes(type) && !isCriterionSupported(type, targetDb)
  );
}

export function isCriterionSupported(type: CriterionType, targetDb: TargetDb): boolean {
  const support = CRITERION_SUPPORT[type];
  return support === undefined || support.includes(targetDb);
}

/** Why a criterion is unavailable, or null when it is fine. Shown verbatim. */
export function unsupportedReason(type: CriterionType, targetDb: TargetDb): string | null {
  if (isCriterionSupported(type, targetDb)) return null;
  const override = CRITERION_UNAVAILABLE_REASON[type];
  if (override) return override;
  const { shortTitle } = CRITERION_DEFS[type];
  const support = CRITERION_SUPPORT[type] ?? [];
  if (support.length === 0) {
    return `${shortTitle} needs a chemical structure index that neither database has. This criterion will be ignored.`;
  }
  const only = support.some(isOracleTarget) ? 'FDALabel Oracle' : 'local';
  return `${shortTitle} is only available against the ${only} database. This criterion will be ignored for the current target.`;
}

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
