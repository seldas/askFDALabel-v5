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
 * Clears SOC highlights and focus highlights across the entire document.
 */
export function clearSocHighlight(root: HTMLElement): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>('.meddra-soc-highlight');
  elements.forEach((el) => el.classList.remove('meddra-soc-highlight'));
  const focusElements = root.querySelectorAll<HTMLElement>('.meddra-focus-highlight');
  focusElements.forEach((el) => el.classList.remove('meddra-focus-highlight'));
}

/**
 * Scrolls the document smoothly to a specific term occurrence and briefly focuses it.
 */
export function scrollToTermElement(element: HTMLElement): void {
  if (!element) return;

  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  });

  element.classList.remove('meddra-term-focused');
  void element.offsetWidth;
  element.classList.add('meddra-term-focused');

  setTimeout(() => {
    element.classList.remove('meddra-term-focused');
  }, 2200);
}

/**
 * Focuses/picks a MedDRA term in the document with vivid highlight, closes modal, and scrolls to it.
 */
export function focusMeddraTerm(term: string): void {
  const lowerTerm = term.trim().toLowerCase();
  const allSignals = Array.from(document.querySelectorAll<HTMLElement>('.meddra-term-base'));
  let firstMatch: HTMLElement | null = null;
  let targetSoc: string | null = null;

  for (const el of allSignals) {
    const elTerm = (el.getAttribute('data-term') || el.textContent || '').trim().toLowerCase();
    if (elTerm === lowerTerm) {
      el.classList.add('meddra-focus-highlight');
      if (!firstMatch) {
        firstMatch = el;
        targetSoc = el.getAttribute('data-soc');
      }
    } else {
      el.classList.remove('meddra-focus-highlight');
    }
  }

  if (!firstMatch) {
    // Fallback: substring matching
    for (const el of allSignals) {
      const elText = (el.textContent || '').trim().toLowerCase();
      if (elText.includes(lowerTerm)) {
        el.classList.add('meddra-focus-highlight');
        if (!firstMatch) {
          firstMatch = el;
          targetSoc = el.getAttribute('data-soc');
        }
      }
    }
  }

  if (firstMatch) {
    // Close AE stats modal
    const modal = document.getElementById('meddra-stats-modal');
    if (modal) modal.style.display = 'none';

    // Dispatch event so label view and left navigation sync to this SOC
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('meddra:focus-term', {
          detail: { term, soc: targetSoc },
        })
      );
    }

    // Scroll smoothly to the first matching element
    const matchEl: HTMLElement = firstMatch;
    setTimeout(() => {
      matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  } else {
    alert(`Could not find "${term}" in the visible label text.`);
  }
}

if (typeof window !== 'undefined') {
  (window as any).focusMeddraTerm = focusMeddraTerm;
}

export const MEDDRA_SOC_ABBREV: Record<string, string> = {
  'Blood and lymphatic system disorders': 'BLOOD',
  'Cardiac disorders': 'CARD',
  'Congenital, familial and genetic disorders': 'CONG',
  'Ear and labyrinth disorders': 'EAR',
  'Endocrine disorders': 'ENDO',
  'Eye disorders': 'EYE',
  'Gastrointestinal disorders': 'GAST',
  'General disorders and administration site conditions': 'GENRL',
  'Hepatobiliary disorders': 'HEPAT',
  'Immune system disorders': 'IMMUN',
  'Infections and infestations': 'INFEC',
  'Injury, poisoning and procedural complications': 'INJ&P',
  'Investigations': 'INV',
  'Metabolism and nutrition disorders': 'METAB',
  'Musculoskeletal and connective tissue disorders': 'MUSC',
  'Neoplasms benign, malignant and unspecified (incl cysts and polyps)': 'NEOPL',
  'Nervous system disorders': 'NERV',
  'Pregnancy, puerperium and perinatal conditions': 'PREG',
  'Product issues': 'PROD',
  'Psychiatric disorders': 'PSYCH',
  'Renal and urinary disorders': 'RENAL',
  'Reproductive system and breast disorders': 'REPRO',
  'Respiratory, thoracic and mediastinal disorders': 'RESP',
  'Skin and subcutaneous tissue disorders': 'SKIN',
  'Social circumstances': 'SOCCI',
  'Surgical and medical procedures': 'SURG',
  'Vascular disorders': 'VASC',
};

/**
 * Attaches a modern implementation of window.loadMeddraStatistics
 * with full interactive bar chart drilldown and MedDRA term picking.
 */
