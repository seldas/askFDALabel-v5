import { CRITERION_DEFS, isCriterionEmpty, type CriterionType, type TargetDb } from './types';
import type { SavedQuery } from './queryCode';
import type { OptionLists } from './CriterionCard';

export const EXTERNAL_QUERY_START = 'BEGIN FDALABEL QUERY V1';
export const EXTERNAL_QUERY_END = 'END FDALABEL QUERY V1';
const LOCAL_UNSUPPORTED = ['fullText', 'meddra', 'deaSchedule'];
const ENUMS: Record<string, string[]> = {
  'productName.field': ['any', 'trade', 'generic', 'unii'],
  'productName.op': ['equals', 'contains', 'startsWith', 'notContains'],
  'labelingType.plr': ['all', 'plr', 'non_plr'],
  'fullText.mode': ['simple', 'advanced'],
  'labelingSection.mode': ['simple', 'advanced'],
  'meddra.level': ['pt', 'llt'],
  'pharmClass.classType': ['any', 'epc', 'moa', 'pe', 'cs'],
  'activeMoiety.op': ['equals', 'contains'],
  'identifier.uniiTarget': ['active', 'moiety'],
};

export interface ExternalQuery extends SavedQuery { notes: string[]; unsupported: string[] }

export function parseExternalQuery(text: string): ExternalQuery {
  const start = text.indexOf(EXTERNAL_QUERY_START);
  const end = text.indexOf(EXTERNAL_QUERY_END, start + EXTERNAL_QUERY_START.length);
  if (start < 0 || end < 0) throw new Error('Paste the complete external AI response, including BEGIN and END FDALABEL QUERY V1 markers.');
  let data;
  try {
    data = JSON.parse(text.slice(start + EXTERNAL_QUERY_START.length, end).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch { throw new Error('The external AI query contains invalid JSON. Ask the model to correct its response using the downloaded instructions.'); }
  if (data.version !== 1 || !['local', 'oracle', 'oracle_all'].includes(data.targetDb)
    || !Array.isArray(data.query?.groups) || !data.query.groups.length || typeof data.query.exactMatch !== 'boolean') {
    throw new Error('The external AI response has an unsupported query format or database scope.');
  }
  for (const field of ['notes', 'unsupported']) {
    if (!Array.isArray(data[field]) || !data[field].every((item: unknown) => typeof item === 'string')) throw new Error(`Invalid ${field} list in the external AI query.`);
  }
  for (const group of data.query.groups) {
    if (!Array.isArray(group.criteria) || !group.criteria.length) throw new Error('External AI queries must contain nonempty criteria groups.');
    for (const criterion of group.criteria) {
      const type = criterion.type as CriterionType;
      if (!Object.prototype.hasOwnProperty.call(CRITERION_DEFS, type)) throw new Error(`Unsupported criterion: ${type}.`);
      if (data.targetDb === 'local' && LOCAL_UNSUPPORTED.includes(type)) throw new Error(`${type} is unavailable in the local database.`);
      const defaults = CRITERION_DEFS[type].defaultValue();
      const value = criterion.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid value for ${type}.`);
      for (const [key, item] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(defaults, key)) throw new Error(`Unknown field ${type}.${key}.`);
        const expected = defaults[key];
        if (Array.isArray(expected) ? !Array.isArray(item) || !item.every(v => typeof v === 'string') : typeof item !== typeof expected) throw new Error(`Invalid value type for ${type}.${key}.`);
        const allowed = ENUMS[`${type}.${key}`];
        if (allowed && !allowed.includes(item as string)) throw new Error(`Invalid choice for ${type}.${key}.`);
      }
      if (isCriterionEmpty({ uid: '', type, value: { ...defaults, ...value } })) throw new Error(`The ${type} criterion is empty. Ask the external model to supply the missing condition.`);
      if (type === 'productName') value.verified = false;
      if (type === 'meddra') {
        value.verified = false;
        // Keep vocabulary confirmation in the existing criterion card.
      }
      if (data.targetDb === 'local' && type === 'labelingSection'
        && (!(value.sections?.length) || value.sections.some((s: string) => !['SPLTITLE', 'Product Title', '43683-2', 'Initial U.S. Approval [4 Digit Year]'].includes(s)))) {
        throw new Error('Local searches support only Product Title and Initial U.S. Approval section criteria.');
      }
    }
  }
  return data;
}

export function externalAiInstructions(targetDb: TargetDb, options: OptionLists, exactMatch: boolean): string {
  const templates = Object.values(CRITERION_DEFS)
    .filter(def => targetDb !== 'local' || !LOCAL_UNSUPPORTED.includes(def.type))
    .map(def => ({ type: def.type, value: def.defaultValue() }));
  return `FDALabel external AI query instructions — protocol V1

You help the user translate a labeling search request into FDALabel query criteria. Ask for the user's search request if none is provided. Ask a clarifying question when AND/OR relationships or the desired scope are ambiguous. Do not claim to have searched FDALabel or provide fabricated results.

The selected database is ${targetDb}. Keep this targetDb unchanged.
The selected exactMatch setting is ${exactMatch}. Preserve it unless the user explicitly asks for a different setting.
Criteria within each group are combined with AND. Groups are combined with OR. Values in a categorical values list are alternatives. To require two ingredients together, use two productName criteria in the same group. Do not invent SQL, URLs, UUIDs, identifiers, compressed codes, or unsupported operators.
Use only the criterion types and value fields listed below. Optional fields may be omitted; their defaults are shown. Do not output client-side ids or entity-expansion fields. Always set productName.verified to false. You cannot verify terms against the application database. MedDRA supports PT and LLT only. Never infer a pharmacologic class, ingredient synonym, or MedDRA mapping as a confirmed fact.
${targetDb === 'local' ? 'Local database: no full labeling text, MedDRA, or DEA schedule search. labelingSection supports only SPLTITLE (Product Title) and 43683-2 (Initial U.S. Approval). Put any unavailable request in unsupported; never silently drop it.' : 'For section searches, use section codes from the supplied sections list. Keep text search mode simple unless the user explicitly requests advanced syntax.'}
Use exact vocabulary values from the supplied lists when available. Do not replace an unavailable concept with a broader one. Explain assumptions in notes. List every requested condition you cannot represent in unsupported. If the request cannot be expressed at all, ask the user to revise it instead of emitting an empty query.

Criterion templates:
${JSON.stringify(templates, null, 2)}

Allowed enum values (where applicable):
${JSON.stringify(ENUMS, null, 2)}

Current dropdown vocabulary (an empty list means unavailable, not unrestricted):
${JSON.stringify({ labelingTypes: options.labelingTypes, applicationTypes: options.applicationTypes, routes: options.routes, dosageForms: options.dosageForms, sections: options.sections }, null, 2)}

When ready, return exactly one JSON object between the following markers. No markdown or explanation outside the markers. This is the format, not a query to copy unchanged:
${EXTERNAL_QUERY_START}
${JSON.stringify({version:1,targetDb,query:{exactMatch,groups:[{criteria:[{type:'productName',value:{field:'any',op:'equals',text:'metformin',verified:false}}]}]},notes:[],unsupported:[]},null,2)}
${EXTERNAL_QUERY_END}

The user will paste your complete output into the AI Query Builder. The application parses it as data and restores the criteria; it does not execute your text as code.
`;
}
