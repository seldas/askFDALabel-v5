'use client';

import { useEffect, useState, useRef, useMemo, memo, useCallback } from 'react';
import { Section, LabelData, TOCItem } from './types';
import { useLabel } from './LabelContext';
import Link from 'next/link';
import {
  scanAndHighlightMeddraTerms,
  applySocHighlight,
  clearSocHighlight,
  scrollToTermElement,
  setupMeddraStatistics,
  SocCatalog
} from './meddraHighlight';

const SectionComponent = memo(function SectionComponent({ section }: { section: Section }) {
  return (
    <div 
      className={`Section ${section.is_boxed_warning ? 'black-boxed-warning' : ''}`}
      id={section.id}
      data-section-number={section.numeric_id}
      style={{ marginBottom: '30px' }}
    >
      {section.title && <h2 style={{ 
        fontSize: '1.5rem', 
        color: 'var(--afl-n-800)', 
        borderBottom: '2px solid var(--afl-n-100)', 
        paddingBottom: '12px',
        marginBottom: '20px',
        fontWeight: 700
      }}>{section.title}</h2>}
      {section.content && <div className="spl-content" dangerouslySetInnerHTML={{ __html: section.content }} />}
      {section.children && section.children.map((child, idx) => (
        <SectionComponent key={idx} section={child} />
      ))}
    </div>
  );
});

