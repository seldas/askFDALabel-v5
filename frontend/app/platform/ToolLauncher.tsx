'use client';

/*
 * askFDALabel v5 — tool launcher.
 *
 * Renders the tools that apply to a given context. This is the component that
 * makes the platform "direct the user to the right tool": give it a label, a
 * project, or nothing at all, and it offers what is reachable from there.
 *
 * Two shapes:
 *   variant="cards"  the tool directory and context landing pages
 *   variant="strip"  a compact row, used as the label workspace tab bar
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useCapabilities, type Capabilities } from './capabilities';
import { ToolIcon } from './icons';
import { Badge, Grid, Tabs } from './primitives';
import { contextKinds, type ContextKind, type LaunchContext } from './context';
import {
  TOOLS,
  TOOL_GROUP_LABELS,
  type Requirement,
  type ToolDef,
  type ToolGroup,
} from './registry';
import './toolLauncher.css';

function meetsRequirement(req: Requirement, caps: Capabilities): boolean {
  switch (req) {
    case 'internal':
      return caps.isInternal;
    case 'fdaAccessible':
      return caps.fdaAccessible;
    case 'cderAccessible':
      return caps.cderAccessible;
    case 'localQuery':
      return caps.allowLocalQuery;
    default:
      return true;
  }
}

export function isToolAvailable(
  tool: ToolDef,
  ctx: LaunchContext,
  caps: Capabilities,
): boolean {
  if (tool.enabled === false) return false;
  const kinds = contextKinds(ctx);
  if (!tool.contexts.some((kind) => kinds.includes(kind))) return false;
  return (tool.requires ?? []).every((req) => meetsRequirement(req, caps));
}

/** Tools reachable from `ctx`, optionally filtered to specific ids or groups. */
export function useAvailableTools(
  ctx: LaunchContext,
  opts?: {
    include?: string[];
    exclude?: string[];
    groups?: ToolGroup[];
    matchContexts?: ContextKind[];
  },
): ToolDef[] {
  const { capabilities } = useCapabilities();
  const { include, exclude, groups, matchContexts } = opts ?? {};

  return useMemo(() => {
    return TOOLS.filter((tool) => {
      if (include && !include.includes(tool.id)) return false;
      if (exclude?.includes(tool.id)) return false;
      if (groups && !groups.includes(tool.group)) return false;
      /*
       * Every context also satisfies 'global', so once the user has picked a
       * label, an unrestricted launcher would still offer Web-test, Local
       * Database Search and the like. matchContexts narrows to tools that
       * explicitly declare the specific kind we care about.
       */
      if (matchContexts && !tool.contexts.some((k) => matchContexts.includes(k))) {
        return false;
      }
      return isToolAvailable(tool, ctx, capabilities);
    });
  }, [ctx, capabilities, include, exclude, groups, matchContexts]);
}

/*
 * Internal destinations render as next/link so client-side navigation and the
 * configured basePath both apply. External ones are plain anchors with
 * noopener, and always open in a new tab.
 */
function ToolAnchor({
  tool,
  href,
  className,
  children,
  ...rest
}: {
  tool: ToolDef;
  href: string;
  className?: string;
  children: React.ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (tool.kind === 'external') {
    return (
      <a
        href={href}
        className={className}
        target={tool.target ?? '_blank'}
        rel="noopener noreferrer"
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className} target={tool.target} {...rest}>
      {children}
    </Link>
  );
}

function ToolCard({ tool, ctx }: { tool: ToolDef; ctx: LaunchContext }) {
  return (
    <ToolAnchor tool={tool} href={tool.href(ctx)} className="afl-tool-card">
      <span className="afl-tool-card__icon" aria-hidden="true">
        <ToolIcon id={tool.iconId} size={22} />
      </span>
      <span className="afl-tool-card__body">
        <span className="afl-tool-card__title">
          {tool.name}
          {tool.ai ? <Badge tone="ai">AI</Badge> : null}
          {tool.kind === 'external' ? (
            <span className="afl-tool-card__external" title="Opens in a new tab">
              <ToolIcon id="external" size={13} />
            </span>
          ) : null}
        </span>
        <span className="afl-tool-card__blurb">{tool.blurb}</span>
      </span>
    </ToolAnchor>
  );
}

export interface ToolLauncherProps {
  context: LaunchContext;
  variant?: 'cards' | 'strip';
  /** Restrict to these tool ids, in registry order. */
  include?: string[];
  exclude?: string[];
  groups?: ToolGroup[];
  /** Only offer tools that explicitly declare one of these context kinds. */
  matchContexts?: ContextKind[];
  /** cards only: group tools under their group headings. */
  grouped?: boolean;
  /** strip only: the currently active tool id. */
  activeToolId?: string;
  /** Rendered when no tool matches. */
  emptyState?: React.ReactNode;
  'aria-label'?: string;
}

export function ToolLauncher({
  context,
  variant = 'cards',
  include,
  exclude,
  groups,
  matchContexts,
  grouped = false,
  activeToolId,
  emptyState = null,
  'aria-label': ariaLabel = 'Tools',
}: ToolLauncherProps) {
  const tools = useAvailableTools(context, { include, exclude, groups, matchContexts });

  if (tools.length === 0) return <>{emptyState}</>;

  if (variant === 'strip') {
    return (
      <Tabs label={ariaLabel} className="afl-tool-strip">
        {tools.map((tool) => (
          <ToolAnchor
            key={tool.id}
            tool={tool}
            href={tool.href(context)}
            className="afl-tab"
            role="tab"
            aria-selected={tool.id === activeToolId}
          >
            <ToolIcon id={tool.iconId} size={15} />
            {tool.name}
            {tool.ai ? <Badge tone="ai">AI</Badge> : null}
          </ToolAnchor>
        ))}
      </Tabs>
    );
  }

  if (!grouped) {
    return (
      <Grid min="260px" aria-label={ariaLabel}>
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} ctx={context} />
        ))}
      </Grid>
    );
  }

  const order: ToolGroup[] = ['discover', 'analyze', 'manage', 'validate', 'reference'];
  const byGroup = order
    .map((group) => ({ group, items: tools.filter((tool) => tool.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <div className="afl-tool-groups">
      {byGroup.map(({ group, items }) => (
        <section key={group}>
          <h3 className="afl-tool-groups__heading">{TOOL_GROUP_LABELS[group]}</h3>
          <Grid min="260px">
            {items.map((tool) => (
              <ToolCard key={tool.id} tool={tool} ctx={context} />
            ))}
          </Grid>
        </section>
      ))}
    </div>
  );
}

/**
 * The label workspace tool strip.
 *
 * Restricted to the label-scoped tools by explicit id. Filtering on context
 * alone is not enough: a label context also satisfies 'global', so every
 * platform-wide tool (Web-test, Local Database Search, …) would appear in the
 * strip alongside them.
 */
export const LABEL_TOOL_IDS = [
  'label-reader',
  'label-faers',
  'label-tox',
  'label-examine',
  'label-deepdive',
] as const;

export function LabelToolStrip({
  setId,
  activeToolId,
}: {
  setId: string;
  activeToolId?: string;
}) {
  const context = useMemo<LaunchContext>(() => ({ setIds: [setId] }), [setId]);
  const include = useMemo(() => [...LABEL_TOOL_IDS], []);
  return (
    <ToolLauncher
      context={context}
      variant="strip"
      activeToolId={activeToolId}
      aria-label="Label tools"
      include={include}
    />
  );
}

export default ToolLauncher;
