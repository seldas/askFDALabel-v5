'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { labelRoute, type LaunchContext } from '../../../platform/context';
import { ToolIcon } from '../../../platform/icons';
import { useToolboxTools } from '../../../platform/ToolLauncher';
import type { ToolboxWorkflow } from '../../../platform/registry';
import type { LabelData } from './types';
import { useLabel } from './LabelContext';
import { useCapabilities } from '../../../platform/capabilities';
import { ServiceWarning, toolServiceState } from '../../../platform/ServiceWarning';

export default function ToolboxPanel({ setId, data }: { setId: string; data: LabelData }) {
  const { capabilities } = useCapabilities();
  const brandName = data?.brand_name || data?.drug_name || 'this product';
  const applicationNumber = String(data?.application_number || data?.metadata?.application_number || '').trim();
  // A label can carry several application numbers, separated by commas or
  // semicolons. The application profile follows one identifier at a time.
  const historyApplicationNumber = applicationNumber.split(/[;,]/, 1)[0].trim();
  const hasApplicationNumber = Boolean(historyApplicationNumber && !/^n\/?a$/i.test(historyApplicationNumber));
  const [favoriteToolIds, setFavoriteToolIds] = useState<string[]>([]);
  const [layout, setLayout] = useState<'cards' | 'table'>('cards');
  const [search, setSearch] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sort, setSort] = useState<{ column: 'name' | 'workflow'; descending: boolean }>({ column: 'name', descending: false });
  const { splId, headerCollapsed, setHeaderCollapsed } = useLabel();
  const controls = useRef<HTMLElement>(null);
  const container = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('askfdalabel_toolbox_layout') === 'table') setLayout('table');
    } catch { /* The default view also works without browser storage. */ }
    const element = controls.current;
    if (!element) return;
    const resize = new ResizeObserver(() => container.current?.style.setProperty('--toolbox-controls-height', `${element.getBoundingClientRect().height}px`));
    resize.observe(element);
    const scroll = element.closest('.afl-label-shell__scroll');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!scroll || !sentinel.current) return;
      const distance = scroll.getBoundingClientRect().top - sentinel.current.getBoundingClientRect().top;
      setCompact(previous => previous ? distance > -8 : distance > 24);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    scroll?.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => { resize.disconnect(); scroll?.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, []);

  const changeLayout = (next: 'cards' | 'table') => {
    setLayout(next);
    try { localStorage.setItem('askfdalabel_toolbox_layout', next); } catch { /* Session-only preference. */ }
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('askfdalabel_favorite_tools');
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        const saved = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
        // `label-tox` was the previous default id before the organ-specific
        // agents were split; retain the user's intent by pinning DILI instead.
        setFavoriteToolIds([...new Set(saved.map((id) => id === 'label-tox' ? 'label-tox-dili' : id))]);
      } else {
        setFavoriteToolIds(['label-faers', 'label-tox-dili']);
      }
    } catch (e) {
      console.error('Failed to load favorite tools:', e);
    }
  }, []);

  const toggleFavoriteTool = (toolId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFavoriteToolIds((prev) => {
      const next = prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId];
      try {
        localStorage.setItem('askfdalabel_favorite_tools', JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save favorite tools:', err);
      }
      return next;
    });
  };

  /*
   * The toolbox renders the platform registry, not a list of its own. A tool
   * added to platform/registry.ts shows up here automatically, and one the
   * account is not permitted to use is filtered out by the same resolver the
   * navigation and the tool directory use.
   */
  const launchContext = useMemo<LaunchContext>(
    () => ({
      setIds: [setId],
      splIds: splId ? [splId] : undefined,
      applicationNumber: hasApplicationNumber ? historyApplicationNumber : undefined,
    }),
    [setId, splId, hasApplicationNumber, historyApplicationNumber],
  );

  const registryTools = useToolboxTools(launchContext);

  const toolsList = useMemo(
    () =>
      registryTools.map((tool) => ({
        id: tool.id,
        disabled: toolServiceState(tool, capabilities).disabled,
        serviceMessage: toolServiceState(tool, capabilities).message,
        name: tool.name,
        blurb: tool.blurbFor?.(launchContext) ?? tool.blurb,
        iconId: tool.iconId,
        href: tool.href(launchContext),
        workflow: tool.toolboxWorkflow ?? 'review',
      })),
    [registryTools, launchContext, capabilities],
  );

  const workflowDetails: Record<ToolboxWorkflow, { code: string; title: string; description: string }> = {
    review: { code: 'REVIEW / 01', title: 'Label review', description: 'Prompted review and structured label interpretation.' },
    safety: { code: 'SAFETY / 02', title: 'Safety signals', description: 'Adverse-event evidence, extraction, and safety profiling.' },
    toxicity: { code: 'TOX / 03', title: 'Toxicology assessment', description: 'Organ-specific risk assessment and toxicity classification.' },
    comparison: { code: 'COMPARE / 04', title: 'Cross-label analysis', description: 'Version history, peer context, and label comparison.' },
  };
  const workflowOrder: ToolboxWorkflow[] = ['review', 'safety', 'toxicity', 'comparison'];
  const filteredTools = toolsList.filter(tool =>
    (workflowFilter === 'all' || tool.workflow === workflowFilter) &&
    (!pinnedOnly || favoriteToolIds.includes(tool.id)) &&
    `${tool.name} ${tool.blurb} ${workflowDetails[tool.workflow].title}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const tableTools = [...filteredTools].sort((a, b) => {
    const pinned = Number(favoriteToolIds.includes(b.id)) - Number(favoriteToolIds.includes(a.id));
    if (pinned) return pinned;
    const left = sort.column === 'name' ? a.name : workflowDetails[a.workflow].title;
    const right = sort.column === 'name' ? b.name : workflowDetails[b.workflow].title;
    return (left.localeCompare(right) || a.name.localeCompare(b.name)) * (sort.descending ? -1 : 1);
  });
  const changeSort = (column: 'name' | 'workflow') => setSort(previous => ({ column, descending: previous.column === column ? !previous.descending : false }));
  const renderPin = (tool: typeof toolsList[number]) => {
    const pinned = favoriteToolIds.includes(tool.id);
    return <button type="button" className="afl-toolbox__pin" onClick={event => toggleFavoriteTool(tool.id, event)}
      aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${tool.name}`} title={pinned ? 'Unpin tool' : 'Pin tool'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6.3-.9Z" />
      </svg>
    </button>;
  };
  const pinnedTools = filteredTools.filter((tool) => favoriteToolIds.includes(tool.id));
  const workflowSets = workflowOrder
    .map((workflow) => ({
      workflow,
      tools: filteredTools.filter((tool) => tool.workflow === workflow && !favoriteToolIds.includes(tool.id)),
    }))
    .filter(({ tools }) => tools.length > 0);

  const renderToolCard = (t: typeof toolsList[number]) => {
    const isFav = favoriteToolIds.includes(t.id);
    const detail = workflowDetails[t.workflow];
    return (
      <article key={t.id} className={`afl-toolbox__tool${isFav ? ' is-pinned' : ''}`} data-workflow={t.workflow}>
        <header className="afl-toolbox__tool-header">
          <span className="afl-toolbox__tool-icon" aria-hidden="true"><ToolIcon id={t.iconId} size={20} /></span>
          <div className="afl-toolbox__tool-title-group">
            <span className="afl-toolbox__tool-category">{detail?.title ?? t.workflow}</span>
            <h3><a className="afl-toolbox__tool-name" href={t.disabled ? undefined : t.href} aria-disabled={t.disabled || undefined} title={t.serviceMessage} target="_blank" rel="noopener noreferrer">{t.name}</a></h3>
          </div>
          <ServiceWarning toolId={t.id} compact />
          {renderPin(t)}
        </header>
        <p>{t.blurb}</p>
        <a className="afl-toolbox__launch" href={t.disabled ? undefined : t.href} aria-disabled={t.disabled || undefined} title={t.serviceMessage} target="_blank" rel="noopener noreferrer">
          {t.disabled ? 'Temporarily unavailable' : 'Open analysis'} <span aria-hidden="true">↗</span>
        </a>
        {t.disabled && t.id === 'label-faers' && <Link href={t.href} target="_blank">View saved results ↗</Link>}
      </article>
    );
  };

  return (
    <section ref={container} className="afl-toolbox afl-toolbox--adaptive" aria-labelledby="toolbox-title">
      <div ref={sentinel} className="afl-toolbox__sentinel" aria-hidden="true" />
      <header ref={controls} className={`afl-toolbox__controls${compact ? ' is-compact' : ''}`}>
        <div className="afl-toolbox__identity-row">
          <div className="afl-toolbox__heading">
            <span className="afl-toolbox__region">LABEL WORKSPACE / TOOLS</span>
            <h2 id="toolbox-title">Product Toolbox</h2>
            <p className="afl-toolbox__product" title={brandName}><strong>{brandName}</strong><span>{[data.effective_time, data.openfda_status].filter(Boolean).join(' · ')}</span></p>
          </div>
          <div className="afl-toolbox__header-actions">
            <button type="button" className="label-tool-btn" aria-expanded={!headerCollapsed} onClick={() => {
              setHeaderCollapsed(!headerCollapsed);
              if (headerCollapsed) requestAnimationFrame(() => controls.current?.closest('.afl-label-shell__scroll')?.scrollTo({ top: 0, behavior: 'smooth' }));
            }}>{headerCollapsed ? 'Label details' : 'Collapse details'}</button>
            <Link className="label-tool-btn" href={labelRoute(setId, undefined, { splId: splId || undefined })}>← Back to label</Link>
          </div>
        </div>
        <div className="afl-toolbox__filters" role="group" aria-label="Toolbox filters and view">
          <label className="afl-toolbox__search"><span className="afl-toolbox__sr-only">Search tools</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tools…" />
          </label>
          <label className="afl-toolbox__filter-label"><span>Category</span><select value={workflowFilter} onChange={event => setWorkflowFilter(event.target.value)}>
            <option value="all">All categories</option>{workflowOrder.map(workflow => <option key={workflow} value={workflow}>{workflowDetails[workflow].title}</option>)}
          </select></label>
          <label className="afl-toolbox__pinned-filter"><input type="checkbox" checked={pinnedOnly} onChange={event => setPinnedOnly(event.target.checked)} /> Pinned only</label>
          <div className="afl-toolbox__view-switch" role="group" aria-label="Toolbox layout">
            <button type="button" aria-pressed={layout === 'cards'} onClick={() => changeLayout('cards')}>▦ Cards</button>
            <button type="button" aria-pressed={layout === 'table'} onClick={() => changeLayout('table')}>☷ Table</button>
          </div>
        </div>
      </header>
      <div className="afl-toolbox__results-summary" role="status">{filteredTools.length} of {toolsList.length} tools{layout === 'table' ? ' · Pinned tools first' : ''}</div>
      {!filteredTools.length && <div className="afl-toolbox__empty"><h3>No matching tools</h3><p>Try another search or clear your filters.</p>
        <button type="button" className="label-tool-btn" onClick={() => { setSearch(''); setWorkflowFilter('all'); setPinnedOnly(false); }}>Clear filters</button>
      </div>}
      {layout === 'table' && filteredTools.length > 0 && (
        <table className="afl-toolbox__table">
          <caption className="afl-toolbox__sr-only">Available tools for {brandName}. Pinned tools appear first. Tools open in a new tab.</caption>
          <thead><tr>
            <th scope="col" className="afl-toolbox__pin-column"><span className="afl-toolbox__sr-only">Pinned</span>☆</th>
            <th scope="col" aria-sort={sort.column === 'name' ? sort.descending ? 'descending' : 'ascending' : 'none'}><button type="button" onClick={() => changeSort('name')}>Tool {sort.column === 'name' ? sort.descending ? '↓' : '↑' : '↕'}</button></th>
            <th scope="col" className="afl-toolbox__purpose-column">Purpose</th>
            <th scope="col" className="afl-toolbox__category-column" aria-sort={sort.column === 'workflow' ? sort.descending ? 'descending' : 'ascending' : 'none'}><button type="button" onClick={() => changeSort('workflow')}>Category {sort.column === 'workflow' ? sort.descending ? '↓' : '↑' : '↕'}</button></th>
            <th scope="col" className="afl-toolbox__open-column">Action</th>
          </tr></thead>
          <tbody>{tableTools.map(tool => <tr key={tool.id} data-workflow={tool.workflow} data-pinned={favoriteToolIds.includes(tool.id)}>
            <td>{renderPin(tool)}</td>
            <th scope="row"><a className="afl-toolbox__table-name" href={tool.disabled ? undefined : tool.href} aria-disabled={tool.disabled || undefined} title={tool.serviceMessage} target="_blank" rel="noopener noreferrer"><ToolIcon id={tool.iconId} size={18} />{tool.name}</a><ServiceWarning toolId={tool.id} compact /><span className="afl-toolbox__mobile-purpose">{tool.blurb}</span></th>
            <td className="afl-toolbox__purpose-column"><span>{tool.blurb}</span></td>
            <td className="afl-toolbox__category-column">{workflowDetails[tool.workflow].title}</td>
            <td className="afl-toolbox__open-column"><a className="label-tool-btn" href={tool.disabled ? undefined : tool.href} aria-disabled={tool.disabled || undefined} title={tool.serviceMessage} target="_blank" rel="noopener noreferrer">{tool.disabled ? 'Unavailable' : 'Open ↗'}</a>{tool.disabled && tool.id === 'label-faers' && <Link href={tool.href} target="_blank">View saved results ↗</Link>}</td>
          </tr>)}</tbody>
        </table>
      )}
      {layout === 'cards' && <>
      {pinnedTools.length > 0 && (
        <section className="afl-toolbox__section afl-toolbox__section--pinned" aria-labelledby="pinned-tools-title">
          <header className="afl-toolbox__section-header">
            <div><span>PINNED / {String(pinnedTools.length).padStart(2, '0')}</span><h3 id="pinned-tools-title">Pinned tools</h3></div>
            <p>Frequently used analyses for this workspace.</p>
          </header>
          <div className="afl-toolbox__grid">{pinnedTools.map(renderToolCard)}</div>
        </section>
      )}

      {workflowSets.map(({ workflow, tools }) => {
        const detail = workflowDetails[workflow];
        return (
          <section key={workflow} className="afl-toolbox__section" data-workflow={workflow} aria-labelledby={`toolbox-${workflow}`}>
            <header className="afl-toolbox__section-header">
              <div><span>{detail.code} / {String(tools.length).padStart(2, '0')}</span><h3 id={`toolbox-${workflow}`}>{detail.title}</h3></div>
              <p>{detail.description}</p>
            </header>
            <div className="afl-toolbox__grid">{tools.map(renderToolCard)}</div>
          </section>
        );
      })}
      </>}
      <aside className="afl-toolbox__contact">Tool requests or research collaboration: <a href="mailto:askfdalabel@fda.hhs.gov">askfdalabel@fda.hhs.gov</a></aside>
    </section>
  );
}
