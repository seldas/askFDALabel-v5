'use client';

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';

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

  // Cell selection state
  const isDraggingRef = useRef(false);
  const startCellRef = useRef<HTMLTableCellElement | null>(null);

  // Keyboard navigation & ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Wire cell selection logic on table mount/update
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const table = containerRef.current.querySelector('table');
    if (!table) return;

    table.classList.add('excel-style-table');
    table.removeAttribute('style');

    const getCoords = (cell: HTMLTableCellElement) => ({
      row: (cell.parentElement as HTMLTableRowElement).rowIndex,
      col: cell.cellIndex,
    });

    const clearSelection = () => {
      table.querySelectorAll('.selected-cell').forEach((c) => c.classList.remove('selected-cell'));
      setHasSelection(false);
    };

    const selectRange = (endCell: HTMLTableCellElement) => {
      if (!startCellRef.current) return;
      const start = getCoords(startCellRef.current);
      const end = getCoords(endCell);

      const minRow = Math.min(start.row, end.row);
      const maxRow = Math.max(start.row, end.row);
      const minCol = Math.min(start.col, end.col);
      const maxCol = Math.max(start.col, end.col);

      table.querySelectorAll<HTMLTableCellElement>('td, th').forEach((cell) => {
        const c = getCoords(cell);
        const inRange = c.row >= minRow && c.row <= maxRow && c.col >= minCol && c.col <= maxCol;
        cell.classList.toggle('selected-cell', inRange);
      });
      setHasSelection(true);
    };

    const onMouseDown = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
      if (!cell) return;

      isDraggingRef.current = true;
      startCellRef.current = cell;
      clearSelection();
      cell.classList.add('selected-cell');
      setHasSelection(true);
      e.preventDefault();
    };

    const onMouseOver = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const cell = (e.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
      if (cell) selectRange(cell);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    table.addEventListener('mousedown', onMouseDown);
    table.addEventListener('mouseover', onMouseOver);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      table.removeEventListener('mousedown', onMouseDown);
      table.removeEventListener('mouseover', onMouseOver);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOpen, tableHtml]);

  const getSelectedTSV = () => {
    if (!containerRef.current) return '';
    const table = containerRef.current.querySelector('table');
    if (!table) return '';

    const selected = Array.from(table.querySelectorAll<HTMLTableCellElement>('.selected-cell'));
    if (!selected.length) return '';

    const rows: Record<number, string[]> = {};
    selected.forEach((cell) => {
      const row = (cell.parentElement as HTMLTableRowElement).rowIndex;
      if (!rows[row]) rows[row] = [];
      let text = cell.innerText.trim();
      if (/[\n\t"]/.test(text)) {
        text = `"${text.replace(/"/g, '""')}"`;
      }
      rows[row].push(text);
    });

    return Object.keys(rows)
      .sort((a, b) => Number(a) - Number(b))
      .map((row) => rows[Number(row)].join('\t'))
      .join('\n');
  };

  const handleCopySelection = async () => {
    const tsv = getSelectedTSV();
    if (!tsv) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(tsv);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = tsv;
        textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy TSV:', err);
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const handleExportExcel = () => {
    if (!containerRef.current) return;
    const table = containerRef.current.querySelector('table');
    if (!table) return;

    try {
      const wb = XLSX.utils.table_to_book(table, { sheet: 'ExtractedTable' });
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
            <h3
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
              Click and drag cells to select a range. Copy as TSV or export directly to Excel.
            </p>
          </div>

          <div className="table-extract-modal__actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {hasSelection && (
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
                  <><span>&#128203;</span> Copy Selection</>
                )}
              </button>
            )}

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
              <span>📊</span> Export Excel (.xlsx)
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
