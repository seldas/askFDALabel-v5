'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { type LaunchContext } from '../../../platform/context';
import { ToolIcon } from '../../../platform/icons';
import { LabelToolStrip, useToolboxTools } from '../../../platform/ToolLauncher';
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
  const [search, setSearch] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const { splId, headerCollapsed, setHeaderCollapsed } = useLabel();
  const controls = useRef<HTMLElement>(null);
  const container = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
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
  const unifiedCardTools = [
    ...pinnedTools,
    ...filteredTools.filter((tool) => !favoriteToolIds.includes(tool.id)),
  ];

  const renderToolCard = (t: typeof toolsList[number]) => {
    const isFav = favoriteToolIds.includes(t.id);
    return (
      <div
        key={t.id}
        className={`afl-toolbox__gemini-row${isFav ? ' is-pinned' : ''}${t.disabled ? ' is-disabled' : ''}`}
        data-workflow={t.workflow}
      >
        <span className="afl-toolbox__gemini-icon" aria-hidden="true">
          <ToolIcon id={t.iconId} size={20} />
        </span>
        <div className="afl-toolbox__gemini-text">
          <div className="afl-toolbox__gemini-title-line">
            <a
              className="afl-toolbox__gemini-name"
              href={t.disabled ? undefined : t.href}
              aria-disabled={t.disabled || undefined}
              title={t.serviceMessage || t.blurb}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.name}
            </a>
            <ServiceWarning toolId={t.id} compact />
          </div>
          <p className="afl-toolbox__gemini-blurb" title={t.blurb}>{t.blurb}</p>
          {t.disabled && t.id === 'label-faers' && (
            <Link className="afl-toolbox__tile-fallback" href={t.href} target="_blank">
              View saved results ↗
            </Link>
          )}
        </div>
        <div className="afl-toolbox__gemini-actions">
          {renderPin(t)}
        </div>
      </div>
    );
  };

  return (
    <section ref={container} className="afl-toolbox afl-toolbox--adaptive" aria-labelledby="toolbox-title">
      <div ref={sentinel} className="afl-toolbox__sentinel" aria-hidden="true" />
      <header ref={controls} className={`afl-toolbox__controls${compact ? ' is-compact' : ''}`}>
        <div className="afl-reader-toolbar" style={{ padding: '0 0 12px' }}>
          <div className="afl-reader-toolbar__leading">
            <LabelToolStrip setId={setId} />
          </div>
          <div className="afl-reader-toolbar__identity">
            <span className="afl-reader-toolbar__eyebrow">PRODUCT TOOLBOX</span>
            <strong id="toolbox-title" title={brandName}>{brandName}</strong>
            <span className="afl-reader-toolbar__metadata">
              {[data.effective_time, data.openfda_status].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="afl-toolbox__header-actions">
            <button type="button" className="label-tool-btn label-tool-details" aria-expanded={!headerCollapsed} onClick={() => {
              setHeaderCollapsed(!headerCollapsed);
              if (headerCollapsed) requestAnimationFrame(() => controls.current?.closest('.afl-label-shell__scroll')?.scrollTo({ top: 0, behavior: 'smooth' }));
            }}>{headerCollapsed ? 'Label details' : 'Collapse details'}</button>
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
        </div>
      </header>
      <div className="afl-toolbox__results-summary" role="status">{filteredTools.length} of {toolsList.length} tools</div>
      {!filteredTools.length && <div className="afl-toolbox__empty"><h3>No matching tools</h3><p>Try another search or clear your filters.</p>
        <button type="button" className="label-tool-btn" onClick={() => { setSearch(''); setWorkflowFilter('all'); setPinnedOnly(false); }}>Clear filters</button>
      </div>}
      {unifiedCardTools.length > 0 && (
        <div className="afl-toolbox__gemini-wrap">
          {pinnedTools.length > 0 && workflowFilter === 'all' && !search.trim() && (
            <div className="afl-toolbox__gemini-group">
              <div className="afl-toolbox__gemini-group-title">
                <span>Pinned</span>
                <span aria-hidden="true">›</span>
              </div>
              <div className="afl-toolbox__gemini-grid">
                {pinnedTools.map(renderToolCard)}
              </div>
            </div>
          )}
          <div className="afl-toolbox__gemini-group">
            {pinnedTools.length > 0 && workflowFilter === 'all' && !search.trim() && (
              <div className="afl-toolbox__gemini-group-title">
                <span>All tools</span>
                <span aria-hidden="true">›</span>
              </div>
            )}
            <div className="afl-toolbox__gemini-grid">
              {(workflowFilter === 'all' && !search.trim()
                ? filteredTools.filter((t) => !favoriteToolIds.includes(t.id))
                : unifiedCardTools
              ).map(renderToolCard)}
            </div>
          </div>
        </div>
      )}
      <aside className="afl-toolbox__contact">Tool requests or research collaboration: <a href="mailto:askfdalabel@fda.hhs.gov">askfdalabel@fda.hhs.gov</a></aside>
    </section>
  );
}