export function setupMeddraStatistics(pvData: any): void {
  if (typeof window === 'undefined') return;

  (window as any).focusMeddraTerm = focusMeddraTerm;

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

    interface SocStat {
      socName: string;
      socAbbrev: string;
      count: number;
      terms: Record<string, Set<string>>;
    }

    const socStatsMap: Record<string, SocStat> = {};

    pvData.items.forEach((item: any) => {
      const pt = (item.meddra_pt || '').trim();
      const socName = (item.soc_name || 'General disorders and administration site conditions').trim();
      const socAbbrev = (item.soc_abbrev || '').trim() || MEDDRA_SOC_ABBREV[socName] || socName.slice(0, 5).toUpperCase();

      if (pt) {
        if (!socStatsMap[socName]) {
          socStatsMap[socName] = {
            socName,
            socAbbrev,
            count: 0,
            terms: {},
          };
        }

        const stat = socStatsMap[socName];
        if (!stat.terms[pt]) {
          stat.terms[pt] = new Set<string>();
          stat.count += 1;
        }

        if (Array.isArray(item.occurrences) && item.occurrences.length > 0) {
          item.occurrences.forEach((occ: any) => {
            if (occ.section_title) stat.terms[pt].add(occ.section_title);
          });
        } else if (item.section_name) {
          stat.terms[pt].add(item.section_name);
        }
      }
    });

    const sortedStats = Object.values(socStatsMap).sort((a, b) => b.count - a.count);
    const xTickLabels = sortedStats.map((s) => s.socAbbrev);
    const counts = sortedStats.map((s) => s.count);
    const totalSignals = sortedStats.reduce((sum, s) => sum + s.count, 0);

    const colors = sortedStats.map((_, i) => `hsl(${(i * 360) / Math.max(sortedStats.length, 1)}, 70%, 60%)`);
    const borderColors = sortedStats.map((_, i) => `hsl(${(i * 360) / Math.max(sortedStats.length, 1)}, 70%, 40%)`);

    modalBody.innerHTML = `
      <div style="height: 320px; width: 100%;">
        <canvas id="meddraStatsChart"></canvas>
      </div>
      <div id="meddra-drilldown-container" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: none;">
        <h4 id="drilldown-title" style="margin: 0 0 14px 0; color: #6f42c1; font-size: 1.1rem; font-weight: 700; border-bottom: 2px solid #8b5cf6; padding-bottom: 8px;"></h4>
        <div id="meddra-drilldown-list" style="display: flex; gap: 8px;"></div>
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

    function showDrillDown(socName: string, termsObj: Record<string, Set<string>>, socAbbrev: string) {
      const container = document.getElementById('meddra-drilldown-container');
      const title = document.getElementById('drilldown-title');
      const list = document.getElementById('meddra-drilldown-list');
      if (!container || !title || !list) return;

      container.style.display = 'block';
      const sortedTerms = Object.keys(termsObj).sort();
      const termCount = sortedTerms.length;

      title.textContent = `${socName} [${socAbbrev}] (${termCount} terms — click any term to locate in document)`;

      list.innerHTML = '';
      const isDense = termCount > 5;

      if (isDense) {
        list.style.flexDirection = 'row';
        list.style.flexWrap = 'wrap';
        list.style.gap = '8px';
      } else {
        list.style.flexDirection = 'column';
        list.style.flexWrap = 'nowrap';
        list.style.gap = '4px';
      }

      sortedTerms.forEach((term) => {
        const sections = Array.from(termsObj[term] || []).sort();
        const sectionText = sections.length > 0 ? ` (in: ${sections.join(', ')})` : '';
        const displayTerm = term.charAt(0).toUpperCase() + term.slice(1);

        const itemDiv = document.createElement('div');
        itemDiv.style.fontFamily = 'inherit';
        itemDiv.style.cursor = 'pointer';
        itemDiv.style.transition = 'all 0.15s ease';

        if (isDense) {
          itemDiv.style.background = '#ffffff';
          itemDiv.style.border = '1px solid #cbd5e1';
          itemDiv.style.borderRadius = '20px';
          itemDiv.style.padding = '5px 12px';
          itemDiv.style.fontSize = '0.85rem';
          itemDiv.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
          itemDiv.innerHTML = `<strong style="color: #1e293b;">${displayTerm}</strong><span style="color: #64748b; font-size: 0.75rem; margin-left: 6px;">${sectionText}</span>`;
        } else {
          itemDiv.style.fontSize = '0.9rem';
          itemDiv.style.padding = '8px 12px';
          itemDiv.style.borderRadius = '6px';
          itemDiv.style.border = '1px solid #e2e8f0';
          itemDiv.style.background = '#f8fafc';
          itemDiv.innerHTML = `<strong style="color: #1e293b;">${displayTerm}</strong><span style="color: #64748b; font-size: 0.8rem; margin-left: 8px;">${sectionText}</span>`;
        }

        itemDiv.onmouseover = () => {
          itemDiv.style.borderColor = '#8b5cf6';
          itemDiv.style.backgroundColor = '#f5f3ff';
        };
        itemDiv.onmouseout = () => {
          itemDiv.style.borderColor = isDense ? '#cbd5e1' : '#e2e8f0';
          itemDiv.style.backgroundColor = isDense ? '#ffffff' : '#f8fafc';
        };

        itemDiv.onclick = () => focusMeddraTerm(term);

        list.appendChild(itemDiv);
      });

      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: xTickLabels,
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
            text: `Verified Adverse Events: ${totalSignals} signals across ${sortedStats.length} Organ Systems (Click any bar to drill down)`,
          },
          tooltip: {
            callbacks: {
              title: function (items: any[]) {
                const idx = items[0].dataIndex;
                const stat = sortedStats[idx];
                return stat ? `${stat.socName} (${stat.socAbbrev})` : items[0].label;
              },
              label: function (context: any) {
                return ` Adverse Events: ${context.parsed.y} terms`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
            },
          },
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: sortedStats.length > 12 ? 45 : 0,
              minRotation: 0,
              font: {
                size: 11,
                weight: '700',
              },
              color: '#334155',
            },
          },
        },
        onClick: (e: any) => {
          const points = chartInstance.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
          if (points && points.length > 0) {
            const index = points[0].index;
            const selectedStat = sortedStats[index];
            if (selectedStat) {
              showDrillDown(selectedStat.socName, selectedStat.terms, selectedStat.socAbbrev);
            }
          }
        },
      },
    });
  };
}



