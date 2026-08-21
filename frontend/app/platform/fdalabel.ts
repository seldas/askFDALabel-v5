/*
 * Links out to the hosted FDALabel deployments.
 *
 * Three of them exist and they are not interchangeable: `/fdalabel` is the
 * full FDA application, `/fdalabel-r` is the CDER-CBER variant (the curated
 * human-labeling scope a normal user is pinned to), and nctr-crs is the public
 * site. Which one a link should open follows the database the user is querying,
 * so the SPL they land on is the one they were just looking at a row of.
 *
 * The two internal hosts are only reachable from the FDA network. Rather than
 * hide the link off-network (the tool registry's approach for its own entries,
 * via `fdaAccessible` / `cderAccessible`), a per-row SPL link falls back to the
 * public site, which everyone can reach. The scope distinction is lost there --
 * nctr-crs hosts only `/fdalabel`, with no CDER-CBER variant -- but a working
 * link to the right SPL beats a dead one.
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
 * What this deployment can reach — the `fdaAccessible` / `cderAccessible` half
 * of Capabilities. Passed rather than read from the context so this module
 * stays a pure URL builder; call sites hold the hook.
 */
export interface FdaLabelReach {
  fdaAccessible: boolean;
  cderAccessible: boolean;
}

/**
 * The deployment a link should open.
 *
 * The target picks which one is *wanted*: only 'oracle_all' ("FDA ver.") wants
 * the full application; everything else -- CDER-CBER, and the local database
 * too -- wants CDER-CBER, the scope nearly every user is searching and the one
 * a link is most likely to resolve against. A local-only SPL that FDALabel
 * does not carry still gives a dead link; that is the accepted trade for
 * having the link at all.
 *
 * Reachability then decides whether it can be had. An unreachable internal
 * host falls back to the public site rather than to the *other* internal one:
 * the two carry different scopes, and silently serving one where the user
 * asked for the other is worse than sending them somewhere public and honest.
 *
 * `reach` omitted means unknown, which resolves to public — the answer that
 * works from anywhere. This is also what the capabilities context reports
 * before its probe lands, so links start public and sharpen to the internal
 * host a moment later.
 */
export function fdaLabelDeploymentFor(
  targetDb?: TargetDb | null,
  reach?: FdaLabelReach | null,
): FdaLabelDeployment {
  const wanted: FdaLabelDeployment = targetDb === 'oracle_all' ? 'fda' : 'cder';
  const reachable = wanted === 'fda' ? reach?.fdaAccessible : reach?.cderAccessible;
  return reachable ? wanted : 'public';
}

/** FDALabel's own "SPL Document" link for a set_id. */
export function fdaLabelSplDocUrl(
  setId: string,
  targetDb?: TargetDb | null,
  reach?: FdaLabelReach | null,
): string {
  const base = FDALABEL_BASES[fdaLabelDeploymentFor(targetDb, reach)];
  return `${base}/services/spl/set-ids/${encodeURIComponent(setId)}/spl-doc`;
}

/** A deployment's search page. */
export function fdaLabelSearchUrl(deployment: FdaLabelDeployment): string {
  return `${FDALABEL_BASES[deployment]}/ui/search`;
}
