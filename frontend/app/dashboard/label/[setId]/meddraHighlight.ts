/**
 * MedDRA Adverse Event Term Scanner and SOC Highlighting Controller.
 * Decoupled from legacy faers.js to provide pure TypeScript/React integration.
 */

export interface SocTermItem {
  term: string;
  rawTerm?: string;
  count: number;
  elements: HTMLElement[];
}

export interface SocGroup {
  socName: string;
  socAbbrev?: string;
  totalOccurrences: number;
  terms: SocTermItem[];
}

export type SocCatalog = Record<string, SocGroup>;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scans the label document DOM and wraps verified MedDRA terms from PV-Profile.
 * Returns a structured catalog of terms grouped by SOC.
 */
export function scanAndHighlightMeddraTerms(
  root: HTMLElement,
  pvItems: any[]
): SocCatalog {
  const catalog: SocCatalog = {};

  if (!root || !Array.isArray(pvItems) || pvItems.length === 0) {
    return catalog;
  }

  // 1. Build dictionary mapping lowercased term -> details
  const termsMap: Record<
    string,
    {
      term: string;
      rawTerm?: string;
      soc: string;
      socAbbrev?: string;
      severityTier?: string;
    }
  > = {};

  pvItems.forEach((item) => {
    const pt = (item.meddra_pt || '').trim();
    const raw = (item.term || '').trim();
    const soc = (item.soc_name || 'General disorders and administration site conditions').trim();
    const socAbbrev = (item.soc_abbrev || '').trim();

    if (pt && pt.length > 2) {
      termsMap[pt.toLowerCase()] = {
        term: pt,
        soc,
        socAbbrev,
        severityTier: item.severity_tier,
      };
    }
    if (raw && raw.length > 2 && raw.toLowerCase() !== pt.toLowerCase()) {
      termsMap[raw.toLowerCase()] = {
        term: pt,
        rawTerm: raw,
        soc,
        socAbbrev,
        severityTier: item.severity_tier,
      };
    }
  });

  const termKeys = Object.keys(termsMap).sort((a, b) => b.length - a.length);
  if (termKeys.length === 0) return catalog;

  // 2. Build regex
  let pattern: RegExp;
  try {
    pattern = new RegExp(`\\b(${termKeys.map(escapeRegExp).join('|')})\\b`, 'gi');
  } catch (err) {
    console.error('Failed to construct MedDRA regex pattern:', err);
    return catalog;
  }

  // 3. Collect text nodes using TreeWalker
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  // 4. Wrap matching terms in <span class="meddra-term-base">
  textNodes.forEach((node) => {
    const parent = node.parentNode as HTMLElement | null;
    if (!parent) return;

    const tag = parent.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'TEXTAREA', 'BUTTON', 'INPUT', 'SELECT'].includes(tag)) return;
    if (parent.classList.contains('meddra-term-base')) return;

    const text = node.nodeValue;
    if (!text || !pattern.test(text)) return;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const matchedText = match[0];
      const lower = matchedText.toLowerCase();
      const details = termsMap[lower];

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
      }

      const span = document.createElement('span');
      span.textContent = matchedText;

      if (details) {
        span.setAttribute('data-term', details.term);
        span.setAttribute('data-soc', details.soc);
        if (details.socAbbrev) {
          span.setAttribute('data-soc-abbrev', details.socAbbrev);
        }
        span.className = 'meddra-term-base';
      }

      fragment.appendChild(span);
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    parent.replaceChild(fragment, node);
  });

  // 5. Index all rendered span elements into the SocCatalog
  const renderedSpans = root.querySelectorAll<HTMLElement>('span.meddra-term-base');
  renderedSpans.forEach((span) => {
    const socName = span.getAttribute('data-soc') || 'Unknown';
    const socAbbrev = span.getAttribute('data-soc-abbrev') || '';
    const term = span.getAttribute('data-term') || span.textContent || '';

    if (!catalog[socName]) {
      catalog[socName] = {
        socName,
        socAbbrev,
        totalOccurrences: 0,
        terms: [],
      };
    }

    const group = catalog[socName];
    group.totalOccurrences += 1;

    let termItem = group.terms.find((t) => t.term.toLowerCase() === term.toLowerCase());
    if (!termItem) {
      termItem = {
        term,
        count: 0,
        elements: [],
      };
      group.terms.push(termItem);
    }

    termItem.count += 1;
    termItem.elements.push(span);
  });

  // Sort terms inside each group by count descending, then alphabetically
  Object.values(catalog).forEach((group) => {
    group.terms.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  });

  return catalog;
}

