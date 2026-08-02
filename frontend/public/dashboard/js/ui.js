(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const show = (el, display = 'block') => { if (el) el.style.display = display; };
  const hide = (el) => { if (el) el.style.display = 'none'; };

  const EMPTY_NOTES_HTML =
    '<p style="text-align:center; color:#94a3b8; padding:20px;">No personal notes or annotations found in this label.</p>';

  let uiInitialized = false;

  window.initUI = function initUI() {
    if (uiInitialized) return;
    uiInitialized = true;

    initBackToTop();
    initTocToggle();
    initTableResizing();
    initMeddraStatsModal();
    initAiPreferencesModal();
    initTableExtractorModal();
    initUserNotesModal();
    initGlobalModalClose();

    window.initTableExtractor = initTableExtractor;

    [500, 1500, 3000].forEach(delay => {
      setTimeout(initTableExtractor, delay);
    });
  };

  function initBackToTop() {
    const btn = $('#scroll-top-btn');
    const container = $('.main-content') || window;

    if (!btn) return;

    btn.addEventListener('click', () => {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function initTocToggle() {
    const tocToggle = $('#toc-toggle');
    const tocCloseInternal = $('#toc-close-internal');
    const showTocBtn = $('#show-toc-btn');
    const tocPanel = $('#toc-panel');
    const mainContent = $('#main-content');

    if (!tocPanel || !mainContent) return;

    const toggleToc = () => {
      const isHidden = tocPanel.classList.toggle('hidden');
      mainContent.classList.toggle('expanded', isHidden);

      if (tocToggle) tocToggle.innerHTML = isHidden ? '&raquo;' : '&laquo;';
      if (showTocBtn) showTocBtn.style.display = isHidden ? 'inline-flex' : 'none';
    };

    tocToggle?.addEventListener('click', toggleToc);
    tocCloseInternal?.addEventListener('click', toggleToc);
    showTocBtn?.addEventListener('click', toggleToc);
  }

  function initTableResizing() {
    $$('table.diff th').forEach(th => {
      if ($('.resizer', th)) return;

      const resizer = document.createElement('div');
      resizer.className = 'resizer';
      th.appendChild(resizer);

      let startX = 0;
      let startWidth = 0;

      const onMouseMove = e => {
        th.style.width = `${Math.max(40, startWidth + e.clientX - startX)}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        resizer.classList.remove('resizing');
      };

      resizer.addEventListener('mousedown', e => {
        startX = e.clientX;
        startWidth = parseInt(getComputedStyle(th).width, 10) || th.offsetWidth;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        resizer.classList.add('resizing');

        e.preventDefault();
      });
    });
  }

  function initMeddraStatsModal() {
    const modal = $('#meddra-stats-modal');
    const closeBtn = $('#close-meddra-stats');

    if (!modal) return;

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#meddra-stats-btn');
      if (btn) {
        show(modal);
        window.loadMeddraStatistics?.();
      }
    });

    closeBtn?.addEventListener('click', () => hide(modal));
  }

  function initAiPreferencesModal() {
    const openBtn = $('#open-ai-prefs');
    const modal = $('#ai-prefs-modal');
    const closeBtn = $('#close-ai-prefs');
    const form = $('#ai-prefs-form');

    if (!openBtn || !modal) return;

    openBtn.addEventListener('click', () => show(modal));
    closeBtn?.addEventListener('click', () => hide(modal));

    if (!form) return;

    $$('input[name="ai_provider"]', form).forEach(radio => {
      radio.addEventListener('change', () => {
        show($('#modal-gemini-config'), radio.value === 'gemini' ? 'block' : 'none');
        show($('#modal-openai-config'), radio.value === 'openai' ? 'block' : 'none');
      });
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();

      const payload = Object.fromEntries(new FormData(form).entries());

      try {
        const response = await fetch('/api/dashboard/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        alert('AI Model preferences updated successfully.');
        hide(modal);
      } catch (err) {
        console.error('Error updating AI preferences:', err);
        alert('An error occurred while saving preferences.');
      }
    });
  }

  function initTableExtractor() {
    const labelView = $('#label-view');
    if (!labelView) return;

    let addedCount = 0;

    $$('table', labelView).forEach(table => {
      if (table.closest('.table-wrapper')) return;
      if (isNestedDataTable(table)) return;

      try {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';

        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);

        const btn = document.createElement('button');
        btn.className = 'btn-extract-table';
        btn.innerHTML = '<span>&#128229;</span> Extract';
        btn.title = 'Open in Excel-style viewer';
        btn.addEventListener('click', () => openTableExtractor(table));

        wrapper.appendChild(btn);
        addedCount++;
      } catch (err) {
        console.error('Error wrapping table:', err);
      }
    });

    if (addedCount > 0) {
      window.reapplyMeddraHighlights?.();
    }
  }

  function isNestedDataTable(table) {
    const parentCell = table.parentElement?.closest('td, th');
    const parentTable = parentCell?.closest('table');

    return Boolean(parentTable && parentTable !== table && $$('tr', parentTable).length > 2);
  }

  function initTableExtractorModal() {
    const closeBtn = $('#close-table-extract');
    const modal = $('#table-extract-modal');

    closeBtn?.addEventListener('click', () => hide(modal));
  }

  function openTableExtractor(originalTable) {
    const modal = $('#table-extract-modal');
    const container = $('#table-extract-container');
    const titleEl = $('#table-extract-title');

    if (!modal || !container) return;

    if (titleEl) {
      titleEl.textContent = findTableTitle(originalTable);
    }

    const clone = sanitizeTableClone(originalTable);

    container.innerHTML = '';
    container.appendChild(clone);

    show(modal);
    clone.tabIndex = 0;
    clone.focus();

    initCellSelection(clone);
  }

  function findTableTitle(table) {
    let prev = table.previousElementSibling;

    for (let i = 0; i < 3 && prev; i++) {
      const validTag = ['H1', 'H2', 'H3', 'H4', 'P'].includes(prev.tagName);
      const text = prev.textContent.trim();

      if (validTag && text.length > 2) return text;

      prev = prev.previousElementSibling;
    }

    return 'Table Data';
  }

  function sanitizeTableClone(table) {
    const clone = table.cloneNode(true);

    $$('.btn-extract-table', clone).forEach(btn => btn.remove());

    clone.className = 'excel-style-table';
    clone.removeAttribute('style');

    $$('*', clone).forEach(el => {
      el.removeAttribute('width');
      el.removeAttribute('height');
    });

    return clone;
  }

  function initCellSelection(table) {
    const copyBtn = $('#copy-selection-btn');
    let isDragging = false;
    let startCell = null;

    const coords = cell => ({
      row: cell.parentElement.rowIndex,
      col: cell.cellIndex
    });

    const clearSelection = () => {
      $$('.selected-cell', table).forEach(cell => cell.classList.remove('selected-cell'));
    };

    const selectRange = endCell => {
      const start = coords(startCell);
      const end = coords(endCell);

      const minRow = Math.min(start.row, end.row);
      const maxRow = Math.max(start.row, end.row);
      const minCol = Math.min(start.col, end.col);
      const maxCol = Math.max(start.col, end.col);

      $$('td, th', table).forEach(cell => {
        const c = coords(cell);
        cell.classList.toggle(
          'selected-cell',
          c.row >= minRow && c.row <= maxRow && c.col >= minCol && c.col <= maxCol
        );
      });
    };

    const getSelectedTSV = () => {
      const selected = $$('.selected-cell', table);
      if (!selected.length) return null;

      const rows = {};

      selected.forEach(cell => {
        const row = cell.parentElement.rowIndex;
        rows[row] ||= [];

        let text = cell.innerText.trim();

        if (/[\n\t"]/.test(text)) {
          text = `"${text.replace(/"/g, '""')}"`;
        }

        rows[row].push(text);
      });

      return Object.keys(rows)
        .sort((a, b) => Number(a) - Number(b))
        .map(row => rows[row].join('\t'))
        .join('\n');
    };

    const showCopyState = (success) => {
      if (!copyBtn) return;

      const original = '<span>&#128203;</span> Copy Selection';

      copyBtn.innerHTML = success
        ? '<span>&#9989;</span> Copied!'
        : '<span>&#10060;</span> Copy Failed';

      if (!success) copyBtn.style.backgroundColor = '#dc3545';

      setTimeout(() => {
        copyBtn.innerHTML = original;
        copyBtn.style.backgroundColor = '';
      }, 2000);
    };

    const fallbackCopy = text => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        showCopyState(document.execCommand('copy'));
      } catch (err) {
        console.error('Fallback copy failed:', err);
        showCopyState(false);
      } finally {
        textarea.remove();
      }
    };

    const copySelection = async () => {
      const tsv = getSelectedTSV();
      if (!tsv) return;

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(tsv);
          showCopyState(true);
        } else {
          fallbackCopy(tsv);
        }
      } catch (err) {
        console.error('Clipboard API failed:', err);
        fallbackCopy(tsv);
      }
    };

    table.addEventListener('mousedown', e => {
      const cell = e.target.closest('td, th');
      if (!cell) return;

      isDragging = true;
      startCell = cell;

      clearSelection();
      cell.classList.add('selected-cell');

      if (copyBtn) copyBtn.style.display = 'inline-flex';

      e.preventDefault();
    });

    table.addEventListener('mouseover', e => {
      if (!isDragging) return;

      const cell = e.target.closest('td, th');
      if (cell) selectRange(cell);
    });

    table.addEventListener('copy', e => {
      const tsv = getSelectedTSV();
      if (!tsv) return;

      e.clipboardData.setData('text/plain', tsv);
      e.preventDefault();
      showCopyState(true);
    });

    table.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelection();
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    }, { once: false });

    copyBtn?.addEventListener('click', copySelection);
  }

  function initUserNotesModal() {
    const notesModal = $('#user-notes-modal');
    const closeNotesBtn = $('#close-user-notes');

    if (!notesModal) return;

    document.addEventListener('click', (e) => {
      const notesBtn = e.target.closest('#user-notes-btn');
      if (notesBtn) {
        show(notesModal);
        loadUserNotesSummary();
      }
    });

    closeNotesBtn?.addEventListener('click', () => hide(notesModal));
  }

  function loadUserNotesSummary() {
    const container = $('#notes-list-container');
    const notesModal = $('#user-notes-modal');

    if (!container) return;

    const notes = collectUserNotes();

    container.innerHTML = '';

    if (!notes.length) {
      container.innerHTML = EMPTY_NOTES_HTML;
      return;
    }

    notes.forEach(note => {
      container.appendChild(createNoteSummaryItem(note, notesModal, container));
    });
  }

  function collectUserNotes() {
    const notes = [];

    $$('.chat-annotation-badge').forEach(badge => {
      const qEl = $('.popover-q', badge);
      if (!qEl) return;

      const question = qEl.textContent.replace(/^Q:\s*/, '').trim();
      const lower = question.toLowerCase();

      if (lower.includes('faers') || lower.includes('reports')) return;

      notes.push({
        type: 'QA',
        text: question,
        element: badge,
        section: badge.closest('.Section')?.getAttribute('data-section-number') || 'TOP'
      });
    });

    $$('.text-highlight, .text-comment').forEach(annotation => {
      const isComment = annotation.classList.contains('text-comment');

      notes.push({
        type: isComment ? 'Comment' : 'Highlight',
        text: annotation.textContent.trim(),
        element: annotation,
        section: annotation.closest('.Section')?.getAttribute('data-section-number') || 'Label'
      });
    });

    return notes;
  }

  function createNoteSummaryItem(note, notesModal, container) {
    const item = document.createElement('div');
    item.className = 'note-summary-item';

    const tagClass = {
      QA: 'tag-qa',
      Comment: 'tag-comment',
      Highlight: 'tag-highlight'
    }[note.type];

    const noteId = note.type === 'QA'
      ? note.element.getAttribute('data-id')
      : note.element.getAttribute('data-ann-id');

    item.innerHTML = `
      <div class="note-item-header">
        <span class="note-type-tag ${tagClass}">${note.type}</span>
        ${noteId ? `
          <button class="note-delete-btn" title="Delete Note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        ` : ''}
      </div>
      <div class="note-summary-text">${escapeHtml(truncate(note.text, 150))}</div>
      <div class="note-summary-meta">Location: Section ${escapeHtml(note.section)}</div>
    `;

    item.addEventListener('click', e => {
      if (e.target.closest('.note-delete-btn')) return;

      hide(notesModal);
      note.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (note.type === 'QA') {
        note.element.click();
      } else {
        flashElement(note.element);
      }
    });

    $('.note-delete-btn', item)?.addEventListener('click', e => {
      e.stopPropagation();
      deleteNote(note, noteId, item, container);
    });

    return item;
  }

  async function deleteNote(note, noteId, item, container) {
    if (!noteId || !confirm('Are you sure you want to delete this note?')) return;

    try {
      const isQA = note.type === 'QA';

      const response = await fetch(
        isQA ? '/api/dashboard/delete_annotation' : '/api/dashboard/annotations/delete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isQA
              ? { set_id: window.currentSetId, id: noteId }
              : { id: noteId }
          )
        }
      );

      const data = await response.json();

      if (!data.success) throw new Error('Delete failed');

      if (isQA) {
        note.element.remove();
      } else {
        unwrapElement(note.element);
      }

      item.remove();

      if (!container.children.length) {
        container.innerHTML = EMPTY_NOTES_HTML;
      }
    } catch (err) {
      console.error('Error deleting note:', err);
      alert('Error deleting note.');
    }
  }

  function unwrapElement(el) {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  function flashElement(el) {
    const originalBg = el.style.backgroundColor;
    const originalColor = el.style.color;

    el.style.backgroundColor = '#fd7e14';
    el.style.color = 'white';

    setTimeout(() => {
      el.style.backgroundColor = originalBg;
      el.style.color = originalColor;
    }, 1000);
  }

  function initGlobalModalClose() {
    window.addEventListener('click', event => {
      [
        '#meddra-stats-modal',
        '#ai-prefs-modal',
        '#table-extract-modal',
        '#user-notes-modal'
      ].forEach(selector => {
        const modal = $(selector);
        if (event.target === modal) hide(modal);
      });
    });
  }

  function truncate(text, length) {
    return text.length > length ? `${text.slice(0, length)}...` : text;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initUI, { once: true });
  } else {
    window.initUI();
  }
})();