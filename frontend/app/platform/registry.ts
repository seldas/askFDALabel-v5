/*
 * askFDALabel v5 — tool registry.
 *
 * The single source of truth for what tools the platform offers, what context
 * each needs, and how to reach one. Navigation, the tool directory, and the
 * per-label launcher all render from this list rather than hardcoding links.
 *
 * Making a tool external later is a one-line change here: set kind to
 * 'external' and point href at the hosted URL. No consumer changes.
 *
 * Kept free of JSX so the catalog stays pure data — icons resolve through
 * `iconId` in icons.tsx.
 */

import type { IconId } from './icons';
import {
  dashboardRoute,
  labelRoute,
  labelcompRoute,
  primarySetId,
  queryRoute,
  type ContextKind,
  type LaunchContext,
} from './context';

export type ToolKind = 'embedded' | 'external';

/** Deployment capabilities a tool depends on. See capabilities.tsx. */
export type Requirement = 'internal' | 'fdaAccessible' | 'cderAccessible' | 'localQuery';

export type ToolGroup = 'discover' | 'analyze' | 'manage' | 'validate' | 'reference';

export interface ToolDef {
  id: string;
  name: string;
  /** One line, shown on directory cards and launcher tooltips. */
  blurb: string;
  iconId: IconId;
  kind: ToolKind;
  group: ToolGroup;
  /** Context kinds this tool can be launched with. */
  contexts: ContextKind[];
  /** All must be satisfied for the tool to be offered. */
  requires?: Requirement[];
  /** Marks AI-backed tools so the UI can badge them, as the label tabs do today. */
  ai?: boolean;
  /**
   * Set false to keep an entry documented but hidden — used for modules whose
   * backend exists but whose frontend route does not.
   */
  enabled?: boolean;
  href: (ctx: LaunchContext) => string;
  target?: '_self' | '_blank';
}

/*
 * Label-context tools. These render inside the label workspace shell
 * (app/label/[setId]/), so their hrefs are child routes of it.
 */
const LABEL_TOOLS: ToolDef[] = [
  {
    id: 'label-reader',
    name: 'Label',
    blurb: 'Read the prescribing information with a section outline.',
    iconId: 'document',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    href: (ctx) => labelRoute(primarySetId(ctx)!),
  },
  {
    id: 'label-faers',
    name: 'FAERS',
    blurb: 'Adverse event reports and MedDRA term profile for this product.',
    iconId: 'pulse',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    href: (ctx) => labelRoute(primarySetId(ctx)!, 'faers'),
  },
  {
    id: 'label-tox-dili',
    name: 'DILI Agent',
    blurb: 'Drug-Induced Liver Injury risk assessment & signal detection.',
    iconId: 'flask',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    ai: true,
    href: (ctx) => `/drugtox/${primarySetId(ctx)}?agent=dili`,
  },
  {
    id: 'label-tox-dict',
    name: 'DICT Agent',
    blurb: 'Drug-Induced Cardiotoxicity risk assessment & signal detection.',
    iconId: 'flask',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    ai: true,
    href: (ctx) => `/drugtox/${primarySetId(ctx)}?agent=dict`,
  },
  {
    id: 'label-tox-diri',
    name: 'DIRI Agent',
    blurb: 'Drug-Induced Renal Injury risk assessment & signal detection.',
    iconId: 'flask',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    ai: true,
    href: (ctx) => `/drugtox/${primarySetId(ctx)}?agent=diri`,
  },
  {
    id: 'label-tox-pgx',
    name: 'PGx Agent',
    blurb: 'Pharmacogenomic biomarker associations & genetic variant guidance.',
    iconId: 'flask',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    ai: true,
    href: (ctx) => `/drugtox/${primarySetId(ctx)}?agent=pgx`,
  },
  {
    id: 'label-examine',
    name: 'Examine',
    blurb: 'Run clinical prompt templates against this label.',
    iconId: 'microscope',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    ai: true,
    href: (ctx) => labelRoute(primarySetId(ctx)!, 'examine'),
  },
  {
    id: 'label-deepdive',
    name: 'Deep Dive',
    blurb: 'Compare this label against its pharmacologic class peers.',
    iconId: 'compare',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['label'],
    ai: true,
    href: (ctx) => labelRoute(primarySetId(ctx)!, 'deepdive'),
  },
];

