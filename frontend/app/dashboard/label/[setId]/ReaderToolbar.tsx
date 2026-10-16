'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function ReaderToolbar({ title, date, status, tocCollapsed, onToggleContents, chatOpen, onToggleChat, children }: {
  title: string; date?: string; status?: string | null; tocCollapsed: boolean;
  onToggleContents: () => void; chatOpen: boolean; onToggleChat: () => void; children: ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const shell = bar.current?.closest<HTMLElement>('.afl-label-shell');
    const scroll = shell?.querySelector<HTMLElement>('.afl-label-shell__scroll');
    if (!shell || !scroll || !sentinel.current) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroll.getBoundingClientRect().top + 8;
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
      shell.style.setProperty('--reader-toolbar-height', `${height + 16}px`);
      if (!compact) slot.current?.style.setProperty('--reader-toolbar-rest-height', `${height}px`);
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
    <div ref={slot} className={`afl-reader-toolbar-slot${compact ? ' is-floating' : ''}`}>
      <div ref={bar} className="afl-reader-toolbar" aria-label="Label reading controls"
        onBlur={event => { if (compact && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
        <div className="afl-reader-toolbar__identity">
          <span className="afl-reader-toolbar__eyebrow">LABEL DOCUMENT</span>
          <strong title={title}>{title}</strong>
          <span className="afl-reader-toolbar__metadata">{[date, status].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="afl-reader-toolbar__primary">
          <button type="button" className="label-tool-btn" aria-expanded={!tocCollapsed} aria-controls="toc-panel" onClick={onToggleContents}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            Contents
          </button>
          <button id="chat-bubble" type="button" className="label-tool-btn label-tool-chat" aria-pressed={chatOpen} onClick={onToggleChat}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            AI Chat
          </button>
          <button ref={moreButton} type="button" className="label-tool-btn afl-reader-toolbar__more" aria-expanded={open} aria-controls="reader-more-actions" onClick={() => setOpen(!open)}>
            More <span aria-hidden="true">⌄</span>
          </button>
        </div>
        <div id="reader-more-actions" className={`afl-reader-toolbar__secondary${open ? ' is-open' : ''}`}
          onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled), a')) setOpen(false); }}>
          {children}
        </div>
      </div>
    </div>
  </>;
}
