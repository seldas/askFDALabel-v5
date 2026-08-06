/*
 * askFDALabel v5 — launch context.
 *
 * `set_id` is the universal key that ties the tools together, sometimes paired
 * with `spl_id` to pin a specific label version. Today every page builds those
 * URLs by hand, with inconsistent parameter names and inconsistent base-path
 * helpers. This module is the single place that knows the contract.
 *
 * Convention: builders here return **base-path-relative** routes for in-app
 * destinations (e.g. "/label/abc?tab=faers"). Next's `basePath` config adds the
 * /fdalabel-v3 prefix to <Link>, and FetchPrefix.tsx handles raw anchors, so
 * prefixing here as well would be redundant. Use withAppBase() only when
 * assigning to window.location directly.
 */

export type ContextKind = 'label' | 'labelSet' | 'project' | 'global';

export interface LaunchContext {
  /** One or more SPL set ids. labelcomp accepts up to four. */
  setIds?: string[];
  /** Optional per-label version pins, positionally matched to setIds. */
  splIds?: string[];
  /** Dashboard project ("task") id. */
  projectId?: number;
  /** Free-text query, for search-shaped tools. */
  query?: string;
}

/** Which context kinds a given LaunchContext can satisfy. */
export function contextKinds(ctx: LaunchContext): ContextKind[] {
  const kinds: ContextKind[] = ['global'];
  const n = ctx.setIds?.length ?? 0;
  if (n >= 1) kinds.push('label');
  if (n >= 2) kinds.push('labelSet');
  if (ctx.projectId != null) kinds.push('project');
  return kinds;
}

export function hasContext(ctx: LaunchContext, kind: ContextKind): boolean {
  return contextKinds(ctx).includes(kind);
}

/**
 * Serialize a context to query params.
 *
 * setIds/splIds are emitted as *repeated* keys (`?set_ids=a&set_ids=b`) because
 * that is what labelcomp already parses via searchParams.getAll('set_ids').
 */
export function toSearchParams(ctx: LaunchContext): URLSearchParams {
  const params = new URLSearchParams();
  ctx.setIds?.forEach((id) => id && params.append('set_ids', id));
  ctx.splIds?.forEach((id) => id && params.append('spl_ids', id));
  if (ctx.projectId != null) params.set('projectId', String(ctx.projectId));
  if (ctx.query) params.set('q', ctx.query);
  return params;
}

/** Parse a context back out of a URLSearchParams (inverse of toSearchParams). */
export function fromSearchParams(params: URLSearchParams): LaunchContext {
  const projectId = params.get('projectId');
  const parsedProjectId = projectId != null ? Number(projectId) : undefined;
  return {
    setIds: params.getAll('set_ids'),
    splIds: params.getAll('spl_ids'),
    projectId: Number.isFinite(parsedProjectId) ? parsedProjectId : undefined,
    query: params.get('q') ?? undefined,
  };
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The primary set id, when a tool only takes one label. */
export function primarySetId(ctx: LaunchContext): string | undefined {
  return ctx.setIds?.[0];
}

/* ---- Route builders ------------------------------------------------------ */

/**
 * The label workspace. `tool` selects a child route; omit it for the reader.
 * splId pins a specific version, matching the existing ?spl_id= convention.
 *
 * /dashboard/label/[setId] is the canonical path. It is linked from search
 * results, localquery, the dashboard, AE reports, and both history views, so
 * the workspace shell is built here rather than at a new URL.
 */
export const LABEL_BASE = '/dashboard/label';

export function labelRoute(
  setId: string,
  tool?: string,
  opts?: { splId?: string },
): string {
  const params = new URLSearchParams();
  if (opts?.splId) params.set('spl_id', opts.splId);
  return withQuery(
    `${LABEL_BASE}/${encodeURIComponent(setId)}${tool ? `/${tool}` : ''}`,
    params,
  );
}

/** Label comparison, which takes up to four labels. */
export function labelcompRoute(ctx: LaunchContext): string {
  const params = new URLSearchParams();
  ctx.setIds?.slice(0, 4).forEach((id) => id && params.append('set_ids', id));
  ctx.splIds?.slice(0, 4).forEach((id) => id && params.append('spl_ids', id));
  return withQuery('/labelcomp', params);
}

/** Dashboard, optionally scoped to a project. */
export function dashboardRoute(ctx: LaunchContext = {}): string {
  const params = new URLSearchParams();
  if (ctx.projectId != null) params.set('projectId', String(ctx.projectId));
  return withQuery('/dashboard', params);
}

/** Query-shaped tools: search, localquery, device. */
export function queryRoute(base: string, ctx: LaunchContext = {}): string {
  const params = new URLSearchParams();
  if (ctx.query) params.set('q', ctx.query);
  return withQuery(base, params);
}