/* Tools that work across labels or without any label context. */
const PLATFORM_TOOLS: ToolDef[] = [
  {
    id: 'search',
    name: 'LabelChat',
    blurb: 'Ask questions across all labels and get grounded answers.',
    iconId: 'chat',
    kind: 'embedded',
    group: 'discover',
    contexts: ['global'],
    ai: true,
    target: '_blank',
    href: (ctx) => queryRoute('/search', ctx),
  },
  {
    id: 'localquery',
    name: 'Local Database Search',
    blurb: 'Structured query over local SPL and drug records, with Excel export.',
    iconId: 'database',
    kind: 'embedded',
    group: 'discover',
    contexts: ['global'],
    requires: ['localQuery'],
    href: (ctx) => queryRoute('/localquery', ctx),
  },
  {
    id: 'dashboard',
    name: 'My Dashboard',
    blurb: 'Organize labels and saved comparisons into tasks.',
    iconId: 'bars',
    kind: 'embedded',
    group: 'manage',
    contexts: ['global', 'project'],
    href: (ctx) => dashboardRoute(ctx),
  },
  {
    id: 'labelcomp',
    name: 'Compare',
    blurb: 'Side-by-side section diff of up to four labels.',
    iconId: 'compare',
    kind: 'embedded',
    group: 'analyze',
    // Also offered from a single label so the user can pick a second one there.
    contexts: ['label', 'labelSet', 'project', 'global'],
    href: (ctx) => labelcompRoute(ctx),
  },
  {
    id: 'drugtox',
    name: 'askDrugTox',
    blurb: 'Browse harmonized toxicity records across the drug catalog.',
    iconId: 'flask',
    kind: 'embedded',
    group: 'analyze',
    contexts: ['global'],
    target: '_blank',
    href: () => '/drugtox',
  },
  {
    id: 'webtest',
    name: 'Web-test Tool',
    blurb: 'Automated regression testing of FDALabel web endpoints.',
    iconId: 'wrench',
    kind: 'embedded',
    group: 'validate',
    contexts: ['global'],
    target: '_blank',
    href: () => '/webtest',
  },
  {
    id: 'device',
    name: 'Device Intelligence',
    blurb: '510(k), PMA, MAUDE and recall lookups for medical devices.',
    iconId: 'device',
    kind: 'embedded',
    group: 'discover',
    contexts: ['global'],
    // The backend blueprint is registered at /api/device, but the frontend
    // route is disabled — app/device/_page.tsx is underscore-prefixed, so Next
    // does not route it. Re-enable by renaming that file to page.tsx.
    enabled: false,
    href: (ctx) => queryRoute('/device', ctx),
  },
];

/* Externally-hosted FDALabel deployments, gated on network reachability. */
const EXTERNAL_TOOLS: ToolDef[] = [
  {
    id: 'fdalabel-fda',
    name: 'FDALabel (FDA)',
    blurb: 'The internal FDA FDALabel web application.',
    iconId: 'building',
    kind: 'external',
    group: 'reference',
    contexts: ['global'],
    requires: ['fdaAccessible'],
    href: () => 'https://fdalabel.fda.gov:8443/fdalabel/ui/search',
    target: '_blank',
  },
  {
    id: 'fdalabel-cder',
    name: 'FDALabel (CDER-CBER)',
    blurb: 'The CDER/CBER FDALabel variant.',
    iconId: 'shield',
    kind: 'external',
    group: 'reference',
    contexts: ['global'],
    requires: ['cderAccessible'],
    href: () => 'https://fdalabel.fda.gov:8443/fdalabel-r/ui/search',
    target: '_blank',
  },
  {
    id: 'fdalabel-public',
    name: 'FDALabel (Public)',
    blurb: 'The publicly accessible FDALabel search.',
    iconId: 'building',
    kind: 'external',
    group: 'reference',
    contexts: ['global'],
    href: () => 'https://nctr-crs.fda.gov/fdalabel/ui/search',
    target: '_blank',
  },
];

export const TOOLS: ToolDef[] = [...PLATFORM_TOOLS, ...LABEL_TOOLS, ...EXTERNAL_TOOLS];

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  discover: 'Find labels',
  analyze: 'Analyze',
  manage: 'Organize',
  validate: 'Validate',
  reference: 'External resources',
};

export function getTool(id: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
