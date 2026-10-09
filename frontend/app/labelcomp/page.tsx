'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '../context/UserContext';
import Header from "../components/Header";
import Link from 'next/link';
import Modal from '../components/Modal';
import { Badge, Button } from '../platform/primitives';
import './labelcomp.css';

interface LabelMetadata {
  set_id: string;
  brand_name: string;
  generic_name: string;
  manufacturer_name: string;
  effective_time: string;
  label_format: string;
}

interface ComparisonSection {
  title: string;
  key: string;
  nesting_level: number;
  contents: (string | null)[];
  is_same: boolean;
  is_empty: boolean;
  diff_html: string | null;
}

interface LabelCompData {
  labels: string[];
  comparison_data: ComparisonSection[];
  selected_labels_metadata: LabelMetadata[];
  drug_name: string | null;
  current_set_ids: string[];
  existing_summary: string | null;
  is_authenticated: boolean;
}

interface Project {
  id: number;
  title: string;
  count: number;
  role: string;
}

function LabelCompContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session, loading: userLoading, openAuthModal } = useUser();
  const [data, setData] = useState<LabelCompData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<'user' | 'nav' | 'more' | null>(null);
  const [isInternal, setIsInternal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const checkInternalStatus = async () => {
      try {
        const response = await fetch("/api/check-fdalabel", { method: 'POST' });
        const data = await response.json();
        setIsInternal(data.isInternal);
      } catch (error) {
        setIsInternal(false);
      }
    };
    checkInternalStatus();
  }, []);
  
  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'projects' | 'setid'>('projects');
  const [setIdInput, setSetIdInput] = useState('');
  
  // Favorite State
  const [showFavoriteModal, setShowFavoriteModal] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<number | null>(null);
  const [comparisonTitle, setComparisonTitle] = useState('');
  const [savingFavorite, setSavingFavorite] = useState(false);
  
  // Projects State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectLabels, setProjectLabels] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingLabels, setLoadingLabels] = useState(false);

  // Multi-select and Filter states
  const [selectedLabelsForAdd, setSelectedLabelsForAdd] = useState<any[]>([]);
  const [labelFilter, setLabelFilter] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryCollapsed, setAiSummaryCollapsed] = useState(false);
  const [severityFilter, setSeverityFilter] = useState(false);

  // Collapse State
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // New Grid Selection State
  const [selectedSlots, setSelectedSlots] = useState<(LabelMetadata | null)[]>([null, null, null, null]);
  const [activeSlotIdx, setActiveSlotIdx] = useState<number | null>(null);

  const handleSlotClick = (idx: number) => {
    setActiveSlotIdx(idx);
    setShowAddModal(true);
  };

  const handleClearSlot = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSlots = [...selectedSlots];
    newSlots[idx] = null;
    setSelectedSlots(newSlots);
    
    // Sync with URL if we are already in comparison mode
    const activeIds = newSlots.filter(s => s !== null).map(s => s!.set_id);
    const params = new URLSearchParams();
    activeIds.forEach(id => params.append('set_ids', id));
    router.push(`/labelcomp?${params.toString()}`);
  };

  const toggleSlotSelection = (label: any) => {
    const existingIdx = selectedSlots.findIndex(s => s?.set_id === label.set_id);
    if (existingIdx !== -1) {
      const newSlots = [...selectedSlots];
      newSlots[existingIdx] = null;
      setSelectedSlots(newSlots);
      
      // Also update URL if in comparison mode
      if (setIds.length > 0) {
        const activeIds = newSlots.filter(s => s !== null).map(s => s!.set_id);
        const params = new URLSearchParams();
        activeIds.forEach(id => params.append('set_ids', id));
        router.push(`/labelcomp?${params.toString()}`);
      }
      return;
    }
    const emptyIdx = selectedSlots.findIndex(s => s === null);
    if (emptyIdx !== -1) {
      const newSlots = [...selectedSlots];
      newSlots[emptyIdx] = {
        set_id: label.set_id,
        brand_name: label.brand_name || 'Unknown',
        generic_name: label.generic_name || '',
        manufacturer_name: label.manufacturer_name || '',
        effective_time: label.effective_time || '',
        label_format: label.label_format || 'SPL'
      };
      setSelectedSlots(newSlots);
      
      // Also update URL if in comparison mode
      if (setIds.length > 0) {
        const activeIds = newSlots.filter(s => s !== null).map(s => s!.set_id);
        const params = new URLSearchParams();
        activeIds.forEach(id => params.append('set_ids', id));
        router.push(`/labelcomp?${params.toString()}`);
      }
    } else {
      alert('Maximum 4 labels reached. Please clear a slot first.');
    }
  };

  const filledSlotsCount = selectedSlots.filter(s => s !== null).length;


  // Design System Constants
  /*
   * Shared style objects, tokenized. Several of these (toolbarToggleStyle,
   * primaryButtonStyle, secondaryButtonStyle, generateButtonStyle) duplicate
   * what the Button primitive already provides via variant props and are
   * being replaced at their call sites; kept here only where JSX still
   * references them directly, to avoid touching interaction logic in the
   * same pass as the styling.
   */
  const toolbarToggleStyle = {
    padding: '8px 16px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--afl-text-secondary)',
    borderRadius: 'var(--afl-radius-sm)',
    transition: 'all 0.2s'
  };

  const metaCardStyle = {
    backgroundColor: 'var(--afl-bg-surface)',
    padding: '1.25rem',
    borderRadius: 'var(--afl-radius-xl)',
    border: '1px solid var(--afl-border)',
    position: 'relative' as const,
    boxShadow: 'none',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: '160px'
  };

  const removeButtonStyle = {
    position: 'absolute' as const,
    top: '12px',
    right: '12px',
    background: 'var(--afl-bg-sunken)',
    border: 'none',
    color: 'var(--fdl-muted)',
    cursor: 'pointer',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.2rem',
    lineHeight: 1,
    transition: 'all 0.2s ease',
    zIndex: 10
  };

  const linkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    marginTop: 'auto',
    fontSize: '0.85rem',
    color: 'var(--fdl-blue-700)',
    textDecoration: 'none',
    fontWeight: 700,
    paddingTop: '1rem'
  };

  const aiInsightContainerStyle = {
    backgroundColor: 'var(--fdl-blue-050)',
    borderRadius: 'var(--afl-radius-xl)',
    border: '1px solid var(--fdl-blue-100)',
    marginBottom: '3rem',
    overflow: 'hidden',
    boxShadow: 'none'
  };

  const aiInsightHeaderStyle = {
    padding: '1.25rem 1.5rem',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    userSelect: 'none' as const
  };

  const setIds = useMemo(() => searchParams.getAll('set_ids'), [searchParams]);

  const isBoxedWarningSection = (section: ComparisonSection) => {
    const title = (section.title || '').trim().toLowerCase();
    const key = (section.key || '').trim().toLowerCase();

    return (
      /^boxed warning(s)?$/.test(title) ||
      /boxed[_\s-]?warning/.test(title) ||
      /boxed[_\s-]?warning/.test(key)
    );
  };

  const filteredData = useMemo(() => {
    if (!data) return [];

    const sortedData = [...data.comparison_data];

    const boxedWarningsIndex = sortedData.findIndex(isBoxedWarningSection);
    if (boxedWarningsIndex !== -1) {
      const boxedWarningsSection = sortedData.splice(boxedWarningsIndex, 1)[0];
      sortedData.unshift(boxedWarningsSection);
    }

    return sortedData.filter(section => {
      const isBoxed = isBoxedWarningSection(section);

      if (severityFilter && !isBoxed) {
        return !section.is_same && !section.is_empty &&
          ((section as any).similarity_ratio < 0.5 || (section as any).is_major_change);
      }

      return true;
    });
  }, [data, severityFilter]);

  // Dynamic grid template based on label count
  const comparisonGridStyle = {
    display: 'grid',
    gridTemplateColumns: data?.selected_labels_metadata.length 
      ? `repeat(${data.selected_labels_metadata.length}, minmax(0, 1fr))`
      : '1fr',
    gap: '1.5rem'
  };

  useEffect(() => {
    if (setIds.length === 0) {
      setData(null);
      setAiSummary(null);
      return;
    }

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/labelcomp/?json=1&${searchParams.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch comparison data');
        const json = await res.json();
        setData(json);
        setAiSummary(json.existing_summary);

        // Sync grid slots with fetched metadata
        const fetchedMeta = json.selected_labels_metadata || [];
        const newSlots: (LabelMetadata | null)[] = [null, null, null, null];
        fetchedMeta.forEach((meta: LabelMetadata, i: number) => {
          if (i < 4) newSlots[i] = meta;
        });
        setSelectedSlots(newSlots);
        
        // Initialize all sections as expanded
        const initialCollapseState: Record<string, boolean> = {};
        json.comparison_data.forEach((s: ComparisonSection) => {
            initialCollapseState[s.key] = false;
        });
        setCollapsedSections(initialCollapseState);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [searchParams, setIds]);

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({
        ...prev,
        [key]: !prev[key]
    }));
  };

  const expandAll = () => {
    const newState: Record<string, boolean> = {};
    data?.comparison_data.forEach(s => newState[s.key] = false);
    setCollapsedSections(newState);
  };

  const collapseAll = () => {
    const newState: Record<string, boolean> = {};
    data?.comparison_data.forEach(s => newState[s.key] = true);
    setCollapsedSections(newState);
  };

  useEffect(() => {
    if (!showAddModal) {
      setSelectedLabelsForAdd([]);
      setLabelFilter('');
    }
  }, [showAddModal]);

  // Load projects when modal opens or on landing page (empty state)
  useEffect(() => {
    const shouldFetch = (showAddModal || showFavoriteModal || setIds.length === 0) && session?.is_authenticated;
    if (shouldFetch) {
      fetchProjects();
    }
    if (showAddModal && !session?.is_authenticated) {
      setAddTab('setid');
    }
  }, [showAddModal, showFavoriteModal, setIds, session]);

  const fetchProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/dashboard/projects');
      const data = await res.json();
      const fetchedProjects = data.projects || [];
      setProjects(fetchedProjects);
      
      // Auto-select first project for Favorite modal
      if (showFavoriteModal && fetchedProjects.length > 0 && !targetProjectId) {
        setTargetProjectId(fetchedProjects[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingProjects(false);
    }
  };

  const fetchProjectLabels = async (project: Project) => {
    setLoadingLabels(true);
    setSelectedProject(project);
    try {
      const res = await fetch(`/api/dashboard/favorites_data?project_id=${project.id}`);
      const data = await res.json();
      setProjectLabels(data.favorites || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLabels(false);
    }
  };

  const toggleLabelSelection = (label: any) => {
    const isSelected = selectedLabelsForAdd.find(l => l.set_id === label.set_id);
    if (isSelected) {
      setSelectedLabelsForAdd(prev => prev.filter(l => l.set_id !== label.set_id));
    } else {
      if (selectedLabelsForAdd.length >= 4) {
        alert('Maximum 4 labels can be selected for comparison.');
        return;
      }
      setSelectedLabelsForAdd(prev => [...prev, label]);
    }
  };

  const handleBulkAdd = () => {
    if (selectedLabelsForAdd.length === 0) return;
    
    if (selectedLabelsForAdd.length >= 4) {
      setShowConfirmDialog(true);
    } else {
      confirmBulkAdd();
    }
  };

  const confirmBulkAdd = () => {
    const newSlots = [...selectedSlots];
    let slotPtr = activeSlotIdx !== null ? activeSlotIdx : 0;

    selectedLabelsForAdd.forEach(label => {
      // Find next empty slot starting from slotPtr
      while (slotPtr < 4 && newSlots[slotPtr] !== null) {
        slotPtr++;
      }
      if (slotPtr < 4) {
        newSlots[slotPtr] = label;
        slotPtr++;
      }
    });

    setSelectedSlots(newSlots);
    
    const activeIds = newSlots.filter(s => s !== null).map(s => s!.set_id);
    const params = new URLSearchParams();
    activeIds.forEach(id => params.append('set_ids', id));
    router.push(`/labelcomp?${params.toString()}`);
    
    setShowAddModal(false);
    setShowConfirmDialog(false);
    setSelectedLabelsForAdd([]);
    setActiveSlotIdx(null);
  };

  const handleAddLabel = (setId: string) => {
    const cleanId = setId.trim();
    if (!cleanId) return;
    
    if (setIds.includes(cleanId)) {
      alert('This label is already in the comparison.');
      return;
    }

    const newSlots = [...selectedSlots];
    let targetIdx = activeSlotIdx;
    if (targetIdx === null || newSlots[targetIdx] !== null) {
        targetIdx = newSlots.findIndex(s => s === null);
    }

    if (targetIdx === -1 || targetIdx >= 4) {
      alert('Maximum 4 labels reached. Please clear a slot first.');
      return;
    }

    // Since we only have setId, we'll let the fetchData useEffect handle the metadata sync
    // But for immediate UI feedback we can push to router
    const activeIds = newSlots.filter(s => s !== null).map(s => s!.set_id);
    activeIds.push(cleanId);
    
    const params = new URLSearchParams();
    activeIds.forEach(id => params.append('set_ids', id));
    router.push(`/labelcomp?${params.toString()}`);

    setShowAddModal(false);
    setSetIdInput('');
    setSelectedProject(null);
    setProjectLabels([]);
    setActiveSlotIdx(null);
  };



  const handleRemoveLabel = (setId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const newIds = setIds.filter(id => id !== setId);
    params.delete('set_ids');
    newIds.forEach(id => params.append('set_ids', id));
    router.push(`/labelcomp?${params.toString()}`);
  };

  const generateAiSummary = async (force = false) => {
    if (!data) return;
    setSummaryGenerating(true);
    try {
      const diffData = data.comparison_data
        .filter(s => !s.is_same && !s.is_empty)
        .map(s => ({
          title: s.title,
          contents: s.contents // Send all contents instead of just content1/content2
        }));

      const res = await fetch('/api/labelcomp/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          set_ids: data.current_set_ids,
          comparison_data: diffData,
          label_names: data.selected_labels_metadata.map(m => m.brand_name),
          force_refresh: force
        })
      });
      const result = await res.json();
      if (result.summary) setAiSummary(result.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setSummaryGenerating(false);
    }
  };

    const handleExportDiffs = () => {
      if (!data || data.selected_labels_metadata.length < 2) return;
  
      const labelNames = data.selected_labels_metadata.map(m => m.brand_name).join(', ');
      const numLabels = data.selected_labels_metadata.length;
      
          // Logic to determine export mode
          let exportMode: 'SECTION_WISE' | 'ENTIRE_DOCUMENT' = 'ENTIRE_DOCUMENT';
          
          if (numLabels === 2) {
            // 1. Check if both metadata formats are PLR
            const isAllPLR = data.selected_labels_metadata.every(m => m.label_format === 'PLR');
            
            // 2. Or if we can find a Warnings & Precautions section shared by both
            const hasWarningsSection = data.comparison_data.find(s => 
              /WARNINGS\s+(AND|&)\s+PRECAUTIONS/i.test(s.title)
            );
      
            if (isAllPLR || hasWarningsSection) {
              exportMode = 'SECTION_WISE';
            }
          }  
      let prompt = "";
      let comparisonPayload: any = null;
  
      if (exportMode === 'SECTION_WISE') {
        const diffSections = data.comparison_data.filter(s => !s.is_same && !s.is_empty);
        
        prompt = `You are a clinical regulatory specialist assisting a drug reviewer. 
  Your task is to analyze the differences between these two PLR-formatted drug labels: ${labelNames}.
  I am providing a section-by-section breakdown of detected differences. 
  1. For each provided section, compare the content and identify specific clinical additions, deletions, or modifications.
  2. Organize your response section-wise, following numerical order (e.g., Section 1, 2, 3...) to maintain logical clinical progression.
  3. Conclude with a final paragraph titled "Summary of Significant Differences" that synthesizes the most impactful clinical or regulatory changes.`;
  
        comparisonPayload = diffSections.map(s => ({
          section_title: s.title,
          section_key: s.key,
          label_versions: data.selected_labels_metadata.map((m, idx) => ({
            label_name: m.brand_name,
            content: s.contents[idx] || "Not specified."
          }))
        }));
      } else {
        // ENTIRE DOCUMENT MODE
        prompt = `You are a clinical regulatory specialist assisting a drug reviewer. 
  Your task is to perform a comprehensive comparison across the ENTIRE text of the following labels: ${labelNames}.
  Note: These labels may have different structural formats or involve multiple versions. 
  1. Analyze the full text provided for each label to identify clinical updates in safety, dosing, and indications, regardless of where they appear in the documents.
  2. Organize your analysis by major clinical categories (e.g., Indications, Safety, Dosing).
  3. Conclude with a final paragraph titled "Summary of Significant Differences" that synthesizes the high-level regulatory and clinical shifts across all versions.`;
  
        // Reconstruct "Entire Document" by concatenating all sections for each label index
        comparisonPayload = data.selected_labels_metadata.map((m, idx) => {
          const fullText = data.comparison_data
            .map(s => s.contents[idx])
            .filter(Boolean)
            .join('\n\n');
          
          return {
            label_name: m.brand_name,
            metadata: {
              manufacturer: m.manufacturer_name,
              effective_time: m.effective_time,
              set_id: m.set_id,
              format: m.label_format
            },
            full_content: fullText
          };
        });
      }
  
      const exportObject = {
        export_metadata: {
          export_mode: exportMode,
          date: new Date().toISOString(),
          labels_included: data.selected_labels_metadata.map(m => m.brand_name)
        },
        instructions: prompt,
        data: comparisonPayload
      };
  
      const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `label_comp_${exportMode.toLowerCase()}_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    };

  const handleSaveFavorite = async () => {
    if (!data || !targetProjectId || !comparisonTitle.trim()) return;
    setSavingFavorite(true);
    try {
      const res = await fetch('/api/dashboard/toggle_favorite_comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          set_ids: data.current_set_ids,
          title: comparisonTitle.trim(),
          project_id: targetProjectId
        })
      });
      const result = await res.json();
      if (result.success) {
        setShowFavoriteModal(false);
        setComparisonTitle('');
        alert('Comparison saved to project successfully.');
      } else {
        alert(result.error || 'Failed to save comparison.');
      }
    } catch (e) {
      alert('Network error. Please try again.');
    } finally {
      setSavingFavorite(false);
    }
  };

  return (
    <div className="lc-page" style={{ minHeight: '100vh', backgroundColor: 'var(--afl-bg-page)' }}>
      <Header />

      <main style={{ maxWidth: '1600px', margin: '0 auto', padding: 'clamp(2rem, 5vh, 4rem) clamp(1rem, 5vw, 2rem)' }}>
        {/* Hero Section */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 className="hero-title-animated" style={{ fontSize: 'clamp(2.25rem, 6vw, 3rem)', fontWeight: 900, marginBottom: '0.75rem', letterSpacing: '-0.025em' }}>
            LabelComp
          </h1>
          <p className="hero-subtitle-animated" style={{ fontSize: 'clamp(1rem, 2vw, 1.15rem)', color: 'var(--afl-text-secondary)', fontWeight: '500', maxWidth: '700px', margin: '0 auto' }}>
            Synchronize and compare clinical data across multiple FDA drug labels.
          </p>
        </div>

        {/* Comparison Setup Panel */}
        <section className="lc-setup-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--afl-text-primary)', margin: 0 }}>Compared Drug Labels</h2>
              <p style={{ margin: '4px 0 0 0', color: 'var(--afl-text-secondary)', fontWeight: 500, fontSize: '0.85rem' }}>
                Compare up to 4 drug labels side-by-side. Add at least 2 labels to begin.
              </p>
            </div>
            {filledSlotsCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="lc-clear-btn"
                onClick={() => { setSelectedSlots([null, null, null, null]); router.push('/labelcomp'); }}
              >
                Clear All
              </Button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* List of selected labels as compact chips */}
            {selectedSlots.map((slot, index) => {
              if (slot) {
                return (
                  <div key={slot.set_id} className="lc-label-chip">
                    <span>{slot.brand_name}</span>
                    <span className="lc-label-chip__meta">({slot.manufacturer_name})</span>
                    <button
                      type="button"
                      className="lc-label-chip__remove"
                      aria-label={`Remove ${slot.brand_name}`}
                      onClick={(e) => handleClearSlot(index, e)}
                      title="Remove label"
                    >
                      ✕
                    </button>
                  </div>
                );
              }
              return null;
            })}

            {/* Add Label Button - only show if total selected is < 4 */}
            {filledSlotsCount < 4 && (
              <button
                type="button"
                className="afl-btn afl-btn--primary lc-add-label-btn"
                onClick={() => {
                  const firstEmptyIdx = selectedSlots.findIndex(s => s === null);
                  if (firstEmptyIdx !== -1) {
                    handleSlotClick(firstEmptyIdx);
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Add Label
              </button>
            )}
          </div>

          {/* Launch Button when not comparing yet */}
          {filledSlotsCount >= 2 && !data && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '1.25rem', borderTop: '1px solid var(--afl-n-100)', paddingTop: '1.25rem' }}>
               <Button
                variant="success"
                className="lc-launch-btn"
                onClick={() => {
                    const activeIds = selectedSlots.filter(s => s !== null).map(s => s!.set_id);
                    const params = new URLSearchParams();
                    activeIds.forEach(id => params.append('set_ids', id));
                    router.push(`/labelcomp?${params.toString()}`);
                }}
               >
                 Launch Comparison Analysis
               </Button>
            </div>
          )}
        </section>

        {/* Unified Action Toolbar (Only shown when data is loaded) */}
        {data && (
          <div className="lc-toolbar">
            <div className="lc-toolbar__tabs">
              <button type="button" onClick={expandAll} className="lc-toolbar-toggle">Expand All</button>
              <button type="button" onClick={collapseAll} className="lc-toolbar-toggle">Collapse All</button>
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <Button variant="info" onClick={handleExportDiffs}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Export
              </Button>
            </div>
          </div>
        )}

        {loading && <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--afl-text-secondary)', fontWeight: 600 }}><div className="loader" style={{ margin: '0 auto 1rem auto' }}></div>Synchronizing data...</div>}
        {error && <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--fdl-red)', backgroundColor: 'var(--fdl-red-050)', borderRadius: 'var(--afl-radius-md)', border: '1px solid var(--fdl-red)' }}>Error: {error}</div>}
        
        {/* Metadata section removed as it is now in the slots */}

        {/* AI Comparison Insight (Indigo Theme) */}
        {data && data.selected_labels_metadata.length >= 2 && (
          <section style={aiInsightContainerStyle}>
            <div onClick={() => setAiSummaryCollapsed(!aiSummaryCollapsed)} style={aiInsightHeaderStyle}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '32px', height: '32px', backgroundColor: 'var(--fdl-blue-100)', borderRadius: 'var(--afl-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fdl-navy-800)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-4-4H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 4-4h6z"></path></svg>
                  </div>
                  <span style={{ fontWeight: 800, color: 'var(--afl-n-900)', fontSize: '1.05rem', letterSpacing: '-0.01em' }}>AI Comparison Insight</span>
               </div>
               <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--fdl-blue-700)' }}>{aiSummaryCollapsed ? 'SHOW ANALYSIS' : 'HIDE ANALYSIS'}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--fdl-muted)', transform: aiSummaryCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
               </div>
            </div>
            {!aiSummaryCollapsed && (
              <div style={{ padding: '2rem', borderTop: '1px solid var(--fdl-blue-100)', backgroundColor: 'var(--afl-bg-surface)' }}>
                 {aiSummary ? (
                    <div className="ai-summary-content" style={{ animation: 'fadeIn 0.3s ease-out' }} dangerouslySetInnerHTML={{ __html: aiSummary }} />
                 ) : (
                    <div style={{ textAlign: 'center', padding: '1rem' }}>
                      <p style={{ color: 'var(--afl-text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                        {session?.is_authenticated
                          ? 'Perform a multi-label cognitive analysis to extract key regulatory and clinical differences.'
                          : 'Please sign in to generate high-fidelity AI comparison summaries.'}
                      </p>
                      {session?.is_authenticated && (
                        <Button
                          variant="primary"
                          onClick={(e) => { e.stopPropagation(); generateAiSummary(); }}
                          disabled={summaryGenerating}
                        >
                          {summaryGenerating ? 'Synchronizing Intelligence...' : 'Generate Clinical Summary'}
                        </Button>
                      )}
                    </div>
                 )}
              </div>
            )}
          </section>
        )}

        {data && data.comparison_data.length > 0 ? (
          <div style={{ backgroundColor: 'var(--afl-bg-surface)', borderRadius: 'var(--afl-radius-xl)', border: '1px solid var(--afl-border)', overflow: 'hidden', boxShadow: 'none' }}>
            <div style={{ padding: '1rem 1.5rem', backgroundColor: 'var(--afl-bg-sunken)', borderBottom: '1px solid var(--afl-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Discrepancy Panel ({filteredData.length} sections)
                </span>
                <button
                    type="button"
                    className="afl-btn lc-severity-toggle"
                    aria-pressed={severityFilter}
                    onClick={() => setSeverityFilter(value => !value)}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                    FILTER BY SEVERITY GAP {severityFilter ? 'ON' : 'OFF'}
                </button>
            </div>
            {filteredData.map((section, idx) => (
              <div key={idx} style={{ 
                borderBottom: '1px solid var(--afl-n-100)', 
                backgroundColor: section.is_same ? 'var(--afl-n-50)' : 'white'
              }}>
                <div 
                    onClick={() => toggleSection(section.key)}
                    style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '1.25rem 1.5rem',
                        cursor: 'pointer',
                        userSelect: 'none',
                        marginLeft: `${section.nesting_level * 24}px`,
                        transition: 'background-color 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--afl-n-50)'}
                    onMouseOut={e => e.currentTarget.style.backgroundColor = section.is_same ? 'var(--afl-n-50)' : 'white'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--afl-n-400)', transform: collapsedSections[section.key] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
                    <h4 style={{ margin: 0, color: section.is_same ? 'var(--afl-n-500)' : 'var(--afl-gov-navy)', fontSize: '0.95rem', fontWeight: 800, letterSpacing: '-0.01em' }}>
                        {section.title}
                        {!section.is_empty && (
                        <span style={{ 
                            marginLeft: '12px', 
                            fontSize: '0.65rem', 
                            padding: '3px 10px', 
                            borderRadius: '6px',
                            backgroundColor: section.is_same ? 'var(--afl-n-100)' : 'var(--fdl-red-050)',
                            color: section.is_same ? 'var(--afl-n-400)' : 'var(--fdl-red)',
                            fontWeight: 800,
                            letterSpacing: '0.02em'
                        }}>
                            {section.is_same ? 'IDENTICAL' : 'CHANGES DETECTED'}
                        </span>
                        )}
                    </h4>
                  </div>
                </div>

                {!collapsedSections[section.key] && (
                    <div style={{ padding: '0 1.5rem 1.5rem 1.5rem', animation: 'fadeIn 0.2s' }}>
                        {(section as any).is_major_change ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ 
                                    backgroundColor: 'var(--fdl-amber-050)',
                                    border: '1px solid var(--fdl-amber)',
                                    borderRadius: '12px', 
                                    padding: '1.25rem', 
                                    color: 'var(--fdl-amber)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    boxShadow: '0 2px 4px rgba(251, 146, 60, 0.05)'
                                }}>
                                    <div style={{ color: 'var(--fdl-amber)' }}>
                                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Significant Section Overhaul</div>
                                        <div style={{ fontSize: '0.85rem', opacity: 0.9, fontWeight: 500 }}>This section has been extensively rewritten. Visual diffing is disabled to prioritize readability.</div>
                                    </div>
                                </div>
                                <div style={comparisonGridStyle}>
                                    {section.contents.map((content, cIdx) => {
                                        const meta = data.selected_labels_metadata[cIdx];
                                        return (
                                            <div key={cIdx} style={{ 
                                                fontSize: '0.9rem', 
                                                color: 'var(--afl-n-700)', 
                                                lineHeight: 1.7,
                                                padding: '2.5rem 1.25rem 1.25rem 1.25rem',
                                                backgroundColor: cIdx % 2 === 0 ? 'var(--afl-n-50)' : 'var(--afl-n-0)',
                                                border: '1px solid var(--afl-n-200)',
                                                borderRadius: '12px',
                                                position: 'relative'
                                            }}>
                                                <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: 'var(--afl-gov-navy)', color: 'white', fontSize: '0.65rem', padding: '3px 10px', borderRadius: '6px', fontWeight: 800, textTransform: 'uppercase' }}>
                                                    {meta.brand_name}
                                                </div>
                                                {content ? <div className="spl-content" dangerouslySetInnerHTML={{ __html: content }} /> : <span style={{ color: 'var(--afl-n-300)', fontStyle: 'italic', fontWeight: 500 }}>Not specified.</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div style={comparisonGridStyle}>
                                {section.contents.map((content, cIdx) => {
                                    const meta = data.selected_labels_metadata[cIdx];
                                    const manufacturerSnippet = meta.manufacturer_name ? (meta.manufacturer_name.length > 8 ? `${meta.manufacturer_name.substring(0, 8)}...` : meta.manufacturer_name) : 'N/A';
                                    const tagLabel = `${meta.brand_name} [${manufacturerSnippet}]`;
                                    
                                    const displayContent = (section as any).nuanced_contents?.[cIdx] || content;

                                    return (
                                        <div key={cIdx} style={{ 
                                            fontSize: '0.9rem', 
                                            color: 'var(--afl-n-700)', 
                                            lineHeight: 1.7,
                                            padding: '2.5rem 1.25rem 1.25rem 1.25rem',
                                            backgroundColor: cIdx % 2 === 0 ? 'var(--afl-n-50)' : 'var(--afl-n-0)',
                                            border: '1px solid var(--afl-n-200)',
                                            borderRadius: '12px',
                                            position: 'relative',
                                            minHeight: '120px'
                                        }}>
                                            <div style={{
                                                position: 'absolute',
                                                top: '10px',
                                                left: '10px',
                                                backgroundColor: section.is_same ? 'var(--afl-n-500)' : 'var(--afl-gov-navy)',
                                                color: 'white',
                                                fontSize: '0.65rem',
                                                padding: '3px 10px',
                                                borderRadius: '6px',
                                                fontWeight: 800,
                                                textTransform: 'uppercase',
                                                maxWidth: '90%',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                zIndex: 1,
                                                letterSpacing: '0.02em'
                                            }} title={tagLabel}>
                                                {tagLabel}
                                            </div>
                                            {displayContent ? (
                                                <div className="spl-content" dangerouslySetInnerHTML={{ __html: displayContent }} />
                                            ) : (
                                                <span style={{ color: 'var(--afl-n-300)', fontStyle: 'italic', fontWeight: 500 }}>Not specified in this labeling.</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
              </div>
            ))}
          </div>
        ) : !loading && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '2.5rem',
            marginTop: '2rem',
            animation: 'fadeIn 0.5s ease-out'
          }}>
            {/* Left Column: Onboarding / Instructive Guide */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '24px',
              padding: '2.5rem',
              border: '1px solid var(--afl-n-200)',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.01)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ color: 'var(--afl-n-900)', fontSize: '1.4rem', fontWeight: 900, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '10px', backgroundColor: 'var(--fdl-blue-100)', color: 'var(--fdl-navy-800)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  </span>
                  How to use LabelComp
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {/* Step 1 */}
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{
                      minWidth: '36px',
                      height: '36px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, var(--fdl-blue-700) 0%, var(--fdl-blue-700) 100%)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      boxShadow: '0 4px 10px rgba(79, 70, 229, 0.2)'
                    }}>1</div>
                    <div>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--afl-n-800)' }}>Select or Upload Labels</h4>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.6, fontWeight: 500 }}>
                        Pick from your saved tasks / projects in the Workspace card, enter specific FDA SPL Set IDs, or drag and drop local XML labelings.
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{
                      minWidth: '36px',
                      height: '36px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, var(--fdl-blue-700) 0%, var(--fdl-navy-800) 100%)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      boxShadow: '0 4px 10px rgba(2, 132, 199, 0.2)'
                    }}>2</div>
                    <div>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--afl-n-800)' }}>Fill Comparison Slots</h4>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.6, fontWeight: 500 }}>
                        Arrange up to 4 labels in the slots above. A minimum of 2 labels is required to initiate side-by-side disparity mapping.
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{
                      minWidth: '36px',
                      height: '36px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, var(--fdl-green) 0%, var(--fdl-green) 100%)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      boxShadow: '0 4px 10px rgba(16, 185, 129, 0.2)'
                    }}>3</div>
                    <div>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--afl-n-800)' }}>Compare & Extract Insights</h4>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.6, fontWeight: 500 }}>
                        Launch the analysis to explore aligned section diffs, filter by severity gaps, run multi-label AI clinical summaries, and export reports.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: '2.5rem',
                padding: '1.25rem',
                backgroundColor: 'var(--afl-n-50)',
                borderRadius: '16px',
                border: '1px solid var(--afl-n-200)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{ color: 'var(--fdl-blue-700)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m8 3 4 8 5-5-5 15-2-8-3-3Z"></path></svg>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--afl-n-600)', lineHeight: 1.5, fontWeight: 600 }}>
                  Tip: You can quickly compare different versions of the same drug to identify safety profile updates and black box warning additions over time.
                </div>
              </div>
            </div>

            {/* Right Column: Quick Start Workspace Card */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '24px',
              padding: '2rem',
              border: '1px solid var(--afl-n-200)',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.01)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <h3 style={{ color: 'var(--afl-n-900)', fontSize: '1.4rem', fontWeight: 900, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '10px', backgroundColor: 'var(--fdl-green-050)', color: 'var(--fdl-green)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg>
                </span>
                Quick Start Workspace
              </h3>

              {/* Workspace Navigation Tabs */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', background: 'var(--afl-n-50)', padding: '4px', borderRadius: '12px', border: '1px solid var(--afl-n-100)' }}>
                <button 
                  type="button"
                  aria-pressed={addTab === 'projects'}
                  onClick={() => setAddTab('projects')}
                  style={{ 
                    flex: 1,
                    padding: '10px 16px', 
                    borderRadius: '10px', 
                    border: 'none', 
                    backgroundColor: addTab === 'projects' ? 'var(--afl-n-0)' : 'transparent',
                    color: addTab === 'projects' ? 'var(--afl-n-900)' : 'var(--afl-n-500)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    boxShadow: addTab === 'projects' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  Browse Projects
                </button>
                <button 
                  type="button"
                  aria-pressed={addTab === 'setid'}
                  onClick={() => setAddTab('setid')}
                  style={{ 
                    flex: 1,
                    padding: '10px 16px', 
                    borderRadius: '10px', 
                    border: 'none', 
                    backgroundColor: addTab === 'setid' ? 'var(--afl-n-0)' : 'transparent',
                    color: addTab === 'setid' ? 'var(--afl-n-900)' : 'var(--afl-n-500)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    boxShadow: addTab === 'setid' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  Import SET-ID
                </button>
              </div>

              {addTab === 'projects' ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '320px' }}>
                  {!session?.is_authenticated ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--afl-n-500)', padding: '2rem', background: 'var(--afl-n-50)', borderRadius: '16px', border: '1px dashed var(--afl-n-200)' }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--afl-n-400)', marginBottom: '1rem' }}>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                      <p style={{ margin: '0 0 1.25rem 0', fontWeight: 600, fontSize: '0.9rem' }}>Sign in to access your dashboard tasks and saved labelings.</p>
                      <button 
                        onClick={() => openAuthModal('login')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px', background: 'var(--afl-gov-navy)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}
                      >
                        Sign In Now
                      </button>
                    </div>
                  ) : selectedProject ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <button onClick={() => setSelectedProject(null)} style={{ background: 'none', border: 'none', color: 'var(--fdl-blue-700)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', padding: 0 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                          Back to Projects
                        </button>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-500)', backgroundColor: 'var(--afl-n-100)', padding: '3px 8px', borderRadius: '6px' }}>
                          {selectedProject.title}
                        </span>
                      </div>
                      
                      {loadingLabels ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--afl-n-500)', fontSize: '0.85rem' }}>
                          Loading labelings...
                        </div>
                      ) : projectLabels.length === 0 ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--afl-n-400)', fontSize: '0.85rem', fontStyle: 'italic', padding: '2rem', textAlign: 'center' }}>
                          No labelings saved in this task.
                        </div>
                      ) : (
                        <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }} className="custom-scrollbar">
                          {projectLabels.map(label => {
                            const isSelected = selectedSlots.some(s => s?.set_id === label.set_id);
                            return (
                              <div 
                                key={label.set_id} 
                                onClick={() => toggleSlotSelection(label)}
                                style={{ 
                                  padding: '10px 12px', 
                                  borderRadius: '10px',
                                  border: '1px solid',
                                  borderColor: isSelected ? 'var(--fdl-blue-700)' : 'var(--afl-n-100)',
                                  display: 'flex', 
                                  justifyContent: 'space-between', 
                                  alignItems: 'center',
                                  cursor: 'pointer',
                                  backgroundColor: isSelected ? 'var(--fdl-blue-050)' : 'var(--afl-n-50)',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseOver={e => !isSelected && (e.currentTarget.style.borderColor = 'var(--afl-n-300)')}
                                onMouseOut={e => !isSelected && (e.currentTarget.style.borderColor = 'var(--afl-n-100)')}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: isSelected ? 'var(--fdl-navy-800)' : 'var(--afl-n-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label.brand_name}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label.manufacturer_name || 'N/A'}</div>
                                </div>
                                <button 
                                  style={{
                                    border: 'none',
                                    backgroundColor: isSelected ? 'var(--fdl-red)' : 'var(--fdl-green)',
                                    color: 'white',
                                    fontSize: '0.7rem',
                                    fontWeight: 800,
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    marginLeft: '8px',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {isSelected ? 'Remove' : '+ Add'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      {loadingProjects ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--afl-n-500)', fontSize: '0.85rem' }}>
                          Loading projects...
                        </div>
                      ) : projects.length === 0 ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--afl-n-400)', fontSize: '0.85rem', fontStyle: 'italic', padding: '2rem', textAlign: 'center' }}>
                          No active projects found.
                        </div>
                      ) : (
                        <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }} className="custom-scrollbar">
                          {projects.map(p => (
                            <div
                              key={p.id}
                              onClick={() => fetchProjectLabels(p)}
                              style={{
                                padding: '12px 14px',
                                borderRadius: '10px',
                                border: '1px solid var(--afl-n-100)',
                                backgroundColor: 'var(--afl-n-50)',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                              }}
                              onMouseOver={e => {
                                e.currentTarget.style.borderColor = 'var(--afl-n-300)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                              }}
                              onMouseOut={e => {
                                e.currentTarget.style.borderColor = 'var(--afl-n-100)';
                                e.currentTarget.style.transform = 'translateY(0)';
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                <span style={{ color: p.title === 'Favorite' ? 'var(--fdl-amber)' : 'var(--fdl-blue-700)', display: 'flex' }}>
                                  {p.title === 'Favorite' ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                  ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                  )}
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
                              </div>
                              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-n-500)', backgroundColor: 'var(--afl-n-100)', padding: '2px 6px', borderRadius: '4px' }}>
                                {p.count} labels
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem', minHeight: '320px' }}>
                  {/* Set ID entry */}
                  <div style={{ backgroundColor: 'var(--afl-n-50)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--afl-n-200)' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: 800, color: 'var(--afl-n-600)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Import by SPL Set ID</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--afl-n-500)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                      Enter the unique SPL SET-ID (UUID) to import and add a custom drug labeling to your comparison list.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        type="text" 
                        placeholder="e.g. 00000000-0000-0000-0000-000000000000"
                        value={setIdInput}
                        onChange={(e) => setSetIdInput(e.target.value)}
                        style={{ 
                          flex: 1,
                          padding: '10px 12px', 
                          borderRadius: '8px', 
                          border: '1px solid var(--afl-n-300)', 
                          fontSize: '0.85rem',
                          outline: 'none',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                        }}
                      />
                      <button
                        type="button"
                        disabled={!setIdInput.trim() || loading}
                        onClick={() => {
                          if (setIdInput.trim()) {
                            handleAddLabel(setIdInput);
                          }
                        }}
                        style={{ 
                          backgroundColor: 'var(--afl-gov-navy)', 
                          color: 'white', 
                          border: 'none', 
                          padding: '0 16px', 
                          borderRadius: '8px', 
                          fontWeight: 700, 
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Add Label
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Add Label Modal */}
      {showAddModal && (
        <div className="lc-add-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowAddModal(false); setSelectedProject(null); } }}>
          <section className="lc-add-modal" role="dialog" aria-modal="true" aria-labelledby="lc-add-modal-title">
            <header className="lc-add-modal__header">
              <div>
                <span className="lc-add-modal__region">LABEL COMPARISON / INPUT</span>
                <h3 id="lc-add-modal-title">Add labels to comparison</h3>
                <p>Select labelings from a project or import one by SPL Set ID.</p>
              </div>
              <button type="button" className="lc-add-modal__close" aria-label="Close" onClick={() => { setShowAddModal(false); setSelectedProject(null); }}>×</button>
            </header>

            <div className="lc-add-modal__selection">
              <span className="lc-add-modal__field-label">SELECTED FOR COMPARISON</span>
              <div className="lc-add-modal__chips">
                {selectedLabelsForAdd.length > 0 ? selectedLabelsForAdd.map((label, i) => (
                  <span className="lc-add-modal__chip" key={label.set_id}><b>{String(i + 1).padStart(2, '0')}</b><span>{label.brand_name}</span></span>
                )) : <span className="lc-add-modal__empty-selection">No labels selected. Choose labels from the list below.</span>}
              </div>
              <span className="lc-add-modal__count">{selectedLabelsForAdd.length} / 4</span>
            </div>

            <div className="lc-add-modal__search-row">
              <label className="lc-add-modal__search">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input type="search" placeholder="Filter by drug or manufacturer" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} />
              </label>
              <Button variant="success" onClick={handleBulkAdd} disabled={selectedLabelsForAdd.length === 0}>Add selected {selectedLabelsForAdd.length > 0 ? `(${selectedLabelsForAdd.length})` : ''}</Button>
            </div>

            <div className="lc-add-modal__tabs" role="tablist" aria-label="Label source">
              <button type="button" role="tab" aria-selected={addTab === 'projects'} className={addTab === 'projects' ? 'is-active' : ''} onClick={() => setAddTab('projects')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h6l2 2h10v11H3z"/><path d="M3 7V4h7l2 3"/></svg>My Projects
              </button>
              <button type="button" role="tab" aria-selected={addTab === 'setid'} className={addTab === 'setid' ? 'is-active' : ''} onClick={() => setAddTab('setid')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="1"/><path d="M8 2v4M16 2v4M3 9h18"/></svg>Import SET-ID
              </button>
            </div>
            <div className="lc-add-modal__workspace">

            {addTab === 'projects' ? (
                <div className="lc-add-modal__project-workspace">
                    {!session?.is_authenticated ? (
                        <div className="lc-add-modal__empty-state">
                          <p style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>Sign in to access your projects</p>
                            <button className="lc-add-modal__primary-action"
                            onClick={() => openAuthModal('login')}
                            style={{ display: 'inline-block', padding: '10px 24px', background: 'var(--afl-gov-navy)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}
                          >
                            Sign In Now
                          </button>
                        </div>
                    ) : selectedProject ? (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', padding: '0 4px' }}>
                                <button onClick={() => setSelectedProject(null)} style={{ background: 'none', border: 'none', color: 'var(--fdl-blue-700)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                                  Back to Projects
                                </button>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ color: selectedProject.title === 'Favorite' ? 'var(--fdl-amber)' : 'var(--fdl-blue-700)' }}>
                                    {selectedProject.title === 'Favorite' ? (
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                    ) : (
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                    )}
                                  </span>
                                  <h4 style={{ margin: 0, fontWeight: 800, color: 'var(--afl-n-900)' }}>{selectedProject.title}</h4>
                                </div>
                            </div>
                            {loadingLabels ? (
                                <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--afl-n-500)' }}>Loading labels...</p>
                            ) : (
                                    <div style={{ maxHeight: '380px', overflowY: 'auto' }} className="custom-scrollbar lc-add-modal__label-list">
                                    {projectLabels
                                      .filter(label => 
                                        !labelFilter || 
                                        (label.brand_name?.toLowerCase() || '').includes(labelFilter.toLowerCase()) || 
                                        (label.manufacturer_name?.toLowerCase() || '').includes(labelFilter.toLowerCase())
                                      )
                                      .map((label, filteredIndex) => {
                                        const isSelected = selectedLabelsForAdd.find(l => l.set_id === label.set_id);
                                        return (
                                            <button type="button"
                                                key={label.set_id} 
                                                onClick={() => toggleLabelSelection(label)}
                                                aria-pressed={Boolean(isSelected)}
                                                className={`lc-add-modal__label-row${isSelected ? ' is-selected' : ''}`}
                                            >
                                                <span className="lc-add-modal__row-index">{String(filteredIndex + 1).padStart(2, '0')}</span>
                                                <div className="lc-add-modal__row-copy">
                                                    <span className="lc-add-modal__row-name">{label.brand_name}</span>
                                                    <span className="lc-add-modal__row-meta">{label.manufacturer_name || 'Manufacturer not listed'}</span>
                                                </div>
                                                <span className="lc-add-modal__row-state">{isSelected ? 'SELECTED' : 'SELECT'}{isSelected && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6"/></svg>}</span>
                                            </button>
                                        );
                                      })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ maxHeight: '400px', overflowY: 'auto' }} className="custom-scrollbar lc-add-modal__project-list">
                            {loadingProjects ? <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--afl-n-500)' }}>Loading projects...</p> : projects.map(p => (
                                <button type="button"
                                  key={p.id}
                                  onClick={() => fetchProjectLabels(p)}
                                  className="lc-add-modal__project-row"
                                >
                                  <span className={`lc-add-modal__project-icon${p.title === 'Favorite' ? ' is-favorite' : ''}`}>
                                    {p.title === 'Favorite' ? (
                                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                    ) : (
                                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                    )}
                                  </span>
                                  <span className="lc-add-modal__project-copy">
                                    <b>{p.title}</b>
                                    <small>{p.count} labels <i>•</i> {p.role}</small>
                                  </span>
                                  <span className="lc-add-modal__project-arrow">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                  </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="lc-add-modal__setid-panel">
                    <p>
                      Enter the unique SPL SET-ID (UUID) to add a custom labeling.
                    </p>
                    
                    <div className="lc-add-modal__setid-row">
                        <input className="lc-add-modal__setid-input"
                            type="text" 
                            placeholder="e.g. 01e46f58-8bda-4ff3-ab21-..."
                            value={setIdInput}
                            onChange={(e) => setSetIdInput(e.target.value)}
                        />
                        <button type="button" className="lc-add-modal__primary-action"
                            disabled={!setIdInput.trim() || loading}
                            onClick={() => handleAddLabel(setIdInput)}
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}
            </div>
            <footer className="lc-add-modal__footer">
              <span>FDA LABELING CATALOG <b>•</b> Compare up to four labeling records</span>
              <Button variant="secondary" onClick={() => { setShowAddModal(false); setSelectedProject(null); }}>Close</Button>
            </footer>
          </section>
        </div>
      )}

      {/* Favorite Comparison Modal */}
      <Modal
        isOpen={showFavoriteModal}
        onClose={() => setShowFavoriteModal(false)}
        title="Favorite Comparison"
        compact
      >
        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-n-600)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Comparison Title</label>
          <input 
            type="text" 
            value={comparisonTitle}
            onChange={(e) => setComparisonTitle(e.target.value)}
            placeholder="Enter a title for this comparison"
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '10px', 
              border: '1px solid var(--afl-n-200)', 
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
              outline: 'none'
            }}
          />

          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--afl-n-600)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Designated Project</label>
          <select 
            value={targetProjectId || ''}
            onChange={(e) => setTargetProjectId(Number(e.target.value))}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '10px', 
              border: '1px solid var(--afl-n-200)', 
              marginBottom: '2rem',
              fontSize: '0.9rem',
              outline: 'none',
              backgroundColor: 'var(--afl-n-50)'
            }}
          >
            <option value="" disabled>Select a project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={() => setShowFavoriteModal(false)} 
              style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--afl-n-200)', background: 'white', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button 
              onClick={handleSaveFavorite} 
              disabled={savingFavorite || !targetProjectId || !comparisonTitle.trim()}
              style={{ 
                flex: 1, 
                padding: '12px', 
                borderRadius: '8px', 
                border: 'none', 
                background: 'var(--fdl-blue-700)',
                color: 'white', 
                fontWeight: 700, 
                cursor: (savingFavorite || !targetProjectId || !comparisonTitle.trim()) ? 'not-allowed' : 'pointer',
                opacity: (savingFavorite || !targetProjectId || !comparisonTitle.trim()) ? 0.7 : 1
              }}
            >
              {savingFavorite ? 'Saving...' : 'Save to Project'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
            <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '2rem', maxWidth: '400px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
                <div style={{ color: 'var(--fdl-blue-700)', marginBottom: '1.5rem', opacity: 0.8 }}>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><path d="M11 8a2 2 0 0 0-2 2"></path></svg>
                </div>
                <h3 style={{ margin: '0 0 1rem 0', color: 'var(--afl-gov-navy)' }}>Complex Comparison</h3>
                <p style={{ color: 'var(--afl-n-500)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '2rem' }}>
                    You have selected <strong>{selectedLabelsForAdd.length} labels</strong>. Comparing many documents simultaneously may take longer to process. Proceed with analysis?
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={() => setShowConfirmDialog(false)} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--afl-n-200)', background: 'white', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={confirmBulkAdd} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: 'var(--afl-gov-navy)', color: 'white', fontWeight: 700, cursor: 'pointer' }}>Proceed</button>
                </div>
            </div>
        </div>
      )}

      <style jsx global>{`
        .badge-container {
          position: relative;
          display: inline-block;
        }
        .badge-tooltip {
          visibility: hidden;
          width: 220px;
          background-color: var(--afl-n-800);
          color: var(--afl-n-0);
          text-align: center;
          border-radius: 8px;
          padding: 10px 14px;
          position: absolute;
          z-index: 100;
          bottom: 125%;
          left: 50%;
          transform: translateX(-50%) translateY(5px);
          opacity: 0;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-size: 0.8rem;
          line-height: 1.4;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
          pointer-events: none;
        }
        .badge-tooltip::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          margin-left: -6px;
          border-width: 6px;
          border-style: solid;
          border-color: var(--afl-n-800) transparent transparent transparent;
        }
        .badge-container:hover .badge-tooltip {
          visibility: visible;
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: var(--afl-n-50);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--afl-n-300);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--afl-n-400);
        }

        .ai-summary-content h3 { color: var(--afl-gov-navy); margin-top: 0; font-size: 1.25rem; }
        .ai-summary-content h4 { color: var(--afl-gov-blue); margin: 1.5rem 0 0.5rem 0; font-size: 1rem; font-weight: 700; }
        .ai-summary-content ul { padding-left: 1.5rem; margin-bottom: 1rem; }
        .ai-summary-content li { margin-bottom: 0.5rem; }
        .summary-section { margin-bottom: 1.5rem; }

        .diff-table-wrapper { width: 100%; overflow-x: auto; }
        .diff { width: 100%; border-collapse: collapse; font-family: 'Inter', sans-serif; font-size: 0.85rem; }
        .diff td, .diff th { padding: 8px; border: 1px solid var(--afl-n-200); vertical-align: top; }
        .diff_header { background-color: var(--afl-n-100); color: var(--afl-n-500); font-weight: 700; text-align: center; }
        .diff_next { display: none; }
      `}</style>
    </div>
  );
}

export default function LabelCompPage() {
  return (
    <Suspense fallback={<div>Loading Page...</div>}>
      <LabelCompContent />
    </Suspense>
  );
}
