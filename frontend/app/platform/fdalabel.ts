/*
 * Links out to the hosted FDALabel deployments.
 *
 * Three of them exist and they are not interchangeable: `/fdalabel` is the
 * full FDA application, `/fdalabel-r` is the CDER-CBER variant (the curated
 * human-labeling scope a normal user is pinned to), and nctr-crs is the public
 * site. Which one a link should open follows the database the user is querying,
 * so the SPL they land on is the one they were just looking at a row of.
 *
 * The two internal hosts are only reachable from the FDA network -- the tool
 * registry gates its entries on `fdaAccessible` / `cderAccessible` for that
 * reason. Per-row SPL links are not gated: a link that may 404 is better than
 * no way to reach the authoritative document, and the same link is what
 * FDALabel itself puts on a result row.
 */

import type { TargetDb } from '../querybuilder/types';

/** Application roots, without a trailing slash. */
export const FDALABEL_BASES = {
  /** The internal FDA application: all labeling, human and animal. */
  fda: 'https://fdalabel.fda.gov:8443/fdalabel',
  /** The internal CDER-CBER variant: curated human labeling. */
  cder: 'https://fdalabel.fda.gov:8443/fdalabel-r',
  /** The public site. */
  public: 'https://nctr-crs.fda.gov/fdalabel',
} as const;

export type FdaLabelDeployment = keyof typeof FDALABEL_BASES;

/**
 * The deployment that corresponds to a query target.
 *
 * Only 'oracle_all' ("FDA ver.") maps to the full application. Everything else
 * -- CDER-CBER, and the local database too -- maps to CDER-CBER, which is the
 * scope nearly every user is searching and the one whose row a link is most
 * likely to resolve against. A local-only SPL that FDALabel does not carry
 * gives a dead link; that is the accepted trade for having the link at all.
 */
export function fdaLabelDeploymentFor(targetDb?: TargetDb | null): FdaLabelDeployment {
  return targetDb === 'oracle_all' ? 'fda' : 'cder';
}

/** FDALabel's own "SPL Document" link for a set_id. */
export function fdaLabelSplDocUrl(setId: string, targetDb?: TargetDb | null): string {
  const base = FDALABEL_BASES[fdaLabelDeploymentFor(targetDb)];
  return `${base}/services/spl/set-ids/${encodeURIComponent(setId)}/spl-doc`;
}

/** A deployment's search page. */
export function fdaLabelSearchUrl(deployment: FdaLabelDeployment): string {
  return `${FDALABEL_BASES[deployment]}/ui/search`;
}