/**
 * Highlights all terms belonging to the specified SOC with .meddra-soc-highlight.
 */
export function applySocHighlight(root: HTMLElement, targetSoc: string): void {
  if (!root || !targetSoc) return;
  const elements = root.querySelectorAll<HTMLElement>('.meddra-term-base');
  elements.forEach((el) => {
    const soc = el.getAttribute('data-soc');
    if (soc === targetSoc) {
      el.classList.add('meddra-soc-highlight');
    } else {
      el.classList.remove('meddra-soc-highlight');
    }
  });
}

/**
 * Clears SOC highlights across the entire document.
 */
export function clearSocHighlight(root: HTMLElement): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>('.meddra-soc-highlight');
  elements.forEach((el) => el.classList.remove('meddra-soc-highlight'));
}

/**
 * Scrolls the document smoothly to a specific term occurrence and briefly focuses it.
 */
export function scrollToTermElement(element: HTMLElement): void {
  if (!element) return;

  // Scroll into view
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  });

  // Apply brief focus pulse
  element.classList.remove('meddra-term-focused');
  // Trigger reflow to restart animation if already applied
  void element.offsetWidth;
  element.classList.add('meddra-term-focused');

  setTimeout(() => {
    element.classList.remove('meddra-term-focused');
  }, 2200);
}

/**
 * Attaches a modern, clean implementation of window.loadMeddraStatistics
 * so the AEs modal (#meddra-stats-modal) continues to work without needing legacy faers.js.
 */
export function setupMeddraStatistics(pvData: any): void {
  if (typeof window === 'undefined') return;

  (window as any).loadMeddraStatistics = function () {
    const modalBody = document.getElementById('meddra-stats-body');
    if (!modalBody) return;

    if (!pvData || !pvData.has_record || !Array.isArray(pvData.items) || pvData.items.length === 0) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #64748b;">
          <p style="font-size: 1.1em; font-weight: 600; color: #0f172a; margin-bottom: 8px;">PV-Profile Not Generated Yet</p>
          <p style="font-size: 0.875rem; max-width: 420px; margin: 0 auto; line-height: 1.5;">
            Please open the <strong>PV-Profile</strong> tool in the Toolbox tab to generate and verify Adverse Event statistics for this drug product.
          </p>
        </div>
      `;
      return;
    }

    const socCounts: Record<string, number> = {};
    const uniqueTerms = new Set<string>();

    pvData.items.forEach((item: any) => {
      const pt = (item.meddra_pt || '').trim();
      const soc = (item.soc_name || 'General disorders and administration site conditions').trim();

      if (pt && !uniqueTerms.has(pt.toLowerCase())) {
        uniqueTerms.add(pt.toLowerCase());
        socCounts[soc] = (socCounts[soc] || 0) + 1;
      }
    });

    const labels = Object.keys(socCounts).sort((a, b) => socCounts[b] - socCounts[a]);
    const counts = labels.map((l) => socCounts[l]);
    const colors = labels.map((_, i) => `hsl(${(i * 360) / Math.max(labels.length, 1)}, 70%, 60%)`);
    const borderColors = labels.map((_, i) => `hsl(${(i * 360) / Math.max(labels.length, 1)}, 70%, 40%)`);

    modalBody.innerHTML = `
      <div style="height: 340px; width: 100%;">
        <canvas id="meddraStatsChart"></canvas>
      </div>
    `;

    const Chart = (window as any).Chart;
    if (!Chart) {
      modalBody.innerHTML = '<p style="color: red; padding: 20px;">Chart library not loaded.</p>';
      return;
    }

    const canvas = document.getElementById('meddraStatsChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Adverse Events',
            data: counts,
            backgroundColor: colors,
            borderColor: borderColors,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: `Verified Adverse Events: ${uniqueTerms.size} signals across ${labels.length} Organ Systems`,
          },
        },
        scales: {
          y: { beginAtZero: true },
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45,
              font: { size: 10 },
            },
          },
        },
      },
    });
  };
}

