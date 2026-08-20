'use client';

import { useEffect, useMemo, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import LegacyBridge from './LegacyBridge';
import { TOOL_LABEL, useLabel } from './LabelContext';
import { labelRoute, type LaunchContext } from '../../../platform/context';
import { useUser } from '../../../context/UserContext';
import { withApiBase } from '../../../utils/appPaths';
import { ToolIcon } from '../../../platform/icons';
import { useToolboxTools } from '../../../platform/ToolLauncher';
import type { ToolPattern } from '../../../platform/registry';

// The reader body. FAERS, Deep Dive and Examine are sibling routes now, and
// the Header / identity chrome belongs to ../layout.tsx.
import LabelView from './label';

// Shared Types
import { TOCItem } from './types';
import { ProductSpecsTable } from './examine';

function TOCItemComponent({
  item,
  level = 0,
  expandedSections, 
  toggleSection,
  activeSectionId
}: { 
  item: TOCItem; 
  level?: number; 
  expandedSections: Set<string>; 
  toggleSection: (id: string) => void;
  activeSectionId?: string;
}) {
  const isExpanded = expandedSections.has(item.id);
  const isActive = item.id === activeSectionId;
  const hasChildren = item.children && item.children.length > 0;

  let specialClass = '';
  if (item.is_boxed_warning) specialClass = 'toc-boxed-warning';
  else if (item.is_highlights) specialClass = 'toc-highlights';
  else if (item.is_drug_facts) specialClass = 'toc-drug-facts';
  else if (item.is_drug_facts_item) specialClass = 'toc-drug-facts-item';

  return (
    <li className={`toc-item-level-${level} ${specialClass}`}>
      <div className="toc-item-container" style={{ padding: '0' }}>
        {hasChildren ? (
          <button 
            className={`toc-expander ${isExpanded ? 'expanded' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleSection(item.id);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        ) : (
          <div style={{ width: '18px' }}></div>
        )}
        <a 
          href={`#${item.id}`}
          className={`toc-link ${level === 0 ? 'root-link' : 'sub-link'} ${isActive ? 'active-section-link' : ''}`}
          style={isActive ? { backgroundColor: '#e0f2fe', color: '#0284c7', borderLeft: '3px solid #0284c7', paddingLeft: '7px' } : {}}
          onClick={() => {
            if (hasChildren && !isExpanded) {
              toggleSection(item.id);
            }
          }}
        >
          {item.title}
        </a>
      </div>
      {hasChildren && isExpanded && item.children && (
        <ol className="toc-sub-list">
          {item.children.map((child) => (
            <TOCItemComponent 
              key={child.id} 
              item={child} 
              level={level + 1} 
              expandedSections={expandedSections}
              toggleSection={toggleSection}
              activeSectionId={activeSectionId}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function ExportSectionItem({ 
  item, 
  level = 0, 
  selectedSectionsForExport, 
  toggleSectionSelection 
}: { 
  item: any; 
  level?: number; 
  selectedSectionsForExport: Set<string>; 
  toggleSectionSelection: (id: string, includeChildren?: boolean) => void;
}) {
  const isSelected = selectedSectionsForExport.has(item.id);
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div style={{ marginLeft: level * 12, marginBottom: '6px', borderLeft: level > 0 ? '1px solid #f1f5f9' : 'none', paddingLeft: level > 0 ? '8px' : '0' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', transition: 'background 0.2s ease' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
        <input 
          type="checkbox" 
          checked={isSelected} 
          onChange={(e) => toggleSectionSelection(item.id, true)} 
          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#3b82f6' }}
        />
        <span style={{ 
          fontWeight: level === 0 ? 700 : 500, 
          color: isSelected ? '#0f172a' : '#64748b',
          fontSize: level === 0 ? '0.85rem' : '0.8rem',
          textTransform: level === 0 ? 'uppercase' : 'none',
          letterSpacing: level === 0 ? '0.02em' : 'normal'
        }}>
          {item.title}
        </span>
      </label>
      {hasChildren && item.children.map((child: any) => (
        <ExportSectionItem 
          key={child.id} 
          item={child} 
          level={level + 1} 
          selectedSectionsForExport={selectedSectionsForExport} 
          toggleSectionSelection={toggleSectionSelection} 
        />
      ))}
    </div>
  );
}

/*
 * Card treatment derived from a tool's single accent color.
 *
 * These nine cards used to carry eight hand-written gradient strings each,
 * which is why adding a tool meant copying a block rather than adding a line.
 * The registry now supplies one hex and an optional texture, and the rest is
 * computed to the same values those strings held.
 */
const DEFAULT_ACCENT = '#475569';

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toolCardStyle(accent: string = DEFAULT_ACCENT, pattern: ToolPattern = 'dots') {
  const [r, g, b] = rgbOf(accent);
  const a = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
  // Mixed toward white rather than laid over it with alpha, so the wash does
  // not change when the card sits on the dimmed (unfavorited) background.
  const tint = (amount: number) =>
    `rgb(${Math.round(r + (255 - r) * amount)}, ${Math.round(g + (255 - g) * amount)}, ${Math.round(b + (255 - b) * amount)})`;

  const glow = `radial-gradient(circle at 88% 12%, ${a(0.18)} 0%, transparent 55%)`;
  const wash = `linear-gradient(135deg, ${tint(0.93)} 0%, ${tint(0.965)} 100%)`;

  const textures: Record<ToolPattern, { layers: string; size: string }> = {
    dots: {
      layers: `radial-gradient(${a(0.13)} 1.2px, transparent 1.2px)`,
      size: '16px 16px',
    },
    grid: {
      layers: `linear-gradient(to right, ${a(0.06)} 1px, transparent 1px), linear-gradient(to bottom, ${a(0.06)} 1px, transparent 1px)`,
      size: '20px 20px, 20px 20px',
    },
    stripes: {
      layers: `repeating-linear-gradient(45deg, ${a(0.05)} 0px, ${a(0.05)} 2px, transparent 2px, transparent 10px)`,
      size: '100% 100%',
    },
  };
  const texture = textures[pattern] ?? textures.dots;

  return {
    cardBg: `${glow}, ${texture.layers}, ${wash}`,
    bgSize: `100% 100%, ${texture.size}, 100% 100%`,
    cardBorder: a(0.32),
    cardShadow: `0 4px 16px ${a(0.1)}`,
    badgeBg: `linear-gradient(135deg, ${a(0.22)} 0%, ${a(0.35)} 100%)`,
    badgeColor: accent,
    badgeBorder: `1px solid ${a(0.4)}`,
    accentColor: accent,
  };
}

function ToolboxPanel({ setId, data }: { setId: string; data: any }) {
  const brandName = data?.brand_name || data?.drug_name || 'this product';
  const applicationNumber = String(data?.application_number || data?.metadata?.application_number || '').trim();
  // A label can carry several application numbers, separated by commas or
  // semicolons. The application profile follows one identifier at a time.
  const historyApplicationNumber = applicationNumber.split(/[;,]/, 1)[0].trim();
  const hasApplicationNumber = Boolean(historyApplicationNumber && !/^n\/?a$/i.test(historyApplicationNumber));
  const [favoriteToolIds, setFavoriteToolIds] = useState<string[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('askfdalabel_favorite_tools');
      if (stored) {
        setFavoriteToolIds(JSON.parse(stored));
      } else {
        setFavoriteToolIds(['label-faers', 'label-tox']);
      }
    } catch (e) {
      console.error('Failed to load favorite tools:', e);
    }
  }, []);

  const toggleFavoriteTool = (toolId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFavoriteToolIds((prev) => {
      const next = prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId];
      try {
        localStorage.setItem('askfdalabel_favorite_tools', JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save favorite tools:', err);
      }
      return next;
    });
  };

  /*
   * The toolbox renders the platform registry, not a list of its own. A tool
   * added to platform/registry.ts shows up here automatically, and one the
   * account is not permitted to use is filtered out by the same resolver the
   * navigation and the tool directory use.
   */
  const launchContext = useMemo<LaunchContext>(
    () => ({
      setIds: [setId],
      applicationNumber: hasApplicationNumber ? historyApplicationNumber : undefined,
    }),
    [setId, hasApplicationNumber, historyApplicationNumber],
  );

  const registryTools = useToolboxTools(launchContext);

  const toolsList = useMemo(
    () =>
      registryTools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        blurb: tool.blurbFor?.(launchContext) ?? tool.blurb,
        iconId: tool.iconId,
        href: tool.href(launchContext),
        ...toolCardStyle(tool.accent, tool.pattern),
      })),
    [registryTools, launchContext],
  );

  const sortedTools = [...toolsList].sort((a, b) => {
    const aFav = favoriteToolIds.includes(a.id);
    const bFav = favoriteToolIds.includes(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return 0;
  });

  return (
    <div className="toolbox-panel" style={{ padding: '16px 0' }}>
      <div style={{ marginBottom: '24px', background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
          Product Toolbox
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 10px 0', lineHeight: 1.5 }}>
          Launch analytical tools for <strong>{brandName}</strong>. Click any tool button to open in a new window. Star tools to keep them pinned at the top of your toolbox.
        </p>
        <p style={{ color: '#475569', fontSize: '0.84rem', margin: 0, lineHeight: 1.5, background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>🤝</span>
          <span>We are continuously collecting and building more tools for drug labeling analysis and warmly welcome research collaborations. To discuss new analytical tools or collaborative projects, please contact <a href="mailto:askfdalabel@fda.hhs.gov" style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'underline' }}>askfdalabel@fda.hhs.gov</a>.</span>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
        {sortedTools.map((t) => {
          const isFav = favoriteToolIds.includes(t.id);
          const isHovered = hoveredId === t.id;
          const isFeatured = isFav || isHovered;

          return (
            <a
              key={t.id}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="toolbox-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '22px',
                borderRadius: '16px',
                background: isFeatured ? t.cardBg : '#f8fafc',
                backgroundSize: isFeatured ? t.bgSize : 'auto',
                border: isFav 
                  ? `2.5px solid ${t.accentColor}` 
                  : isHovered 
                    ? `1.5px solid ${t.cardBorder}` 
                    : '1.5px solid #e2e8f0',
                boxShadow: isFav 
                  ? `0 6px 20px ${t.accentColor}35` 
                  : isHovered 
                    ? t.cardShadow 
                    : 'none',
                opacity: isFeatured ? 1 : 0.55,
                filter: isFeatured ? 'none' : 'grayscale(85%)',
                backdropFilter: isFeatured ? 'blur(8px)' : 'none',
                textDecoration: 'none',
                position: 'relative',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      width: '42px', 
                      height: '42px', 
                      borderRadius: '12px', 
                      background: t.badgeBg, 
                      color: t.badgeColor,
                      border: t.badgeBorder,
                      boxShadow: `0 2px 8px ${t.badgeColor}25`,
                      backdropFilter: 'blur(4px)'
                    }}>
                      <ToolIcon id={t.iconId as any} size={22} />
                    </span>
                    <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>
                      {t.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => toggleFavoriteTool(t.id, e)}
                    title={isFav ? 'Unstar tool' : 'Star tool'}
                    style={{
                      background: isFav ? '#fef9c3' : isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.72)',
                      border: isFav ? '1px solid #facc15' : isHovered ? `1px solid ${t.accentColor}` : '1px solid #cbd5e1',
                      cursor: 'pointer',
                      fontSize: '1.4rem',
                      color: isFav ? '#a16207' : isHovered ? t.accentColor : '#64748b',
                      padding: '3px 7px',
                      borderRadius: '999px',
                      lineHeight: 1,
                      boxShadow: isHovered && !isFav ? `0 2px 8px ${t.accentColor}33` : 'none',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {isFav ? '★' : '☆'}
                  </button>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 16px 0', lineHeight: 1.5, fontWeight: 500 }}>
                  {t.blurb}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 800, color: t.accentColor }}>
                Open Tool <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function LabelContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isToolbox = searchParams?.get('view') === 'toolbox';
  const { session, loading: userLoading, openAuthModal } = useUser();

  // Supplied by the workspace shell; see ./LabelContext.
  const { setId, data, loading, error } = useLabel();

  const activeTab = TOOL_LABEL;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    const legacyTabRoutes: Record<string, string> = {
      'faers-view': 'faers',
      'examine-view': 'examine',
      'deep-dive-view': 'deepdive',
      'tox-view': 'tox',
    };
    const target = tabParam ? legacyTabRoutes[tabParam] : undefined;
    if (target) router.replace(labelRoute(setId, target));
  }, [router, setId]);

  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedSectionsForExport, setSelectedSectionsForExport] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<'html' | 'xml' | 'text'>('html');
  const [ndcModalOpen, setNdcModalOpen] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [productSpecsModalOpen, setProductSpecsModalOpen] = useState(false);

  // New Favorite/Project states
  const [isFavoriteAny, setIsFavoriteAny] = useState(false);
  const [labelProjectIds, setLabelProjectIds] = useState<number[]>([]);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [isTogglingProject, setIsTogglingProject] = useState<number | null>(null);

  /*
   * Legacy script loading is handled by <LegacyBridge> in the render below.
   * It replaces a 100ms setInterval that polled for five window.init* globals
   * and gave up after 50 attempts, plus the manual reset of the window caches
   * those scripts leak between labels.
   */
  const handleLegacyReady = useCallback(() => {
    const win = window as any;
    if (win.loadMeddraScan) {
      win.loadMeddraScan(setId);
    }
  }, [setId]);

  /*
   * The reader is the only view here now, so the branches that switched
   * behaviour per tab are gone. FAERS owns its own data load in its route.
   */
  useEffect(() => {
    const win = window as any;
    if (win.initTableExtractor) {
      // Give the label body a tick to render before wiring table extraction.
      setTimeout(() => win.initTableExtractor(), 100);
    }
  }, []);


  useEffect(() => {
    if (data) {
      const brand = data.brand_name || data.drug_name;
      const generic = data.generic_name;
      const effective = data.effective_time;
      
      const titleParts = [brand, generic, effective]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
      
      document.title = titleParts.join(' - ');
    }
  }, [data]);

  // Favorite Logic
  const checkFavoriteStatus = useCallback(async () => {
    if (!session?.is_authenticated) return;
    try {
      const res = await fetch(withApiBase(`/api/dashboard/check_favorite/${setId}`));
      const json = await res.json();
      setIsFavoriteAny(json.is_favorite);
      setLabelProjectIds(json.project_ids || []);
    } catch (err) {
      console.error("Error checking favorite status:", err);
    }
  }, [setId, session?.is_authenticated]);

  const fetchProjects = useCallback(async () => {
    if (!session?.is_authenticated) return;
    try {
      const res = await fetch(withApiBase('/api/dashboard/projects'));
      const json = await res.json();
      setProjects(json.projects || []);
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  }, [session?.is_authenticated]);

  useEffect(() => {
    checkFavoriteStatus();
  }, [checkFavoriteStatus]);

  const handleFavoriteClick = () => {
    if (!session?.is_authenticated) return;
    fetchProjects();
    setProjectModalOpen(true);
  };

  const toggleProjectFavorite = async (projectId: number) => {
    setIsTogglingProject(projectId);
    try {
      const res = await fetch(withApiBase('/api/dashboard/toggle_favorite'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          set_id: setId,
          project_id: projectId
        })
      });
      const json = await res.json();
      if (json.success) {
        // Update local state
        setLabelProjectIds(prev => {
          if (prev.includes(projectId)) {
            return prev.filter(id => id !== projectId);
          } else {
            return [...prev, projectId];
          }
        });
        // Check if still in any project
        const stillInAny = labelProjectIds.filter(id => id !== projectId).length > 0 || !labelProjectIds.includes(projectId);
        // Wait, the logic above is slightly flawed for immediate update. 
        // Let's just re-fetch the absolute truth.
        checkFavoriteStatus();
      }
    } catch (err) {
      console.error("Error toggling project favorite:", err);
    } finally {
      setIsTogglingProject(null);
    }
  };

  const toggleSectionSelection = (id: string, includeChildren: boolean = true) => {
    setSelectedSectionsForExport((prev) => {
      const next = new Set(prev);
      const isCurrentlySelected = next.has(id);

      const findAndToggleRecursive = (items: any[], targetId: string, forceState: boolean) => {
        for (const item of items) {
          if (item.id === targetId) {
             if (forceState) next.add(item.id); else next.delete(item.id);
             if (includeChildren && item.children) {
                const toggleChildren = (childs: any[]) => {
                  childs.forEach(c => {
                    if (forceState) next.add(c.id); else next.delete(c.id);
                    if (c.children) toggleChildren(c.children);
                  });
                };
                toggleChildren(item.children);
             }
             return true;
          }
          if (item.children && findAndToggleRecursive(item.children, targetId, forceState)) return true;
        }
        return false;
      };

      const sectionsTree = [
        ...(data?.table_of_contents || [])
      ];

      findAndToggleRecursive(sectionsTree, id, !isCurrentlySelected);
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedSectionsForExport.size === 0) {
      alert("Please select at least one section for export.");
      return;
    }

    try {
      const response = await fetch('/api/dashboard/export_sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          set_id: data?.set_id,
          section_ids: Array.from(selectedSectionsForExport),
          format: exportFormat
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Failed to generate export file.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cleanTitle = (data?.brand_name || data?.drug_name || 'label').replace(/[^a-z0-9]/gi, '_');
      a.download = `${cleanTitle}_sections.${exportFormat === 'text' ? 'txt' : exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setExportModalOpen(false);
    } catch (err: any) {
      alert(`Export Error: ${err.message}`);
    }
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!exportModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportModalOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [exportModalOpen]);

  useEffect(() => {
    if (!ndcModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNdcModalOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ndcModalOpen]);


  /* Label data comes from the shell (../layout.tsx) via LabelContext, so the
   * reader and every tool route share one fetch. */

  const ndcRaw = (data?.ndc || '').trim();
  const ndcTooLong = ndcRaw.length > 40;

  const ndcList = (() => {
    if (!ndcRaw) return [];
    return ndcRaw
      .split(/[\n,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  })();

  const tabs = [
    { id: 'label-view', label: 'Label' },
    // { id: 'deep-dive-view', label: 'Deep Dive' },
    { id: 'faers-view', label: 'FAERS' },
    { id: 'tox-view', label: 'DrugTox Agents', isAI: true },
    { id: 'examine-view', label: 'Examine', isAI: true },
  ];

  if (loading) {
    return (
      <div className="hp-main-layout">
        <div className="hp-container">
          <div className="loader" style={{ margin: '50px auto' }}></div>
          <p style={{ textAlign: 'center' }}>Loading label...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hp-main-layout">
        <div className="hp-container">
          <p style={{ color: 'red', textAlign: 'center' }}>Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (isToolbox) {
    return <ToolboxPanel setId={setId} data={data} />;
  }

  const handleDownloadMeddraProfile = async () => {
    try {
      const response = await fetch(`/api/dashboard/meddra/profile/${setId}`);
      if (!response.ok) throw new Error("Failed to fetch MedDRA profile");
      const dataJson = await response.json();
      const blob = new Blob([JSON.stringify(dataJson, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MedDRA_Profile_${dataJson.metadata?.brand_name || setId}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("MedDRA Profile Export Error:", err);
      alert("Failed to export MedDRA profile.");
    }
  };

  return (
    <>
      {/*
        The page-level chrome — Header, breadcrumb, and the drug title/badges —
        now lives in ../layout.tsx, which wraps every tool route. What remains
        here is reader-specific: the label actions, the metadata grid, the
        table of contents, and the label body.
      */}

            <div className="function-content-area" style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                minHeight: 0,
                background: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #cbd5e1',
                boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)',
                padding: '16px',
                marginBottom: '20px'
            }}>
                <div id="top-annotations-container" className="top-annotations-container"></div>
                {/*
                  FAERS, Deep Dive and Examine are their own routes now. They
                  used to be mounted here alongside the reader and hidden with
                  an activeTab check, so every tool's scripts and effects ran on
                  every view.
                */}
                <LabelView data={data} activeTab={activeTab} tocCollapsed={tocCollapsed} setTocCollapsed={setTocCollapsed} expandedSections={expandedSections} toggleSection={toggleSection} TOCItemComponent={TOCItemComponent} />

            </div>

            <div className="function-tabs-bar" style={{ width: '100%', padding: '0 0 20px 0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
                <div className="label-toolbar">
                  {/* Product Specifications — pop window to the left of AI Chat */}
                  <button
                    id="product-specs-btn"
                    className="label-tool-btn label-tool-specs"
                    onClick={() => setProductSpecsModalOpen(true)}
                    title="View Product Specifications table for this label"
                    style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', color: '#1d4ed8', border: '1px solid #93c5fd', fontWeight: 800 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                    <span>Product Specifications</span>
                    <svg className="pop-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', verticalAlign: 'middle' }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </button>

                  {/* Chat — always available */}
                  <button
                    id="chat-bubble"
                    className="label-tool-btn label-tool-chat"
                    title="AI Assistant — ask questions about this label"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    <span>AI Chat</span>
                    <svg className="pop-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', verticalAlign: 'middle' }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </button>

                  {/* MedDRA Stats — label tab only */}
                  {activeTab === 'label-view' && (
                    <button
                      id="meddra-stats-btn"
                      className="label-tool-btn label-tool-meddra"
                      title="Adverse Event term statistics for this label"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                      Adverse Events
                      <svg className="pop-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', verticalAlign: 'middle' }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </button>
                  )}

                  {/* Notes — label tab + authenticated only */}
                  {activeTab === 'label-view' && session?.is_authenticated && (
                    <button
                      id="user-notes-btn"
                      className="label-tool-btn label-tool-notes"
                      title="My saved annotation notes"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      Notes
                      <svg className="pop-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', verticalAlign: 'middle' }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </button>
                  )}

                  {/* Export — authenticated only */}
                  {session?.is_authenticated && (
                    <button 
                      id="export-pdf-btn"
                      onClick={() => {
                        const allIds = new Set<string>();
                        const addIdsRecursive = (items: any[]) => {
                          items.forEach(i => {
                            allIds.add(i.id);
                            if (i.children && i.children.length > 0) {
                              addIdsRecursive(i.children);
                            }
                          });
                        };
                        if (data.table_of_contents) {
                          addIdsRecursive(data.table_of_contents);
                        }
                        setSelectedSectionsForExport(allIds);
                        setExportModalOpen(true);
                      }}
                      title="Export Selected Sections"
                      className="label-tool-btn label-tool-export"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                      <span>EXPORT</span>
                      <svg className="pop-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', verticalAlign: 'middle' }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </button>
                  )}

                  {/* Add to Projects button (Fav) */}
                  <button 
                    id="favorite-btn" 
                    className={`label-tool-btn label-tool-fav ${isFavoriteAny ? 'active' : ''}`}
                    onClick={handleFavoriteClick}
                    disabled={!session?.is_authenticated}
                    title={session?.is_authenticated ? "Add to Projects" : "Login is required to add to projects"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span>Add to Projects</span>
                    <svg className="pop-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', verticalAlign: 'middle' }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </button>
                </div>
            </div>

      {/* Product Specifications Modal Dialog */}
      {productSpecsModalOpen && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setProductSpecsModalOpen(false)}
        >
          <div
            style={{ background: '#ffffff', borderRadius: '16px', width: '90%', maxWidth: '1000px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #cbd5e1', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>📦</span> Product Specifications
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Structured product registration &amp; packaging specifications extracted from the SPL XML document.
                </p>
              </div>
              <button
                onClick={() => setProductSpecsModalOpen(false)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontWeight: 800, color: '#475569', fontSize: '0.85rem' }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <ProductSpecsTable productData={data?.product_data || []} />
            </div>
          </div>
        </div>
      )}

      {/* Hidden Data for JS */}
      <div id="xml-content" style={{ display: 'none' }}>{data.label_xml_raw}</div>

      {/*
        Ordered, promise-based loading of the legacy bundles. The per-label
        globals below were previously written by an inline <Script>, which
        raced the bundles that read them; LegacyBridge assigns them before the
        first script executes.

        Note the absent 'initToxAgents': no bundle defines it, since DrugTox
        lives on its own page. The previous polling loop required it as part of
        its readiness check, so that check could never pass — meaning none of
        these initializers, nor the MedDRA scan, ever actually ran.
      */}
      <LegacyBridge
        resetKey={setId}
        scripts={['chart', 'marked', 'utils', 'ui', 'favorites', 'session', 'chat', 'annotations', 'faers']}
        globals={{
          currentSetId: data.set_id,
          currentDrugName: data.faers_drug_name,
          currentGenericName: data.generic_name,
          currentManufacturer: data.manufacturer_name,
          currentEffectiveTime: data.effective_time,
          toxSummary: data.tox_summary,
          currentUserId: data.user_id ?? null,
          savedAnnotations: data.saved_annotations,
        }}
        init={['initUI', 'initFaers', 'initChat', 'initAnnotations']}
        onReady={handleLegacyReady}
      />


      {/* Modals placeholders */}
      <div id="user-notes-modal" className="custom-modal" style={{ display: 'none' }}>
        <div className="custom-modal-content">
          <div className="custom-modal-header"><h3>My Notes</h3><span className="close-modal" id="close-user-notes">&times;</span></div>
          <div className="custom-modal-body" id="user-notes-modal-body"><div id="notes-list-container" className="notes-summary-list"></div></div>
        </div>
      </div>

      <div id="meddra-stats-modal" className="custom-modal" style={{ display: 'none' }}>
        <div className="custom-modal-content">
          <div className="custom-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Statistics of Adverse Events by MedDRA</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button 
                className="button meddra-profile-dl-btn"
                onClick={handleDownloadMeddraProfile}
                title="Export MedDRA Profile JSON"
                style={{ 
                  background: '#6366f1', 
                  color: '#ffffff', 
                  border: 'none', 
                  padding: '6px 14px', 
                  borderRadius: '8px', 
                  fontSize: '0.8rem', 
                  fontWeight: 700, 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(99, 102, 241, 0.25)',
                  transition: 'all 0.2s ease'
                }}
              >
                <span style={{ fontSize: '1rem' }}>{"\u2b21"}</span> Download MedDRA Profile
              </button>
              <span className="close-modal" id="close-meddra-stats" style={{ cursor: 'pointer', fontSize: '1.5rem' }}>&times;</span>
            </div>
          </div>
          <div className="custom-modal-body" id="meddra-stats-body"></div>
        </div>
      </div>

      <div id="table-extract-modal" className="custom-modal" style={{ display: 'none' }}>
        <div className="custom-modal-content" style={{ maxWidth: '95%', height: '90vh' }}>
          <div className="custom-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 id="table-extract-title" style={{ margin: 0 }}>Table Data</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button id="copy-selection-btn" className="button" style={{ display: 'none', padding: '6px 12px', fontSize: '0.85rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', alignItems: 'center', gap: '5px' }}><span>{"\uD83D\uDCCB"}</span> Copy Selection</button>
                <span className="close-modal" id="close-table-extract" style={{ cursor: 'pointer', fontSize: '1.5rem' }}>&times;</span>
            </div>
          </div>
          <div className="custom-modal-body" id="table-extract-container"></div>
        </div>
      </div>

      <div id="ai-prefs-modal" className="custom-modal" style={{ display: 'none' }}>
         <div className="custom-modal-content" style={{ maxWidth: '600px', height: 'auto' }}>
            <div className="custom-modal-header"><h3>AI Configuration</h3><span className="close-modal" id="close-ai-prefs">&times;</span></div>
            <div className="custom-modal-body"><form id="ai-prefs-form"></form></div>
         </div>
      </div>

      <div id="chatbox" className="chatbox" style={{ display: 'none', zIndex: 2500 }}>
        <div className="chat-header" id="chat-header">
            <h3>AI Assistant</h3>
            <div className="chat-header-buttons" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button id="chat-reset" className="chat-reset" title="Reset Chat" style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.25rem', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#8634;</button>
                <button id="close-chat" className="close-chat" style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.25rem', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
            </div>
        </div>
        <div id="chat-messages" className="chat-messages"></div>
        <div className="chat-input-form">
            <input type="text" id="chat-input" placeholder="Type a message..." />
            <button id="chat-send">Send</button>
        </div>
      </div>

      {ndcModalOpen && (
        <div onClick={() => setNdcModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 92vw)', maxHeight: 'min(520px, 80vh)', background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div><div style={{ fontWeight: 800, color: '#0f172a' }}>NDC Codes</div><div style={{ fontSize: '0.8rem', color: '#64748b' }}>ESC or outside click to close</div></div>
              <button onClick={() => setNdcModalOpen(false)} style={{ width: '34px', height: '34px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: '18px', color: '#334155' }}>×</button>
            </div>
            <div style={{ padding: '16px', overflow: 'auto' }}>
              {ndcList.length > 0 ? (
                <div className="ndc-container" style={{ maxWidth: '100%', padding: '8px' }}>
                  {ndcList.map((code, i) => (
                    <span key={i} className="ndc-badge" style={{ padding: '6px 12px', fontSize: '0.9rem' }}>{code}</span>
                  ))}
                </div>
              ) : <div style={{ color: '#64748b' }}>No NDC codes available.</div>}
            </div>
          </div>
        </div>
      )}

      {companyModalOpen && (
        <div onClick={() => setCompanyModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(800px, 95vw)', maxHeight: 'min(600px, 90vh)', background: 'white', borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>Organization Details</h3><p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Companies involved in manufacture/distribution</p></div>
              <button onClick={() => setCompanyModalOpen(false)} style={{ background: 'white', border: '1px solid #e2e8f0', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data?.companies?.map((comp, idx) => (
                <div key={idx} style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px 20px', background: '#f8fafc' }}>
                  {/* Role badge + Name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#475569', background: '#e2e8f0', padding: '3px 10px', borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                      {comp.role}
                    </span>
                    <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>{comp.name}</span>
                  </div>
                  {/* Details row */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.8rem', color: '#475569' }}>
                    {comp.address && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', flex: '1 1 200px' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        <span>{comp.address}</span>
                      </div>
                    )}
                    {comp.duns && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DUNS</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#334155' }}>{comp.duns}</span>
                      </div>
                    )}
                    {comp.safety_phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.62 4.38 2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.99-.99a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                        <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#0284c7', textTransform: 'uppercase' }}>Safety</span>
                        <span style={{ fontWeight: 700, color: '#0284c7' }}>{comp.safety_phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '20px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setCompanyModalOpen(false)} style={{ padding: '10px 24px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 800 }}>CLOSE</button>
            </div>
          </div>
        </div>
      )}
      {exportModalOpen && (
        <div onClick={() => setExportModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(600px, 95vw)', maxHeight: 'min(700px, 90vh)', background: 'white', borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>Export Sections</h3><p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Select label sections and preferred format</p></div>
              <button onClick={() => setExportModalOpen(false)} style={{ background: 'white', border: '1px solid #e2e8f0', width: '32px', height: '32px', borderRadius: '8px' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8' }}>Available Sections ({selectedSectionsForExport.size})</span>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => {
                    const allIds = new Set<string>();
                    const addIdsRecursive = (items: any[]) => { items.forEach(i => { allIds.add(i.id); if (i.children) addIdsRecursive(i.children); }); };
                    if (data.table_of_contents) addIdsRecursive(data.table_of_contents);
                    setSelectedSectionsForExport(allIds);
                  }} style={{ color: '#3b82f6', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 800, fontSize: '0.7rem' }}>SELECT ALL</button>
                  <button onClick={() => setSelectedSectionsForExport(new Set())} style={{ color: '#64748b', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 800, fontSize: '0.7rem' }}>CLEAR</button>
                </div>
              </div>
              <div style={{ background: '#f9fafb', border: '1px solid #f1f5f9', borderRadius: '12px', padding: '16px' }}>
                {data?.table_of_contents?.map(item => <ExportSectionItem key={item.id} item={item} selectedSectionsForExport={selectedSectionsForExport} toggleSectionSelection={toggleSectionSelection} />)}
              </div>
            </div>
            <div style={{ padding: '20px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>FORMAT:</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['html', 'xml', 'text'] as const).map(fmt => (
                    <button key={fmt} onClick={() => setExportFormat(fmt)} style={{ padding: '6px 16px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700, backgroundColor: exportFormat === fmt ? '#3b82f6' : 'white', color: exportFormat === fmt ? 'white' : '#64748b', border: '1px solid #e2e8f0' }}>{fmt}</button>
                  ))}
                </div>
              </div>
              <button onClick={handleExport} style={{ width: '100%', backgroundColor: '#0f172a', color: 'white', border: 'none', padding: '12px', borderRadius: '12px', fontWeight: 800, cursor: 'pointer' }}>GENERATE EXPORT FILE</button>
            </div>
          </div>
        </div>
      )}

      {projectModalOpen && (
        <div onClick={() => setProjectModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(450px, 95vw)', maxHeight: 'min(500px, 80vh)', background: 'white', borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Add to Projects</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>Select projects for this label</p>
              </div>
              <button onClick={() => setProjectModalOpen(false)} style={{ background: 'white', border: '1px solid #e2e8f0', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {projects.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>No projects found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {projects.map((p) => {
                    const isInProject = labelProjectIds.includes(p.id);
                    const isToggling = isTogglingProject === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggleProjectFavorite(p.id)}
                        disabled={isToggling}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          borderRadius: '12px',
                          border: '1px solid',
                          borderColor: isInProject ? '#bfdbfe' : '#e2e8f0',
                          backgroundColor: isInProject ? '#eff6ff' : 'white',
                          cursor: isToggling ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease',
                          textAlign: 'left'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 700, color: isInProject ? '#1e40af' : '#334155', fontSize: '0.9rem' }}>{p.title}</span>
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{p.role === 'owner' ? 'Your Project' : 'Shared with you'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isToggling ? (
                            <div className="loader" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
                          ) : isInProject ? (
                            <span style={{ color: '#2563eb', fontWeight: 900 }}>✓</span>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>+</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'center' }}>
               <Link href="/dashboard" target="_blank" style={{ fontSize: '0.8rem', color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}>Manage Projects in Dashboard ↗</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function LabelPage() {
  return (
    <Suspense fallback={<div>Loading Label Page...</div>}>
      <LabelContent />
    </Suspense>
  );
}
