'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface AnnotationData {
  id: string | number;
  section_id: string;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  annotation_type: 'highlight' | 'comment';
  color?: string | null;
  comment?: string | null;
  user_id?: string | number | null;
  username?: string | null;
  created_at?: string | null;
}

interface SelectionContext {
  range: Range;
  sectionId: string;
  sectionNode: HTMLElement;
  text: string;
}

interface ToolbarState {
  visible: boolean;
  x: number;
  y: number;
  mode: 'buttons' | 'palette' | 'comment';
}

interface ReadPopoverState {
  visible: boolean;
  x: number;
  y: number;
  annotation: AnnotationData;
  targetEl: HTMLElement;
}

interface LabelAnnotationsProps {
  setId: string;
  canComment?: boolean;
  currentUserId?: string | number | null;
}

const HIGHLIGHT_COLORS = ['#ffeb3b', '#ffc107', '#8bc34a', '#03a9f4', '#e91e63', 'none'];

export default function LabelAnnotations({
  setId,
  canComment = true,
  currentUserId,
}: LabelAnnotationsProps) {
  const [toolbar, setToolbar] = useState<ToolbarState>({
    visible: false,
    x: 0,
    y: 0,
    mode: 'buttons',
  });
  const [selectionContext, setSelectionContext] = useState<SelectionContext | null>(null);
  const [commentText, setCommentText] = useState('');
  const [readPopover, setReadPopover] = useState<ReadPopoverState | null>(null);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const readPopoverRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Range offset calculation
  const getRangeOffsets = (container: HTMLElement, range: Range) => {
    try {
      const preSelectionRange = range.cloneRange();
      preSelectionRange.selectNodeContents(container);
      preSelectionRange.setEnd(range.startContainer, range.startOffset);
      const start = preSelectionRange.toString().length;
      const end = start + range.toString().length;
      return { start, end };
    } catch (e) {
      console.warn('Could not calculate offsets', e);
      return null;
    }
  };

  // TreeWalker text wrapping
  const wrapTextRange = useCallback(
    (container: HTMLElement, start: number, end: number, createWrapper: () => HTMLElement | null) => {
      let charCount = 0;
      let startNode: Node | null = null;
      let startOffset = 0;
      let endNode: Node | null = null;
      let endOffset = 0;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue?.length || 0;
        const nodeEnd = charCount + len;

        if (!startNode && start >= charCount && start < nodeEnd) {
          startNode = node;
          startOffset = start - charCount;
        }

        if (!endNode && end > charCount && end <= nodeEnd) {
          endNode = node;
          endOffset = end - charCount;
          break;
        }

        charCount = nodeEnd;
      }

      if (startNode && endNode) {
        try {
          const range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);

          const wrapper = createWrapper();
          if (wrapper) {
            range.surroundContents(wrapper);
          }
        } catch (e) {
          console.warn('Annotation wrap failed (complex range)', e);
        }
      }
    },
    []
  );

  // Render a single annotation into DOM
  const renderAnnotation = useCallback(
    (ann: AnnotationData) => {
      if (!ann || !ann.id) return;
      if (document.querySelector(`[data-ann-id="${ann.id}"]`)) return;
      if (ann.section_id === 'unknown') return;

      // Locate section
      let section: HTMLElement | null = document.getElementById(ann.section_id);
      if (!section) {
        section = document.querySelector(`.Section[data-section-number="${ann.section_id}"]`);
      }
      if (!section) {
        section = document.querySelector(`[data-section-index="${ann.section_id}"]`);
      }
      if (!section) {
        section = document.querySelector(`[id="${ann.section_id}"]`);
      }
      if (!section) return;

      wrapTextRange(section, ann.start_offset, ann.end_offset, () => {
        const span = document.createElement('span');
        span.setAttribute('data-ann-id', String(ann.id));

        if (ann.annotation_type === 'highlight') {
          if (ann.color === 'none') return null;
          span.className = 'text-highlight';
          span.style.backgroundColor = ann.color || '#ffeb3b';
          span.title = `Highlighted by ${ann.username || 'User'}`;
        } else {
          span.className = 'text-comment';
          span.title = 'Click to view comment';
        }

        span.onclick = (e) => {
          e.stopPropagation();
          const rect = span.getBoundingClientRect();
          const leftPos = Math.max(10, Math.min(rect.left + window.scrollX, window.innerWidth + window.scrollX - 320));
          const topPos = rect.bottom + window.scrollY + 6;

          setReadPopover({
            visible: true,
            x: leftPos,
            y: topPos,
            annotation: ann,
            targetEl: span,
          });
        };

        return span;
      });
    },
    [wrapTextRange]
  );

  // Fetch all annotations for current label
  const fetchAnnotations = useCallback(async () => {
    if (!setId) return;
    const activeProjectId = typeof window !== 'undefined' ? localStorage.getItem('activeProjectId') : null;
    const qs = activeProjectId ? `?project_id=${activeProjectId}` : '';

    try {
      const res = await fetch(`/api/dashboard/annotations/get/${setId}${qs}`);
      const data = await res.json();
      if (data.annotations && Array.isArray(data.annotations)) {
        data.annotations.forEach((ann: AnnotationData) => renderAnnotation(ann));
      }
    } catch (err) {
      console.error('Error fetching annotations:', err);
    }
  }, [setId, renderAnnotation]);

  // Initial fetch and backwards compatibility registration
  useEffect(() => {
    fetchAnnotations();

    // Mirror to window for backwards compatibility with any remaining legacy caller
    if (typeof window !== 'undefined') {
      (window as any).LabelAnnotationManager = {
        fetchAnnotations,
        renderAnnotation,
      };
    }
  }, [fetchAnnotations, renderAnnotation]);

  // Selection detection
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (canComment === false) {
        setToolbar((t) => ({ ...t, visible: false }));
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target?.closest('.selection-toolbar') ||
        target?.closest('.color-palette') ||
        target?.closest('.comment-input-box') ||
        target?.closest('.annotation-read-popover')
      ) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) {
        if (!target?.closest('.text-comment') && !target?.closest('.text-highlight')) {
          setToolbar((t) => ({ ...t, visible: false }));
        }
        return;
      }

      if (selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;

      const root = document.getElementById('label-view');
      let node: HTMLElement | null =
        container.nodeType === Node.ELEMENT_NODE
          ? (container as HTMLElement)
          : container.parentElement;

      let sectionNode: HTMLElement | null = null;
      while (node && node !== root) {
        if (node.classList?.contains('label-section-item') || node.classList?.contains('Section')) {
          sectionNode = node;
          break;
        }
        node = node.parentElement;
      }

      if (!sectionNode) return;

      const rect = range.getBoundingClientRect();
      const topPos = Math.max(10, rect.top - 46);
      const leftPos = Math.max(10, Math.min(rect.left, window.innerWidth - 130));

      setSelectionContext({
        range,
        sectionId: sectionNode.id || sectionNode.getAttribute('data-section-index') || 'unknown',
        sectionNode,
        text: selection.toString(),
      });

      setToolbar({
        visible: true,
        x: leftPos,
        y: topPos,
        mode: 'buttons',
      });
      setCommentText('');
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(target as Node) &&
        !target?.closest('.color-palette') &&
        !target?.closest('.comment-input-box')
      ) {
        setToolbar((t) => ({ ...t, visible: false }));
      }

      if (
        readPopoverRef.current &&
        !readPopoverRef.current.contains(target as Node) &&
        !target?.closest('.text-comment') &&
        !target?.closest('.text-highlight')
      ) {
        setReadPopover(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [canComment]);

  // Focus comment textarea when mode switches
  useEffect(() => {
    if (toolbar.visible && toolbar.mode === 'comment') {
      setTimeout(() => commentInputRef.current?.focus(), 80);
    }
  }, [toolbar.visible, toolbar.mode]);

  // Save annotation action
  const handleSaveAnnotation = async (type: 'highlight' | 'comment', data: { color?: string; comment?: string }) => {
    if (!selectionContext) return;
    if (canComment === false) {
      alert('Highlights and annotations have been disabled for your account.');
      return;
    }

    const { sectionNode, sectionId, range, text } = selectionContext;
    const offsets = getRangeOffsets(sectionNode, range);
    if (!offsets) {
      alert('Could not calculate position. Please try selecting within a single paragraph.');
      return;
    }

    const activeProjectId = typeof window !== 'undefined' ? localStorage.getItem('activeProjectId') : null;

    try {
      const res = await fetch('/api/dashboard/annotations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId || null,
          set_id: setId,
          section_id: sectionId,
          start_offset: offsets.start,
          end_offset: offsets.end,
          selected_text: text,
          annotation_type: type,
          color: data.color || null,
          comment: data.comment || null,
        }),
      });

      const resData = await res.json();
      if (resData.success) {
        renderAnnotation({
          id: resData.id,
          section_id: sectionId,
          start_offset: offsets.start,
          end_offset: offsets.end,
          selected_text: text,
          annotation_type: type,
          color: data.color,
          comment: data.comment,
          username: resData.username,
          user_id: resData.user_id || currentUserId,
          created_at: resData.created_at,
        });

        window.getSelection()?.removeAllRanges();
        setToolbar((t) => ({ ...t, visible: false }));
        setSelectionContext(null);
      } else {
        alert('Failed to save: ' + (resData.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Save annotation error:', err);
      alert('Network error saving annotation.');
    }
  };

  // Delete annotation action
  const handleDeleteAnnotation = async (annId: string | number) => {
    if (!confirm('Are you sure you want to delete this annotation?')) return;

    try {
      const res = await fetch('/api/dashboard/annotations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: annId }),
      });
      const data = await res.json();

      if (data.success) {
        // Unwrap all matching elements
        document.querySelectorAll(`[data-ann-id="${annId}"]`).forEach((el) => {
          const parent = el.parentNode;
          if (!parent) return;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          parent.normalize();
        });
        setReadPopover(null);
      } else {
        alert('Error: ' + (data.error || 'Delete failed'));
      }
    } catch (err) {
      console.error('Delete annotation error:', err);
    }
  };

  const isCreator =
    readPopover &&
    (String(currentUserId) === String(readPopover.annotation.user_id) ||
      !readPopover.annotation.user_id);

  return (
    <>
      {/* Floating Selection Toolbar */}
      {toolbar.visible && (
        <div
          ref={toolbarRef}
          className="selection-toolbar"
          style={{
            position: 'fixed',
            left: `${toolbar.x}px`,
            top: `${toolbar.y}px`,
            zIndex: 10000,
          }}
        >
          {toolbar.mode === 'buttons' && (
            <>
              <button
                type="button"
                className="btn-ann-highlight"
                title="Highlight text"
                aria-label="Highlight"
                onClick={() => setToolbar((t) => ({ ...t, mode: 'palette' }))}
              >
                <span
                  style={{
                    background: '#facc15',
                    width: '14px',
                    height: '14px',
                    borderRadius: '2px',
                    border: '1px solid rgba(0,0,0,0.25)',
                    display: 'inline-block',
                  }}
                />
              </button>
              <button
                type="button"
                className="btn-ann-comment"
                title="Write a Note"
                aria-label="Note"
                onClick={() => setToolbar((t) => ({ ...t, mode: 'comment' }))}
              >
                💬
              </button>
            </>
          )}

          {/* Color Palette Mode */}
          {toolbar.mode === 'palette' && (
            <div className="color-palette" style={{ display: 'flex' }}>
              {HIGHLIGHT_COLORS.map((c) => (
                <div
                  key={c}
                  className={`color-btn ${c === 'none' ? 'none' : ''}`}
                  style={c !== 'none' ? { backgroundColor: c } : undefined}
                  onClick={() => handleSaveAnnotation('highlight', { color: c })}
                  title={c === 'none' ? 'Remove highlight' : `Highlight with ${c}`}
                />
              ))}
            </div>
          )}

          {/* Comment Input Mode */}
          {toolbar.mode === 'comment' && (
            <div className="comment-input-box" style={{ display: 'block' }}>
              <textarea
                ref={commentInputRef}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a note..."
              />
              <div className="comment-input-actions">
                <button
                  type="button"
                  className="btn-cancel-comment"
                  onClick={() => setToolbar((t) => ({ ...t, visible: false }))}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-save-comment"
                  disabled={!commentText.trim()}
                  onClick={() => handleSaveAnnotation('comment', { comment: commentText.trim() })}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Annotation Read Popover */}
      {readPopover && (
        <div
          ref={readPopoverRef}
          className="annotation-read-popover"
          style={{
            position: 'absolute',
            left: `${readPopover.x}px`,
            top: `${readPopover.y}px`,
            zIndex: 10010,
          }}
        >
          <div className="ann-meta">
            <span>
              <strong>{readPopover.annotation.username || 'User'}</strong>
            </span>
            <span>
              {readPopover.annotation.created_at
                ? new Date(readPopover.annotation.created_at).toLocaleDateString()
                : 'Just now'}
            </span>
          </div>

          <div className="ann-content">
            {readPopover.annotation.annotation_type === 'comment'
              ? `"${readPopover.annotation.comment || ''}"`
              : 'Highlighted Text'}
          </div>

          {isCreator && (
            <div className="ann-actions" style={{ marginTop: '10px', textAlign: 'right' }}>
              <button
                type="button"
                className="btn-delete-ann"
                onClick={() => handleDeleteAnnotation(readPopover.annotation.id)}
                style={{
                  background: 'none',
                  border: '1px solid var(--fdl-line, #cbd5e1)',
                  borderRadius: '4px',
                  color: 'var(--afl-danger-500, #ef4444)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
