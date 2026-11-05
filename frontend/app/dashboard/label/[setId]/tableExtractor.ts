/**
 * Table extractor helper for FDA label reader.
 * Wraps tables within the label document with .table-wrapper and injects
 * an "Extract" button that dispatches 'open-table-extractor' to launch
 * the Excel-style TableExtractorModal.
 */

function isNestedDataTable(table: HTMLTableElement): boolean {
  const parentCell = table.parentElement?.closest('td, th');
  const parentTable = parentCell?.closest('table');
  return Boolean(parentTable && parentTable !== table && parentTable.querySelectorAll('tr').length > 2);
}

function findTableTitle(table: HTMLTableElement): string {
  const caption = table.caption?.textContent?.trim();
  if (caption) return caption;
  const wrapper = table.closest('.spl-table-wrapper, .table-wrapper');
  let prev = (wrapper || table).previousElementSibling;
  for (let i = 0; i < 3 && prev; i++) {
    const validTag = ['H1', 'H2', 'H3', 'H4', 'P'].includes(prev.tagName);
    const text = prev.textContent?.trim() || '';
    if (validTag && text.length > 2 && text.length <= 240) return text;
    prev = prev.previousElementSibling;
  }
  return 'Table';
}

function sanitizeTableClone(table: HTMLTableElement): HTMLTableElement {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelectorAll('.btn-extract-table, .btn-analyze-image').forEach((btn) => btn.remove());
  clone.className = 'excel-style-table';
  clone.removeAttribute('style');
  clone.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('width');
    el.removeAttribute('height');
  });
  return clone;
}

export function initTableExtractor(root: HTMLElement | null): void {
  if (!root) return;

  const tables = root.querySelectorAll<HTMLTableElement>('table');
  tables.forEach((table) => {
    // Avoid re-wrapping if an extract button already exists
    const existingWrapper = table.closest('.spl-table-wrapper, .table-wrapper');
    if (existingWrapper?.querySelector('.btn-extract-table')) return;
    if (isNestedDataTable(table)) return;

    try {
      let wrapper = existingWrapper as HTMLElement | null;
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        table.parentNode?.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }

      wrapper.style.position = 'relative';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-extract-table';
      btn.textContent = 'View table';
      btn.title = 'View table and copy cells';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const title = findTableTitle(table);
        const clone = sanitizeTableClone(table);
        window.dispatchEvent(
          new CustomEvent('open-table-extractor', {
            detail: {
              title,
              html: clone.outerHTML,
            },
          })
        );
      });

      wrapper.insertBefore(btn, wrapper.firstChild);
    } catch (err) {
      console.error('Error wrapping table for extraction:', err);
    }
  });
}
