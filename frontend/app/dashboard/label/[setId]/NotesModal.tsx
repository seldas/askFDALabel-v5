'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface NoteItem {
  id: string;
  type: 'QA' | 'Comment' | 'Highlight';
  text: string;
  section: string;
  element: HTMLElement;
}

interface NotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  setId: string;
}

export default function NotesModal({ isOpen, onClose, setId }: NotesModalProps) {
  const [notes, setNotes] = useState<NoteItem[]>([]);

  const collectNotes = useCallback(() => {
    if (typeof document === 'undefined') return [];
    const collected: NoteItem[] = [];

    // 1. QA Badges from Chat / Section Insights
    const seenQaIds = new Set<string>();
    document.querySelectorAll<HTMLElement>('.chat-annotation-badge').forEach((badge) => {
      const qId = badge.getAttribute('data-id') || badge.querySelector('.popover-q')?.textContent || '';
      if (qId && seenQaIds.has(qId)) return;
      if (qId) seenQaIds.add(qId);

      const qEl = badge.querySelector('.popover-q');
      if (!qEl) return;

      const question = qEl.textContent?.replace(/^Q:\s*/, '').trim() || '';
      const lower = question.toLowerCase();
      if (lower.includes('faers') || lower.includes('reports')) return;

      const section = badge.closest('.Section')?.getAttribute('data-section-number') || 'TOP';

      collected.push({
        id: badge.getAttribute('data-id') || `qa-${Date.now()}-${Math.random()}`,
        type: 'QA',
        text: question,
        section,
        element: badge,
      });
    });

    // 2. Text Highlights & Comments
    const seenAnnIds = new Set<string>();
    document.querySelectorAll<HTMLElement>('.text-highlight, .text-comment').forEach((annotation) => {
      const annId = annotation.getAttribute('data-ann-id');
      if (annId) {
        if (seenAnnIds.has(annId)) return;
        seenAnnIds.add(annId);
      }

      const isComment = annotation.classList.contains('text-comment');
      const text = annotation.textContent?.trim() || '';
      const sectionItem = annotation.closest<HTMLElement>('.label-section-item');
      const sectionEl = annotation.closest<HTMLElement>('.Section');
      const section = sectionItem?.getAttribute('data-section-index')
        ? `Section ${Number(sectionItem.getAttribute('data-section-index')) + 1}`
        : sectionEl?.getAttribute('data-section-number') || 'Label';

      collected.push({
        id: annId || `ann-${Date.now()}-${Math.random()}`,
        type: isComment ? 'Comment' : 'Highlight',
        text,
        section,
        element: annotation,
      });
    });

    return collected;
  }, []);

  useEffect(() => {
    if (isOpen) {
      setNotes(collectNotes());
    }
  }, [isOpen, collectNotes]);

  const handleItemClick = (note: NoteItem) => {
    onClose();
    if (!note.element) return;

    note.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (note.type === 'QA') {
      note.element.click();
    } else {
      // Flash highlight
      const originalBg = note.element.style.backgroundColor;
      const originalColor = note.element.style.color;
      note.element.style.backgroundColor = '#fd7e14';
      note.element.style.color = 'white';

      setTimeout(() => {
        note.element.style.backgroundColor = originalBg;
        note.element.style.color = originalColor;
      }, 1500);
    }
  };

  const handleDelete = async (e: React.MouseEvent, note: NoteItem) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this note?')) return;

    try {
      const isQA = note.type === 'QA';
      const endpoint = isQA ? '/api/dashboard/delete_annotation' : '/api/dashboard/annotations/delete';
      const payload = isQA ? { set_id: setId, id: note.id } : { id: note.id };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || 'Delete failed');

      if (isQA) {
        note.element.remove();
      } else {
        // Unwrap all elements with the same data-ann-id
        const targets = document.querySelectorAll(`[data-ann-id="${note.id}"]`);
        if (targets.length > 0) {
          targets.forEach((el) => {
            const parent = el.parentNode;
            if (!parent) return;
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
            parent.normalize();
          });
        } else if (note.element.parentNode) {
          const parent = note.element.parentNode;
          while (note.element.firstChild) parent.insertBefore(note.element.firstChild, note.element);
          parent.removeChild(note.element);
          parent.normalize();
        }
      }

      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (err) {
      console.error('Error deleting note:', err);
      alert('Error deleting note.');
    }
  };

  if (!isOpen) return null;

  const truncate = (str: string, len: number) =>
    str.length > len ? str.substring(0, len) + '...' : str;

  return (
    <div
      onClick={onClose}
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
        style={{
          width: 'min(720px, 92vw)',
          maxHeight: 'min(640px, 85vh)',
          backgroundColor: 'white',
          borderRadius: 'var(--fdl-radius-sm, 4px)',
          boxShadow: '0 16px 40px rgba(15, 23, 42, 0.2)',
          border: '1px solid var(--fdl-line)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--fdl-line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--fdl-canvas)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--fdl-navy-950)' }}>
              My Notes & Highlights
            </h3>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--fdl-navy-800)',
                background: 'var(--fdl-blue-050)',
                border: '1px solid var(--fdl-line)',
                padding: '2px 8px',
                borderRadius: '12px',
              }}
            >
              {notes.length}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close notes modal"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--fdl-radius-sm, 2px)',
              border: '1px solid var(--fdl-line)',
              background: 'white',
              cursor: 'pointer',
              fontSize: '18px',
              color: 'var(--fdl-ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {notes.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 16px',
                color: 'var(--fdl-muted)',
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📝</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--fdl-navy-900)' }}>
                No notes or highlights yet
              </div>
              <p style={{ fontSize: '0.88rem', margin: '6px 0 0 0', maxWidth: '360px', marginInline: 'auto' }}>
                Select text in the label to add highlights or comments, or ask the AI assistant questions to pin
                insights to document sections.
              </p>
            </div>
          ) : (
            <div className="notes-summary-list">
              {notes.map((note) => {
                const tagClass =
                  note.type === 'QA'
                    ? 'tag-qa'
                    : note.type === 'Comment'
                    ? 'tag-comment'
                    : 'tag-highlight';

                return (
                  <div
                    key={note.id}
                    className="note-summary-item"
                    onClick={() => handleItemClick(note)}
                  >
                    <div className="note-item-header">
                      <span className={`note-type-tag ${tagClass}`}>{note.type}</span>
                      <button
                        className="note-delete-btn"
                        title="Delete Note"
                        onClick={(e) => handleDelete(e, note)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                    <div className="note-summary-text">{truncate(note.text, 150)}</div>
                    <div className="note-summary-meta">Location: {note.section}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