const HighlightsComponent = memo(function HighlightsComponent({
  highlights,
  onGoToSection
}: {
  highlights: any[];
  onGoToSection?: (title: string) => void;
}) {
  return (
    <div id="highlights-content">
        <h2 style={{ 
            fontSize: '1.25rem', 
            color: 'var(--afl-n-900)',
            marginBottom: '20px',
            fontWeight: 900,
            textTransform: 'uppercase',
            borderBottom: '2px solid var(--afl-n-900)',
            paddingBottom: '8px',
            letterSpacing: '0.05em' 
        }}>
            Highlights of Prescribing Information
        </h2>
        {highlights.map((h, i) => (
            <div key={i} className="highlight-item" style={{ marginBottom: '18px', paddingBottom: '18px', borderBottom: '1px solid var(--afl-n-200)' }}>
                <div className="highlight-item-header">
                    {h.source_section_title !== 'Untitled Section' && (
                        <span className="source-title" style={{ fontWeight: 700, color: 'var(--afl-n-700)', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            {h.source_section_title}
                        </span>
                    )}
                    {onGoToSection && h.source_section_title && h.source_section_title !== 'Untitled Section' && (
                        <button
                            className="highlight-goto-link"
                            onClick={() => onGoToSection(h.source_section_title)}
                            title={`Go to ${h.source_section_title}`}
                        >
                            ↗ Go to section
                        </button>
                    )}
                </div>
                <div className="highlight-body spl-content" style={{ color: 'var(--afl-n-800)', lineHeight: '1.7', fontSize: '0.9rem' }} dangerouslySetInnerHTML={{ __html: h.content_html }} />
            </div>
        ))}
    </div>
  );
});

export default function LabelView({ 
  data, 
  activeTab,
  tocCollapsed,
  setTocCollapsed,
  expandedSections,
  toggleSection,
  TOCItemComponent,
  pvProfileData
}: { 
  data: LabelData; 
  activeTab: string;
  tocCollapsed: boolean;
  setTocCollapsed: (collapsed: boolean) => void;
  expandedSections: Set<string>;
  toggleSection: (id: string) => void;
  TOCItemComponent: any;
  pvProfileData?: any;
}) {
  const { headerCollapsed, setHeaderCollapsed } = useLabel();
  const [currentIndex, setCurrentIndex] = useState(0); // 0-based index of sections
  const [navTab, setNavTab] = useState<'toc' | 'soc'>('toc');
  const [activeSoc, setActiveSoc] = useState<string | null>(null);
  const [socCatalog, setSocCatalog] = useState<SocCatalog>({});
  const [activeTermName, setActiveTermName] = useState<string | null>(null);
  const [activeTermOccurIndex, setActiveTermOccurIndex] = useState<number>(0);
  const labelViewRef = useRef<HTMLDivElement>(null);
  const disableScrollObserver = useRef(false);

  useEffect(() => {
    const el = labelViewRef.current;
    if (!el) return;

    const onScroll = () => {
      if (el.scrollTop > 50 && !headerCollapsed) {
        setHeaderCollapsed(true);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [headerCollapsed, setHeaderCollapsed]);

  // Handle wheel events on outer blank spaces / margins to scroll the content panel and fold header
  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      // If scrolling downward anywhere, minimize header
      if (e.deltaY > 0 && !headerCollapsed) {
        setHeaderCollapsed(true);
      }

      // If wheel event happened outside of the main label viewport and TOC panel (e.g. whitespace, header, margins)
      const target = e.target as HTMLElement | null;
      const isInsideTOC = target?.closest('#toc-panel');
      const isInsideViewport = target?.closest('.label-viewport');
      const isInsideModal = target?.closest('.modal') || target?.closest('[role="dialog"]') || target?.closest('#product-specs-btn');

      if (!isInsideViewport && !isInsideTOC && !isInsideModal) {
        const el = labelViewRef.current;
        if (el) {
          el.scrollTop += e.deltaY;
        }
      }
    };

    window.addEventListener('wheel', handleGlobalWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleGlobalWheel);
  }, [headerCollapsed, setHeaderCollapsed]);

  // Flatten top-level sections into a single list for sequential navigation
  const sections = useMemo(() => [
    ...(data.highlights && data.highlights.length > 0 ? [{ id: 'highlights-section', is_highlights: true, title: 'Highlights' }] : []),
    ...(data.sections || [])
  ], [data.highlights, data.sections]);

  // Progress bar: percentage of sections scrolled through (must come after sections)
  const progressPercent = sections.length > 0
    ? Math.round(((currentIndex + 1) / sections.length) * 100)
    : 0;

  // Helper to find which top-level section contains a specific ID (for TOC links)
  const findSectionIdxForId = (id: string) => {
    // 1. Exact match
    const idx = sections.findIndex(s => s.id === id);
    if (idx !== -1) return idx;

    // 2. Nested match
    const checkNested = (secs: any[], targetId: string): boolean => {
      return secs.some(s => s.id === targetId || (s.children && checkNested(s.children, targetId)));
    };

    return sections.findIndex(s => {
      if ('children' in s && s.children && checkNested(s.children, id)) return true;
      return false;
    });
  };

  // Navigate from Highlights card to the full section by title
  const goToSectionByTitle = useCallback((title: string) => {
    const idx = sections.findIndex((s: any) => {
      const t = (s.title || '').toLowerCase();
      const q = title.toLowerCase();
      return t === q || t.includes(q) || q.includes(t);
    });
    if (idx !== -1) scrollToSection(idx);
  }, [sections]);

  // Scroll to a specific section index
  const scrollToSection = (index: number, targetId?: string) => {
    if (!labelViewRef.current || index < 0 || index >= sections.length) return;
    
    disableScrollObserver.current = true;
    setCurrentIndex(index);

    const targetSection = sections[index];
    // Find the element in the DOM
    // We use the ID if available, otherwise rely on order (which should match)
    const container = labelViewRef.current;
    
    // Prefer finding by ID if possible for robustness
    let el = targetId ? container.querySelector(`[id="${targetId}"]`) : null;
    
    if (!el && targetSection.id) {
        el = container.querySelector(`[id="${targetSection.id}"]`);
    }
    
    // Fallback to data-index if ID lookup fails
    if (!el) {
        el = container.querySelector(`[data-section-index="${index}"]`);
    }

    if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        
        // Update URL hash
        const hashId = targetId || targetSection.id;
        if (hashId && window.location.hash !== `#${hashId}`) {
            window.history.pushState(null, '', `#${hashId}`);
        }
    }

    // Re-enable observer after a delay
    setTimeout(() => {
        disableScrollObserver.current = false;
    }, 100);
  };

  const jumpSection = (direction: 'next' | 'prev') => {
    const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex >= 0 && newIndex < sections.length) {
        scrollToSection(newIndex);
    }
  };

  // Sync TOC clicks (hash changes)
  useEffect(() => {
    const handleHashChange = (e?: HashChangeEvent) => {
      if (e) e.preventDefault();
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        const idx = findSectionIdxForId(hash);
        if (idx !== -1) {
          scrollToSection(idx, hash);
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    setTimeout(() => handleHashChange(), 100); // Initial check
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [sections]);

  // Track active section on scroll
  useEffect(() => {
    const intersectingIndices = new Set<number>();

    const observer = new IntersectionObserver(
      (entries) => {
        if (disableScrollObserver.current) return;
        
        entries.forEach(entry => {
            const index = Number(entry.target.getAttribute('data-section-index'));
            if (!isNaN(index)) {
                if (entry.isIntersecting) {
                    intersectingIndices.add(index);
                } else {
                    intersectingIndices.delete(index);
                }
            }
        });

        if (intersectingIndices.size > 0) {
            // Pick the highest index among those currently intersecting the active zone.
            // This ensures that as you scroll down, the most recently entered section becomes active.
            const maxIndex = Math.max(...Array.from(intersectingIndices));
            setCurrentIndex(maxIndex);
        }
      },
      {
        root: labelViewRef.current,
        // Active zone: Trigger when sections are in the top portion (10% to 25% from top)
        rootMargin: '-10% 0px -75% 0px', 
        threshold: 0
      }
    );

    const container = labelViewRef.current;
    if (container) {
        const children = container.querySelectorAll('.label-section-item');
        children.forEach(c => observer.observe(c));
    }

    return () => observer.disconnect();
  }, [sections.length, activeTab]);

  // Scan and highlight MedDRA terms when PV-profile data is available
  useEffect(() => {
    if (activeTab === 'label-view' && labelViewRef.current && pvProfileData?.items?.length) {
      setupMeddraStatistics(pvProfileData);
      const timer = setTimeout(() => {
        if (!labelViewRef.current) return;
        const catalog = scanAndHighlightMeddraTerms(labelViewRef.current, pvProfileData.items);
        setSocCatalog(catalog);
        if (activeSoc) {
          applySocHighlight(labelViewRef.current, activeSoc);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeTab, pvProfileData, sections.length]);

  // Delegated click handler on label viewport for MedDRA terms
  useEffect(() => {
    const viewport = labelViewRef.current;
    if (!viewport) return;

    const handleViewportClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('.meddra-term-base') as HTMLElement | null;
      if (!target) return;

      e.stopPropagation();
      const clickedSoc = target.getAttribute('data-soc');
      if (!clickedSoc || clickedSoc === 'Unknown') return;

      if (activeSoc === clickedSoc) {
        // Toggle OFF if already highlighted
        clearSocHighlight(viewport);
        setActiveSoc(null);
        setActiveTermName(null);
      } else {
        // Activate new SOC highlight
        setActiveSoc(clickedSoc);
        setActiveTermName(target.getAttribute('data-term') || null);
        setActiveTermOccurIndex(0);
        applySocHighlight(viewport, clickedSoc);
        setNavTab('soc');
        if (tocCollapsed) {
          setTocCollapsed(false);
        }
      }
    };

    viewport.addEventListener('click', handleViewportClick);
    return () => viewport.removeEventListener('click', handleViewportClick);
  }, [activeSoc, tocCollapsed, setTocCollapsed]);

  return (
    <div id="label-view" className={`tab-content ${activeTab === 'label-view' ? 'active' : ''} ${(data.openfda_status === 'Archived' || data.is_latest === false) ? 'archived-theme' : ''}`} style={{ 
      display: activeTab === 'label-view' ? 'flex' : 'none', 
      flex: 1, 
      minHeight: 0,
      gap: '20px',
      alignItems: 'stretch',
      marginTop: '0px'
    }}>
        
        {/* Navigation Sidebar (ToC / SoC) */}
        <div id="toc-panel" className={`toc-side-panel-inline ${tocCollapsed ? 'collapsed' : ''}`} style={{ 
          width: tocCollapsed ? '0' : '300px', 
          height: '100%',
          flexShrink: 0,
          background: 'white',
          borderRadius: '16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          border: '1px solid var(--afl-n-100)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.3s ease'
        }}>
          <div className="toc-box" style={{ padding: '16px 14px', flex: 1, overflowY: 'auto' }}>
            {/* Top Header: ToC / SoC Segmented Toggle + Close Button */}
            <div className="toc-header" style={{ 
              marginBottom: '12px', 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              paddingBottom: '10px',
              borderBottom: '1px solid var(--afl-n-100)'
            }}>
              <div className="nav-tab-toggle-bar" style={{ flex: 1, margin: 0 }}>
                <button 
                  type="button"
                  className={`nav-tab-toggle-btn ${navTab === 'toc' ? 'active' : ''}`}
                  onClick={() => setNavTab('toc')}
                  title="Document Table of Contents"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                  <span>ToC</span>
                </button>
                <button 
                  type="button"
                  className={`nav-tab-toggle-btn ${navTab === 'soc' ? 'active' : ''}`}
                  onClick={() => setNavTab('soc')}
                  title="MedDRA System Organ Classes"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                  </svg>
                  <span>SoC</span>
                  {Object.keys(socCatalog).length > 0 && (
                    <span className="nav-tab-badge">{Object.keys(socCatalog).length}</span>
                  )}
                </button>
              </div>

              <button 
                onClick={() => setTocCollapsed(true)} 
                style={{ 
                  background: 'var(--afl-n-50)', 
                  border: '1px solid var(--afl-n-200)', 
                  borderRadius: '6px',
                  cursor: 'pointer', 
                  color: 'var(--afl-n-400)', 
                  fontSize: '0.75rem',
                  width: '26px',
                  height: '26px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  flexShrink: 0
                }}
                className="toc-close-btn"
                title="Collapse sidebar"
              >
                ✕
              </button>
            </div>

            {/* Panel Body: ToC or SoC */}
            {navTab === 'toc' ? (
              data.table_of_contents && data.table_of_contents.length > 0 ? (
                <ol className="toc-list">
                  {data.table_of_contents.map((item: TOCItem) => (
                    <TOCItemComponent 
                      key={item.id} 
                      item={item} 
                      expandedSections={expandedSections}
                      toggleSection={toggleSection}
                      activeSectionId={sections[currentIndex]?.id}
                    />
                  ))}
                </ol>
              ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--afl-n-400)' }}>No TOC available.</p>
              )
            ) : (
              /* SoC Navigation View */
              <div>
                {activeSoc && socCatalog[activeSoc] ? (
                  <div>
                    <div style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--afl-n-100)' }}>
                      <button
                        onClick={() => {
                          if (labelViewRef.current) clearSocHighlight(labelViewRef.current);
                          setActiveSoc(null);
                          setActiveTermName(null);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--afl-primary-600)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          padding: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          marginBottom: '8px'
                        }}
                      >
                        ← All Organ Classes
                      </button>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--afl-n-900)', lineHeight: '1.3' }}>
                            {activeSoc}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--afl-n-500)', marginTop: '2px' }}>
                            {socCatalog[activeSoc].totalOccurrences} occurrences &middot; {socCatalog[activeSoc].terms.length} terms
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (labelViewRef.current) clearSocHighlight(labelViewRef.current);
                            setActiveSoc(null);
                            setActiveTermName(null);
                          }}
                          title="Cancel highlight"
                          style={{
                            background: '#fef08a',
                            border: '1px solid #fde047',
                            color: '#854d0e',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        >
                          ✕ Clear
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {socCatalog[activeSoc].terms.map((termItem) => {
                        const isFocused = activeTermName === termItem.term;
                        return (
                          <div
                            key={termItem.term}
                            className={`soc-term-row ${isFocused ? 'focused' : ''}`}
                            onClick={() => {
                              const isSame = activeTermName === termItem.term;
                              const nextIdx = isSame ? (activeTermOccurIndex + 1) % termItem.elements.length : 0;
                              setActiveTermName(termItem.term);
                              setActiveTermOccurIndex(nextIdx);
                              if (termItem.elements[nextIdx]) {
                                scrollToTermElement(termItem.elements[nextIdx]);
                              }
                            }}
                            title={`Click to locate in document (${termItem.count} occurrences)`}
                          >
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '6px' }}>
                              {termItem.term}
                            </span>
                            <span style={{ 
                              fontSize: '0.7rem', 
                              fontWeight: 700, 
                              padding: '1px 6px', 
                              borderRadius: '10px', 
                              background: isFocused ? '#fde047' : 'var(--afl-n-200)',
                              color: isFocused ? '#854d0e' : 'var(--afl-n-700)',
                              flexShrink: 0
                            }}>
                              {isFocused ? `${activeTermOccurIndex + 1}/${termItem.count}` : `${termItem.count}x`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* No SoC active: display list of all available SOCs */
                  <div>
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--afl-n-500)', letterSpacing: '0.05em' }}>
                        System Organ Classes
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--afl-n-500)', marginTop: '2px' }}>
                        Select an organ class to highlight its terms in the label:
                      </div>
                    </div>

                    {Object.keys(socCatalog).length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {Object.values(socCatalog).map((group) => (
                          <div
                            key={group.socName}
                            className="soc-group-item"
                            onClick={() => {
                              setActiveSoc(group.socName);
                              setActiveTermName(null);
                              setActiveTermOccurIndex(0);
                              if (labelViewRef.current) {
                                applySocHighlight(labelViewRef.current, group.socName);
                              }
                            }}
                            title={`Highlight all ${group.totalOccurrences} terms for ${group.socName}`}
                          >
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
                              {group.socName}
                            </span>
                            <span style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '10px',
                              background: 'var(--afl-n-200)',
                              color: 'var(--afl-n-700)',
                              flexShrink: 0
                            }}>
                              {group.totalOccurrences}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '24px 10px', textAlign: 'center', color: 'var(--afl-n-400)', fontSize: '0.8rem' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📋</div>
                        <div style={{ fontWeight: 600 }}>No Adverse Event scan found</div>
                        <div style={{ fontSize: '0.72rem', marginTop: '4px', color: 'var(--afl-n-400)' }}>
                          Run PV-Profile in Toolbox to scan and index MedDRA terms for this label.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="label-main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            {tocCollapsed && (
              <button onClick={() => setTocCollapsed(false)} style={{ position: 'absolute', left: '20px', zIndex: 10, background: 'white', border: '1px solid var(--afl-n-200)', borderRadius: '8px', padding: '4px 12px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                ☰ SHOW MENU
              </button>
            )}

            {/* Continuous Vertical Scroll View */}
            <div className="vertical-scroll-container" style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                minHeight: 0, 
                background: 'var(--afl-n-100)',
                borderRadius: '12px',
                padding: '0',
                position: 'relative',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)',
                overflow: 'hidden'
            }}>
                {/* Reading Progress Bar */}
                <div className="spl-progress-track">
                    <div className="spl-progress-bar" style={{ width: `${progressPercent}%` }} />
                </div>
                <div 
                    className="label-viewport" 
                    ref={labelViewRef} 
                    style={{ 
                        flex: 1, 
                        overflowY: 'auto', 
                        padding: '40px',
                        scrollBehavior: 'smooth'
                    }}
                >
                    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '40px' }}>
                        {data.is_latest === false && (
                          <div style={{
                            background: 'var(--afl-warn-50)',
                            border: '1px dashed var(--afl-warn-700)',
                            borderRadius: '8px',
                            padding: '16px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            color: 'var(--afl-warn-700)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
                          }}>
                            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                            <div>
                              <div style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Earlier Version</div>
                              <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>This document is an earlier version of the structured product labeling (SPL) for this drug.</div>
                            </div>
                          </div>
                        )}
                        {data.is_latest !== false && data.openfda_status === 'Archived' && (
                          <div style={{
                            background: 'var(--afl-warn-50)',
                            border: '1px dashed var(--afl-warn-700)',
                            borderRadius: '8px',
                            padding: '16px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            color: 'var(--afl-warn-700)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
                          }}>
                            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                            <div>
                              <div style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Archived Record</div>
                              <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>This document is not currently active in the live openFDA registry and is shown for historical reference.</div>
                            </div>
                          </div>
                        )}
                        {sections.map((section: any, idx) => {
                          const isBoxed = section.is_boxed_warning;
                          return (
                            <div 
                                key={idx} 
                                className={`label-section-item${isBoxed ? ' boxed-warning-card' : ''}`}
                                data-section-index={idx}
                                id={section.id}
                                style={{ 
                                    background: 'white',
                                    borderRadius: '8px',
                                    padding: '40px 50px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                    border: '1px solid var(--afl-n-200)',
                                    position: 'relative'
                                }}
                            >
                                {data.is_latest === false && (
                                  <div style={{
                                    position: 'absolute',
                                    top: '20px',
                                    right: '30px',
                                    border: '3px double rgba(146, 64, 14, 0.25)',
                                    color: 'rgba(146, 64, 14, 0.25)',
                                    padding: '4px 10px',
                                    fontSize: '0.8rem',
                                    fontWeight: 900,
                                    borderRadius: '4px',
                                    textTransform: 'uppercase',
                                    transform: 'rotate(8deg)',
                                    userSelect: 'none',
                                    pointerEvents: 'none',
                                    letterSpacing: '0.1em',
                                    fontFamily: 'var(--font-inter), sans-serif'
                                  }}>
                                    Earlier Version
                                  </div>
                                )}
                                {data.is_latest !== false && data.openfda_status === 'Archived' && (
                                  <div style={{
                                    position: 'absolute',
                                    top: '20px',
                                    right: '30px',
                                    border: '3px double rgba(146, 64, 14, 0.25)',
                                    color: 'rgba(146, 64, 14, 0.25)',
                                    padding: '4px 10px',
                                    fontSize: '0.8rem',
                                    fontWeight: 900,
                                    borderRadius: '4px',
                                    textTransform: 'uppercase',
                                    transform: 'rotate(8deg)',
                                    userSelect: 'none',
                                    pointerEvents: 'none',
                                    letterSpacing: '0.1em',
                                    fontFamily: 'var(--font-inter), sans-serif'
                                  }}>
                                    Archived
                                  </div>
                                )}
                                {section.is_highlights ? (
                                    <HighlightsComponent
                                        highlights={data.highlights}
                                        onGoToSection={goToSectionByTitle}
                                    />
                                ) : (
                                    <SectionComponent section={section} />
                                )}
                            </div>
                          );
                        })}
                    </div>
                    {/* Spacer at bottom to allow scrolling last item to top */}
                    <div style={{ height: '200px' }}></div>
                </div>
            </div>
        </div>

        <style jsx>{`
            .toc-side-panel-inline { transition: width 0.3s ease; }
            .toc-side-panel-inline.collapsed { width: 0 !important; margin-right: -20px; border: none; }
            .toc-close-btn:hover { background-color: var(--afl-n-100) !important; color: var(--afl-n-600) !important; border-color: var(--afl-n-300) !important; }
            .label-viewport::-webkit-scrollbar { width: 8px; }
            .label-viewport::-webkit-scrollbar-track { background: transparent; }
            .label-viewport::-webkit-scrollbar-thumb { background: var(--afl-n-300); border-radius: 4px; }
            .label-viewport::-webkit-scrollbar-thumb:hover { background: var(--afl-n-400); }
            .page-inner-content :global(table) { width: 100% !important; font-size: 0.8rem !important; }
            .page-inner-content :global(img) { max-height: 300px; width: auto; object-fit: contain; }
        `}</style>
    </div>
  );
}
