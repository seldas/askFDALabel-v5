'use client';

import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export default function ReaderToolbar({ title, date, status, tocCollapsed, onToggleContents, chatOpen, onToggleChat, progress = 0, children }: {
  title: string; date?: string; status?: string | null; tocCollapsed: boolean;
  onToggleContents: () => void; chatOpen: boolean; onToggleChat: () => void; progress?: number; children: ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const actions = Children.toArray(children);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const actionElements = useRef(new Map<string, HTMLDivElement>());
  const actionWidths = useRef(new Map<string, number>());
  const primary = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const hasOverflow = visibleCount < actions.length;

  useEffect(() => {
    if (!bar.current) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width));
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);

  // Measure actual controls rather than relying on viewport breakpoints. Each
  // action stays mounted once, either inline or in the overflow panel.
  useLayoutEffect(() => {
    actions.forEach((action, index) => {
      const key = String((action as { key?: string }).key ?? index);
      const width = actionElements.current.get(key)?.getBoundingClientRect().width || 0;
      if (width) actionWidths.current.set(key, width);
    });
    const core = primary.current;
    if (!availableWidth || !core) return;
    const buttons = Array.from(core.querySelectorAll<HTMLElement>(':scope > button:not(.afl-reader-toolbar__more)'));
    const coreWidth = buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0) + 6;
    const widths = actions.map((action, index) => actionWidths.current.get(String((action as { key?: string }).key ?? index)) || 110);
    // Reserve a readable title, core controls, and group gaps. More is only
    // reserved if all actions cannot fit.
    const budget = availableWidth - Math.min(240, availableWidth * 0.23) - coreWidth - 32;
    const total = widths.reduce((sum, width) => sum + width + 6, 0);
    let count = actions.length;
    if (total > budget) {
      let used = 0;
      count = 0;
      for (const width of widths) {
        if (used + width + 6 > budget - 76) break;
        used += width + 6;
        count++;
      }
    }
    setVisibleCount(count);
  });

  const action = (child: ReactNode, index: number) => {
    const key = String((child as { key?: string }).key ?? index);
    return <div key={key} className="afl-reader-toolbar__item" ref={element => {
      if (element) actionElements.current.set(key, element);
      else actionElements.current.delete(key);
    }}>{child}</div>;
  };

  useEffect(() => {
    const shell = bar.current?.closest<HTMLElement>('.afl-label-shell');
    const scroll = shell?.querySelector<HTMLElement>('.afl-label-shell__scroll');
    if (!shell || !scroll || !sentinel.current) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroll.getBoundingClientRect().top;
      const distance = top - sentinel.current!.getBoundingClientRect().top;
      setCompact(previous => previous ? distance > -8 : distance > 24);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    scroll.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    const header = shell.querySelector('header');
    if (header) resize.observe(header);
    update();
    return () => {
      scroll.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const element = bar.current;
    const shell = element?.closest<HTMLElement>('.afl-label-shell');
    if (!element || !shell) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      shell.style.setProperty('--reader-toolbar-height', `${height}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => { setOpen(false); }, [compact]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); moreButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <>
    <div ref={sentinel} className="afl-reader-toolbar-sentinel" aria-hidden="true" />
    <div className={`afl-reader-toolbar-slot${compact ? ' is-floating' : ''}`}>
      <div ref={bar} className="afl-reader-toolbar" aria-label="Label reading controls"
        onBlur={event => { if ( !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
        <div className="afl-reader-toolbar__identity">
          <span className="afl-reader-toolbar__eyebrow">LABEL DOCUMENT</span>
          <strong title={title}>{title}</strong>
          <span className="afl-reader-toolbar__metadata">{[date, status].filter(Boolean).join(' · ')}</span>
        </div>
        <div ref={primary} className="afl-reader-toolbar__primary">
          <button type="button" className="label-tool-btn" aria-expanded={!tocCollapsed} aria-controls="toc-panel" onClick={onToggleContents}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            Contents
          </button>
          <button id="chat-bubble" type="button" className="label-tool-btn label-tool-chat" aria-pressed={chatOpen} onClick={onToggleChat}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            AI Chat
          </button>
        </div>
        <div className="afl-reader-toolbar__inline">{actions.slice(0, visibleCount).map(action)}</div>
        <div className="afl-reader-toolbar__overflow">
          {hasOverflow && <button ref={moreButton} type="button" className="label-tool-btn afl-reader-toolbar__more" aria-expanded={open} aria-controls="reader-more-actions" onClick={() => setOpen(!open)}>
            More <span aria-hidden="true">⌄</span>
          </button>}
          <div id="reader-more-actions" className={`afl-reader-toolbar__secondary${open && hasOverflow ? ' is-open' : ''}`}
            onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled), a')) setOpen(false); }}>
            {actions.slice(visibleCount).map((child, index) => action(child, visibleCount + index))}
          </div>
        </div>
        <div className="afl-reader-toolbar__progress" role="progressbar" aria-label="Label section progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  </>;
}
