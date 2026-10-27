'use client';

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { buildTableGrid, expandTableRange, tableRangeTSV, type TableRange } from './tableGrid';

interface TableExtractorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  tableHtml?: string;
}

export default function TableExtractorModal({
  isOpen,
  onClose,
  title = 'Table Data',
  tableHtml = '',
}: TableExtractorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<TableRange | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') || []);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          e.preventDefault(); last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    selectionRef.current = null;
    setHasSelection(false);
    setCopyState('idle');
    if (!isOpen) return;
    const table = containerRef.current?.querySelector('table');
    if (!table) return;
    const { cells } = buildTableGrid(table);
    const byElement = new Map(cells.map(cell => [cell.element, cell]));
    let start: typeof cells[number] | undefined;
    let pointerId: number | null = null;
    const select = (end: typeof cells[number]) => {
      if (!start) return;
      const range = expandTableRange(cells, {
        row: Math.min(start.row, end.row), col: Math.min(start.col, end.col),
        bottom: Math.max(start.bottom, end.bottom), right: Math.max(start.right, end.right),
      });
      selectionRef.current = range;
      for (const cell of cells) cell.element.classList.toggle('selected-cell',
        cell.row >= range.row && cell.bottom <= range.bottom && cell.col >= range.col && cell.right <= range.right);
      setHasSelection(true);
      setCopyState('idle');
    };
    const cellAt = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest('td, th') as HTMLTableCellElement | null : null;
      // Nested table clicks select the containing outer cell.
      let candidate = element;
      while (candidate && !byElement.has(candidate)) candidate = candidate.parentElement?.closest('td, th') as HTMLTableCellElement | null;
      return candidate ? byElement.get(candidate) : undefined;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      start = cellAt(e.target);
      if (!start) return;
      pointerId = e.pointerId;
      select(start);
      // Preserve normal touch scrolling; tapping still selects one cell.
      if (e.pointerType === 'mouse') e.preventDefault();
    };
    const over = (e: PointerEvent) => {
      if (pointerId !== e.pointerId || e.pointerType !== 'mouse') return;
      const cell = cellAt(e.target);
      if (cell) select(cell);
    };
    const up = () => { start = undefined; pointerId = null; };
    table.addEventListener('pointerdown', down);
    table.addEventListener('pointerover', over);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      table.removeEventListener('pointerdown', down);
      table.removeEventListener('pointerover', over);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [isOpen, tableHtml]);

  const getCopyTSV = () => {
    const table = containerRef.current?.querySelector('table');
    if (!table) return '';
    const { grid } = buildTableGrid(table);
    if (!grid.length) return '';
    return tableRangeTSV(grid, selectionRef.current || {
      row: 0, col: 0, bottom: grid.length - 1, right: Math.max(...grid.map(row => row.length)) - 1,
    });
  };

  const handleCopySelection = async () => {
    const tsv = getCopyTSV();
    if (!tsv) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(tsv);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = tsv;
        textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(textarea);
        const previousFocus = document.activeElement as HTMLElement | null;
        textarea.focus();
        textarea.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } finally { textarea.remove(); previousFocus?.focus(); }
        if (!copied) throw new Error('Clipboard copy was rejected.');
      }
      setCopyState('copied');
    } catch (err) {
      console.error('Failed to copy TSV:', err);
      setCopyState('failed');
    }
  };

  const handleExportExcel = () => {
    if (!containerRef.current) return;
    const table = containerRef.current.querySelector('table');
    if (!table) return;

    try {
      const wb = XLSX.utils.table_to_book(table, { sheet: 'ExtractedTable', raw: true });
      const safeTitle = (title || 'Extracted_Table').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      XLSX.writeFile(wb, `${safeTitle}.xlsx`);
    } catch (err) {
      console.error('Failed to export excel:', err);
      alert('Failed to generate Excel file.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="custom-modal table-extract-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        zIndex: 5000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-viewer-title"
        tabIndex={-1}
        onCopy={(e) => {
          const tsv = getCopyTSV();
          if (!tsv) return;
          e.preventDefault();
          e.clipboardData.setData('text/plain', tsv);
          setCopyState('copied');
        }}
        onClick={(e) => e.stopPropagation()}
        className="custom-modal-content table-extract-modal__content"
        style={{
          width: 'min(1100px, 95vw)',
          height: 'min(760px, 90vh)',
          backgroundColor: 'var(--fdl-paper, #ffffff)',
          borderRadius: 'var(--fdl-radius-sm, 2px)',
          boxShadow: '0 16px 36px rgba(7, 31, 61, 0.24)',
          border: '1px solid var(--fdl-line, #b8c8d7)',
          borderTop: '3px solid var(--fdl-navy-800, #12375b)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          className="custom-modal-header table-extract-modal__header"
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--fdl-line, #b8c8d7)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--fdl-canvas, #f3f6f8)',
          }}
        >
          <div>
            <h3 id="table-viewer-title"
              style={{
                margin: 0,
                fontSize: '1.15rem',
                fontWeight: 800,
                color: 'var(--fdl-navy-950, #071f3d)',
              }}
            >
              {title || 'Table Viewer'}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--fdl-muted, #5e6e7c)' }}>
              Copy the whole table, or drag to select cells. Use Copy or Ctrl/Cmd+C.
            </p>
          </div>

          <div className="table-extract-modal__actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={handleCopySelection}
                className="table-extract-modal__copy"
                style={{ display: 'inline-flex' }}
              >
                {copyState === 'copied' ? (
                  <><span>&#9989;</span> Copied!</>
                ) : copyState === 'failed' ? (
                  <><span>&#10060;</span> Copy Failed</>
                ) : (
                  <><span>&#128203;</span> {hasSelection ? 'Copy Selection' : 'Copy Table'}</>
                )}
              </button>
            {hasSelection && <button type="button" onClick={() => {
              selectionRef.current = null;
              containerRef.current?.querySelectorAll('.selected-cell').forEach(cell => cell.classList.remove('selected-cell'));
              setHasSelection(false);
              setCopyState('idle');
            }}>Clear selection</button>}
            <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{copyState === 'copied' ? 'Copied to clipboard.' : copyState === 'failed' ? 'Copy failed. Please try again.' : ''}</span>

            <button
              type="button"
              onClick={handleExportExcel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                backgroundColor: 'var(--fdl-green, #2d7a4c)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--fdl-radius-sm, 2px)',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.85rem',
              }}
            >
              <span>📊</span> Export whole table (.xlsx)
            </button>

            <button
              type="button"
              onClick={onClose}
              className="table-extract-modal__close"
              aria-label="Close table extractor"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--fdl-radius-sm, 2px)',
                border: '1px solid var(--fdl-line)',
                background: 'white',
                cursor: 'pointer',
                fontSize: '20px',
                color: 'var(--fdl-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          ref={containerRef}
          className="custom-modal-body table-extract-modal__body"
          style={{ flex: 1, overflow: 'auto', padding: '20px' }}
          dangerouslySetInnerHTML={{ __html: tableHtml }}
        />
      </div>
    </div>
  );
}
