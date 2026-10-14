'use client';

import { marked } from 'marked';

export interface SavedAnnotation {
  id?: string | number;
  question: string;
  answer: string;
  section_number: string;
  keywords?: string[];
}

export function parseMarkdownSafely(text: string): string {
  try {
    return marked.parse(text || '') as string;
  } catch (err) {
    console.warn('Marked parse error:', err);
    return String(text || '').replace(/\n/g, '<br>');
  }
}

export function createAnnotationBadge(
  question: string,
  answer: string,
  sectionNum: string,
  keywords?: string[],
  id: string | number | null = null,
  isSaved: boolean = false,
  canComment: boolean = true,
  currentSetId?: string
) {
  if (typeof document === 'undefined') return;

  const effectiveSetId = currentSetId || (window as any).currentSetId;
  let sectionEl = document.querySelector(`.Section[data-section-number="${sectionNum}"]`) as HTMLElement | null;
  let header = sectionEl ? (sectionEl.querySelector('h2') as HTMLElement | null) : null;

  // Fallback to top of document if section not found or explicitly requested as TOP
  if (!header || sectionNum === 'TOP') {
    header = document.getElementById('top-annotations-container');
    sectionEl = (document.getElementById('label-view') || document.querySelector('.container')) as HTMLElement | null;
    sectionNum = 'TOP';
  }

  if (!header) {
    console.warn(`createAnnotationBadge: Could not find target element for section "${sectionNum}"`);
    return;
  }

  // Deduplication check: if badge exists with same Q, skip
  const existingBadges = header.querySelectorAll('.chat-annotation-badge');
  for (const b of Array.from(existingBadges)) {
    const popoverQ = b.querySelector('.popover-q');
    if (popoverQ && popoverQ.textContent === `Q: ${question}`) return;
  }

  // Match Type Detection
  let matchType: 'yes' | 'probable' | null = null;
  if (keywords && Array.isArray(keywords)) {
    if (keywords.includes('match:yes')) matchType = 'yes';
    else if (keywords.includes('match:probable')) matchType = 'probable';
  }

  const badge = document.createElement('span');
  badge.className = 'chat-annotation-badge' + (isSaved ? ' saved' : '');
  if (id) badge.setAttribute('data-id', String(id));

  let iconSymbol = '&#128172;';
  let headerTitle = '<span>&#10024;</span> AI INSIGHT';

  if (matchType === 'yes') {
    badge.classList.add('match-yes');
    iconSymbol = '&#10003;';
    headerTitle = '<span>&#9989;</span> AI CONFIRMED';
  } else if (matchType === 'probable') {
    badge.classList.add('match-probable');
    iconSymbol = '?';
    headerTitle = '<span>&#9888;</span> AI PROBABLE';
  }

  badge.innerHTML = iconSymbol;
  badge.title = 'Click to toggle sticky note & highlights';

  const popover = document.createElement('div');
  popover.className = 'annotation-popover';
  if (matchType) popover.classList.add(`match-${matchType}`);

  const userCanComment = canComment && (window as any).canComment !== false;

  popover.innerHTML = `
    <div class="annotation-popover-header">
      <div class="popover-header-title">${headerTitle}</div>
      <div class="popover-actions">
        ${!isSaved && userCanComment ? `<button class="save-note-btn" title="Save permanently">&#128190;</button>` : ''}
        <button class="delete-note-btn" title="Delete note">&#128465;</button>
        <button class="close-note-btn" title="Close note">&times;</button>
      </div>
    </div>
    <div class="popover-content-wrapper">
      <span class="popover-q">Q: ${question}</span>
      <div class="popover-a">${parseMarkdownSafely(answer)}</div>
    </div>
  `;

  badge.appendChild(popover);
  header.appendChild(badge);

  // Drag functionality
  const popoverHeader = popover.querySelector('.annotation-popover-header') as HTMLElement | null;
  let isDragging = false;
  let currentX = 0, currentY = 0, initialX = 0, initialY = 0;
  let xOffset = 0, yOffset = 0;

  const dragStart = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest('.popover-actions')) return;

    const style = window.getComputedStyle(popover);
    const matrix = new DOMMatrixReadOnly(style.transform);
    xOffset = matrix.m41;
    yOffset = matrix.m42;

    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (badge.classList.contains('sticky')) {
      isDragging = true;
      popover.classList.add('is-dragging');
    }
  };

  const drag = (e: MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    xOffset = currentX;
    yOffset = currentY;
    popover.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
  };

  const dragEnd = () => {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
    popover.classList.remove('is-dragging');
  };

  if (popoverHeader) {
    popoverHeader.addEventListener('mousedown', dragStart);
  }
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  // Toggle sticky & highlights on badge click
  badge.addEventListener('click', (e) => {
    if ((e.target as HTMLElement)?.closest('.annotation-popover')) {
      e.stopPropagation();
      return;
    }

    e.stopPropagation();
    const isSticky = badge.classList.toggle('sticky');

    if (isSticky) {
      const rect = popover.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        popover.style.left = 'auto';
        popover.style.right = '0';
        popover.style.transform = 'none';
      }
      if (rect.left < 0) {
        popover.style.left = '0';
        popover.style.transform = 'none';
      }
    }

    // Clean existing AI highlights in section
    if (sectionEl) {
      sectionEl.querySelectorAll('.ai-highlight, .ai-highlight-yes, .ai-highlight-probable').forEach((hl) => {
        const text = hl.textContent || '';
        hl.parentNode?.replaceChild(document.createTextNode(text), hl);
      });
      sectionEl.normalize();
    }

    if (isSticky && sectionEl) {
      // Highlight quote if present
      const quoteMatch = answer.match(/>\s*"?([^"\n]+)"?/);
      if (quoteMatch && quoteMatch[1]) {
        const quoteText = quoteMatch[1].trim();
        if (quoteText.length > 5) {
          let highlightClass = 'ai-highlight';
          if (matchType === 'yes') highlightClass = 'ai-highlight-yes';
          else if (matchType === 'probable') highlightClass = 'ai-highlight-probable';
          highlightText(sectionEl, quoteText, highlightClass);
        }
      }

      // Highlight keywords
      if (keywords && keywords.length > 0) {
        keywords.forEach((phrase) => {
          if (!phrase || phrase.length < 3 || phrase.startsWith('match:')) return;
          highlightText(sectionEl!, phrase, 'ai-highlight');
        });
      }
    }
  });

  // Close note
  popover.querySelector('.close-note-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    badge.classList.remove('sticky');

    if (sectionEl) {
      sectionEl.querySelectorAll('.ai-highlight, .ai-highlight-yes, .ai-highlight-probable').forEach((hl) => {
        const text = hl.textContent || '';
        hl.parentNode?.replaceChild(document.createTextNode(text), hl);
      });
      sectionEl.normalize();
    }
  });

  // Save note button
  const saveBtn = popover.querySelector('.save-note-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!userCanComment) {
        alert('Commenting and saving notes has been disabled for your account.');
        return;
      }
      try {
        const res = await fetch('/api/dashboard/save_annotation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            set_id: effectiveSetId,
            section_number: sectionNum,
            question,
            answer,
            keywords,
          }),
        });
        const data = await res.json();
        if (data.success) {
          badge.classList.add('saved');
          badge.setAttribute('data-id', String(data.id));
          saveBtn.remove();
        } else if (data.error) {
          alert(data.error);
        }
      } catch (err) {
        console.error('Save annotation failed', err);
      }
    });
  }

  // Delete note button
  popover.querySelector('.delete-note-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const annotationId = badge.getAttribute('data-id');
    if (annotationId) {
      if (!confirm('Are you sure you want to delete this saved note?')) return;
      try {
        await fetch('/api/dashboard/delete_annotation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_id: effectiveSetId, id: annotationId }),
        });
      } catch (err) {
        console.error('Delete annotation failed', err);
      }
    }
    badge.remove();

    if (badge.classList.contains('sticky') && sectionEl) {
      sectionEl.querySelectorAll('.ai-highlight, .ai-highlight-yes, .ai-highlight-probable').forEach((hl) => {
        const text = hl.textContent || '';
        hl.parentNode?.replaceChild(document.createTextNode(text), hl);
      });
      sectionEl.normalize();
    }
  });
}

export function highlightText(element: HTMLElement | Node, phrase: string, className = 'ai-highlight') {
  if (element.nodeType === Node.TEXT_NODE) {
    const text = element.nodeValue || '';
    const lowerText = text.toLowerCase();
    const lowerPhrase = String(phrase || '').toLowerCase();
    const index = lowerText.indexOf(lowerPhrase);

    if (index >= 0) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text.substr(index, phrase.length);

      const afterNode = document.createTextNode(text.substr(index + phrase.length));
      const parent = element.parentNode;
      if (parent) {
        parent.insertBefore(document.createTextNode(text.substr(0, index)), element);
        parent.insertBefore(span, element);
        parent.insertBefore(afterNode, element);
        parent.removeChild(element);
      }
    }
  } else if (
    element.nodeType === Node.ELEMENT_NODE &&
    !(element as HTMLElement).classList.contains('ai-highlight') &&
    !(element as HTMLElement).classList.contains('ai-highlight-yes') &&
    !(element as HTMLElement).classList.contains('ai-highlight-probable') &&
    !['SCRIPT', 'STYLE'].includes((element as HTMLElement).tagName)
  ) {
    Array.from(element.childNodes).forEach((child) => highlightText(child, phrase, className));
  }
}

export function annotateDocument(
  question: string,
  rawAnswer: string,
  keywords?: string[],
  currentSetId?: string,
  canComment: boolean = true
) {
  const cleanAnswer = rawAnswer.replace(/\[KEYWORDS: .*?\]/g, '').trim();
  const citationRegex = /\((?:Section\s+)?\s*(\d+(?:\.\d+)*)\s*\)/gi;
  const matches = [...cleanAnswer.matchAll(citationRegex)];
  const uniqueSections = [...new Set(matches.map((m) => m[1]))];

  if (uniqueSections.length === 0) {
    createAnnotationBadge(question, cleanAnswer, 'TOP', keywords, null, false, canComment, currentSetId);
  } else {
    uniqueSections.forEach((sectionNum) => {
      createAnnotationBadge(question, cleanAnswer, sectionNum, keywords, null, false, canComment, currentSetId);
    });
  }
}

// Global attachment for compatibility with faers.js / other legacy scripts
if (typeof window !== 'undefined') {
  (window as any).createAnnotationBadge = createAnnotationBadge;
}
