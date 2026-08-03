'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useUser } from '../context/UserContext';
import Header from "../components/Header";
import ProjectSummary, { type ProjectStats } from './components/ProjectSummary';
import AEProfileModal from './components/AEProfileModal';
import Link from 'next/link';
import { Badge, Button, ButtonLink, EmptyState, Input, Select, cx } from '../platform/primitives';
import { ToolLauncher } from '../platform/ToolLauncher';
import { labelRoute, type LaunchContext } from '../platform/context';
import './dashboard.css';
import './selection.css';
import './workspace.css';

interface Project {
  id: number;
  title: string;
  role: string;
  count: number;
  tags?: string[];
  is_default: boolean;
  is_mutable: boolean;
}

interface Favorite {
  id: number;
  set_id: string;
  brand_name: string;
  generic_name: string;
  manufacturer_name: string;
  effective_time: string;
  tag?: string | null;
}

interface Comparison {
  id: number;
  set_ids: string[];
  title: string;
  description: string;
  timestamp: string;
}

type SortMode = 'none' | 'asc' | 'desc';

function TruncatedText({ text, limit = 100 }: { text: string, limit?: number }) {
  if (!text) return <span>—</span>;
  if (text.length <= limit) return <span>{text}</span>;
  return (
    <span title={text} style={{ cursor: 'help' }}>
      {text.slice(0, limit)}...
    </span>
  );
}

function DashboardContent() {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [newImportProjectName, setNewImportProjectName] = useState('');
  const [isDraggingExcel, setIsDraggingExcel] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading, refreshSession, openAuthModal } = useUser();
  const [activeDropdown, setActiveDropdown] = useState<'user' | 'nav' | 'more' | 'analyze' | null>(null);
  const [isInternal, setIsInternal] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Project Management State
  const [showProjects, setShowProjects] = useState(false);
  const [showImportUI, setShowImportUI] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectContent, setProjectLabels] = useState<Favorite[]>([]);
  const [projectComparisons, setProjectComparisons] = useState<Comparison[]>([]);
  const [projectTab, setProjectTab] = useState<'labels' | 'comparisons'>('labels');
  const [loadingContent, setLoadingContent] = useState(false);
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(false);
  const [showAEProfileModal, setShowAEProfileModal] = useState(false);

  // Excel Import UI states
  const [importTargetMode, setImportTargetMode] = useState<'new' | 'existing'>('new');
  const [importTargetProjectId, setImportTargetProjectId] = useState<string>('');
  const [importBatchTags, setImportBatchTags] = useState<string>('');

  // Tag Filtering State
  const [sidebarTagFilter, setSidebarTagFilter] = useState<string>('All');
  const [tableTagFilter, setTableTagFilter] = useState<string>('All');

  // Multi-select for comparison
  const [selectedLabels, setSelectedLabels] = useState<Favorite[]>([]);

  // Load selection from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('comparison_selection');
    if (saved) {
        try {
            setSelectedLabels(JSON.parse(saved));
        } catch (e) {
            console.error("Failed to parse saved selection", e);
        }
    }
  }, []);

  // Save selection to localStorage
  useEffect(() => {
    localStorage.setItem('comparison_selection', JSON.stringify(selectedLabels));
  }, [selectedLabels]);

  const toggleLabelSelection = (label: Favorite) => {
    const isSelected = selectedLabels.some(l => l.set_id === label.set_id);
    if (isSelected) {
        setSelectedLabels(selectedLabels.filter(l => l.set_id !== label.set_id));
    } else {
        if (selectedLabels.length >= 4) {
            alert("You can select up to 4 labels for comparison.");
            return;
        }
        setSelectedLabels([...selectedLabels, label]);
    }
  };

  const removeLabel = (setId: string) => {
    setSelectedLabels(selectedLabels.filter(l => l.set_id !== setId));
  };

  const clearSelections = () => {
    setSelectedLabels([]);
  };

  /* Selected labels as a launch context; the registry builds the tool URLs. */
  const selectionContext = useMemo<LaunchContext>(
    () => ({ setIds: selectedLabels.map(l => l.set_id) }),
    [selectedLabels],
  );

  // Filtering & Pagination State
  const [projectSearch, setProjectSearch] = useState('');
  const [labelPage, setLabelPage] = useState(1);
  const [compPage, setCompPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [effTimeSort, setEffTimeSort] = useState<SortMode>('none');

  useEffect(() => {
    setLabelPage(1);
    setCompPage(1);
  }, [projectSearch]);

  const parseEffTime = (v?: string | null): number | null => {
    if (!v) return null;
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'n/a') return null;
    const normalized = s.replace(/\//g, '-');
    const t = Date.parse(normalized);
    if (!Number.isNaN(t)) return t;
    return null;
  };

  const filteredLabels = useMemo(() => {
    const q = projectSearch.toLowerCase();
    const base = projectContent.filter((f) => {
      const matchesSearch =
        (f.brand_name?.toLowerCase() || '').includes(q) ||
        (f.generic_name?.toLowerCase() || '').includes(q) ||
        (f.manufacturer_name?.toLowerCase() || '').includes(q);
      const matchesTag = tableTagFilter === 'All' || (f.tag && f.tag.split(/[;,]/).map(t => t.trim()).includes(tableTagFilter));
      return matchesSearch && matchesTag;
    });
    if (effTimeSort === 'none') return base;
    const dir = effTimeSort === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const ta = parseEffTime(a.effective_time);
      const tb = parseEffTime(b.effective_time);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return (ta - tb) * dir;
    });
  }, [projectContent, projectSearch, effTimeSort, tableTagFilter]);

  const filteredComparisons = useMemo(() => {
    const q = projectSearch.toLowerCase();
    return projectComparisons.filter(c => 
        (c.title?.toLowerCase() || '').includes(q) || 
        (c.description?.toLowerCase() || '').includes(q)
    );
  }, [projectComparisons, projectSearch]);

  const filteredProjects = useMemo(() => {
    if (sidebarTagFilter === 'All') return projects;
    return projects.filter(p => p.tags && p.tags.some(t => t && t.split(/[;,]/).map(x => x.trim()).includes(sidebarTagFilter)));
  }, [projects, sidebarTagFilter]);

  const allProjectsTags = useMemo(() => {
    const tagsSet = new Set<string>();
    projects.forEach(p => {
      if (p.tags) {
        p.tags.forEach(t => {
          if (t) {
            t.split(/[;,]/).forEach(x => {
              const trimmed = x.trim();
              if (trimmed) tagsSet.add(trimmed);
            });
          }
        });
      }
    });
    return Array.from(tagsSet).sort();
  }, [projects]);

  const activeProjectTags = useMemo(() => {
    const tagsSet = new Set<string>();
    projectContent.forEach(f => {
      if (f.tag) {
        f.tag.split(/[;,]/).forEach(x => {
          const trimmed = x.trim();
          if (trimmed) tagsSet.add(trimmed);
        });
      }
    });
    return Array.from(tagsSet).sort();
  }, [projectContent]);

  const toggleEffTimeSort = () => {
    setEffTimeSort((prev) => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
  };

  const [showProjectStats, setShowProjectStats] = useState(false);
  const [projectStatsLoading, setProjectStatsLoading] = useState(false);
  const [projectStatsError, setProjectStatsError] = useState<string | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);

  const closeProjectStatsModal = useCallback(() => {
    setShowProjectStats(false);
    setProjectStatsError(null);
  }, []);

  const openProjectStatsModal = useCallback(async () => {
    if (!activeProject) return;
    setShowProjectStats(true);
    setProjectStatsError(null);
    setProjectStatsLoading(true);
    try {
      const res = await fetch(`/api/dashboard/project_stats?project_id=${activeProject.id}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) {
        let msg = `Failed to load project statistics (HTTP ${res.status}).`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setProjectStats(data);
    } catch (e: any) {
      setProjectStatsError(e?.message || 'Failed to load project statistics.');
      setProjectStats(null);
    } finally {
      setProjectStatsLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const fetchProjects = async () => {
    setProjectsLoading(true);
    try {
      const res = await fetch('/api/dashboard/projects');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (e) {
      console.error("Failed to fetch projects", e);
    } finally {
      setProjectsLoading(false);
    }
  };

  useEffect(() => {
    if (session?.is_authenticated) {
      fetchProjects();
    }
  }, [session]);

  useEffect(() => {
    const pid = searchParams.get('projectId');
    if (pid && projects.length > 0 && !activeProject) {
        const project = projects.find(p => p.id === parseInt(pid));
        if (project) {
            setActiveProject(project);
        }
    }
  }, [projects, searchParams]);

  const fetchProjectDetail = async (projectId: number) => {
    setLoadingContent(true);
    setProjectSearch('');
    setLabelPage(1);
    setCompPage(1);
    try {
      const res = await fetch(`/api/dashboard/favorites_data?project_id=${projectId}`);
      const data = await res.json();
      setProjectLabels(data.favorites || []);
      setProjectComparisons(data.comparisons || []);
      setDuplicatesRemoved(data.duplicates_removed || false);
    } catch (e) {
      console.error("Failed to fetch project detail", e);
    } finally {
      setLoadingContent(false);
    }
  };

  useEffect(() => {
    if (activeProject) {
      setProjectTab('labels');
      fetchProjectDetail(activeProject.id);
      setTableTagFilter('All');
    }
  }, [activeProject]);

  // Synchronize importTargetProjectId with activeProject
  useEffect(() => {
    if (activeProject) {
      setImportTargetProjectId(activeProject.id.toString());
    }
  }, [activeProject]);

  // Default importTargetProjectId when projects first load
  useEffect(() => {
    if (projects.length > 0 && !importTargetProjectId) {
      setImportTargetProjectId(projects[0].id.toString());
    }
  }, [projects, importTargetProjectId]);

  const handleDeleteProject = async (id: number) => {
    if (!confirm("Are you sure you want to delete this project?")) return;
    try {
      const res = await fetch(`/api/dashboard/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeProject?.id === id) setActiveProject(null);
        fetchProjects();
      }
    } catch (e) {
      alert("Failed to delete project");
    }
  };

  const handleDeleteLabel = async (favId: number) => {
    if (!confirm("Remove this label from task?")) return;
    try {
      const res = await fetch(`/api/dashboard/favorites/${favId}`, { method: 'DELETE' });
      if (res.ok && activeProject) fetchProjectDetail(activeProject.id);
    } catch (e) {
      alert("Delete failed");
    }
  };

  const handleUpdateTag = async (favId: number, setId: string, currentTag: string) => {
    const newTag = prompt("Enter tag for this labeling:", currentTag || "");
    if (newTag === null) return;
    try {
      const res = await fetch('/api/dashboard/update_favorite_tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProject?.id,
          set_id: setId,
          tag: newTag.trim()
        })
      });
      if (res.ok && activeProject) {
        fetchProjectDetail(activeProject.id);
        fetchProjects();
      } else {
        alert("Failed to update tag");
      }
    } catch (e) {
      alert("Error updating tag");
    }
  };

  const handleDeleteComparison = async (compId: number) => {
    if (!confirm("Delete this comparison?")) return;
    try {
      const res = await fetch(`/api/dashboard/comparisons/${compId}`, { method: 'DELETE' });
      if (res.ok && activeProject) fetchProjectDetail(activeProject.id);
    } catch (e) {
      alert("Delete failed");
    }
  };

  const sanitizeFilename = (name: string) => name.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

  const handleExportProject = async (projectId: number, projectTitle: string) => {
    try {
      const res = await fetch(`/api/dashboard/export_project?project_id=${projectId}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(projectTitle || 'project')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { alert('Export failed'); }
  };

  const handleExcelFile = async (file: File) => {
    if (importTargetMode === 'new' && !newImportProjectName.trim()) { alert("Please enter a project name."); return; }
    if (importTargetMode === 'existing' && !importTargetProjectId) { alert("Please select a task."); return; }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/dashboard/import_fdalabel', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        const url = new URL(data.redirect_url, window.location.origin);
        const importId = url.searchParams.get('import_id');
        
        const favBody: any = { import_id: importId };
        if (importTargetMode === 'new') {
          favBody.new_project_name = newImportProjectName;
        } else {
          favBody.project_id = Number(importTargetProjectId);
        }
        if (importBatchTags.trim()) {
          favBody.tags = importBatchTags.trim();
        }

        const favRes = await fetch('/api/dashboard/favorite_all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(favBody)
        });
        const favData = await favRes.json();
        if (favData.success) {
          setNewImportProjectName('');
          setImportBatchTags('');
          setUploadedFile(null);
          setShowImportUI(false);
          
          const targetId = importTargetMode === 'new' ? favData.project_id : Number(importTargetProjectId);
          const projectsRes = await fetch('/api/dashboard/projects');
          const projectsData = await projectsRes.json();
          const updatedProjects: Project[] = projectsData.projects || [];
          setProjects(updatedProjects);
          
          if (targetId) {
            const targetProj = updatedProjects.find(p => p.id === targetId);
            if (targetProj) {
              setActiveProject(targetProj);
            }
          }
        } else if (favData.error) {
          alert(favData.error);
        }
      }
    } catch (error) { alert('Import error'); } finally { setUploading(false); }
  };

  const handleImportButtonClick = () => {
    if (uploadedFile) { handleExcelFile(uploadedFile); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        setUploadedFile(file);
        setNewImportProjectName(prev => prev.trim() ? prev : file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '));
      }
    };
    input.click();
  };

  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingExcel(true); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingExcel(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingExcel(false); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingExcel(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setUploadedFile(file);
      setNewImportProjectName(prev => prev.trim() ? prev : file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '));
    }
  };

  const formatEffectiveTime = (s?: string) => {
    if (!s) return '—';
    const digits = s.replace(/[^\d]/g, '');
    if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : s;
  };

  const paginatedLabels = filteredLabels.slice((labelPage - 1) * ITEMS_PER_PAGE, labelPage * ITEMS_PER_PAGE);
  const paginatedComparisons = filteredComparisons.slice((compPage - 1) * ITEMS_PER_PAGE, compPage * ITEMS_PER_PAGE);

  return (
    <div className="dashboard-container">
      <main className="hp-main-layout" suppressHydrationWarning style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Header activeApp="dashboard" />

        <div className="dashboard-layout" style={{ flex: 1 }}>
          {/* Sidebar: Tasks */}
          <aside className="dashboard-sidebar">
            <div className="workspace-header">
              <h2 className="dash-sidebar-heading">Tasks</h2>
              <p className="dash-sidebar-subheading">{projects.length} tasks</p>
            </div>

            <div className="dash-import-block">
              <button
                className="dash-import-toggle"
                aria-pressed={showImportUI}
                onClick={() => {
                  setShowImportUI(!showImportUI);
                  if (!showImportUI) {
                    if (activeProject) {
                      setImportTargetMode('existing');
                      setImportTargetProjectId(activeProject.id.toString());
                    } else {
                      setImportTargetMode('new');
                    }
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                {showImportUI ? 'Cancel Import' : 'Import Task'}
              </button>

              {showImportUI && (
                <div className="dash-import-panel">

                  {/* Mode Selector */}
                  <div className="dash-mode-selector" role="tablist" aria-label="Import target">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={importTargetMode === 'new'}
                      className="dash-mode-tab"
                      onClick={() => setImportTargetMode('new')}
                    >
                      New Task
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={importTargetMode === 'existing'}
                      className="dash-mode-tab"
                      onClick={() => {
                        setImportTargetMode('existing');
                        if (!importTargetProjectId && projects.length > 0) {
                          setImportTargetProjectId(projects[0].id.toString());
                        }
                      }}
                    >
                      Existing Task
                    </button>
                  </div>

                  {/* New Task Field */}
                  {importTargetMode === 'new' && (
                    <div className="dash-import-field">
                      <label className="dash-import-field__label">Task Name</label>
                      <Input
                        type="text"
                        value={newImportProjectName}
                        onChange={(e) => setNewImportProjectName(e.target.value)}
                        placeholder="e.g. Q1 Labels..."
                      />
                    </div>
                  )}

                  {/* Existing Task Selector */}
                  {importTargetMode === 'existing' && (
                    <div className="dash-import-field">
                      <label className="dash-import-field__label">Select Task</label>
                      <Select
                        style={{ width: '100%' }}
                        value={importTargetProjectId}
                        onChange={(e) => setImportTargetProjectId(e.target.value)}
                      >
                        {projects.length === 0 ? (
                          <option value="">No tasks available</option>
                        ) : (
                          projects.map(p => (
                            <option key={p.id} value={p.id.toString()}>{p.title}</option>
                          ))
                        )}
                      </Select>
                    </div>
                  )}

                  {/* Batch Tags Field */}
                  <div className="dash-import-field">
                    <label className="dash-import-field__label">Batch Tags (Optional)</label>
                    <Input
                      type="text"
                      value={importBatchTags}
                      onChange={(e) => setImportBatchTags(e.target.value)}
                      placeholder="e.g. oncology, FDA 2026..."
                    />
                  </div>

                  {/* Excel File Uploader */}
                  <div className="dash-import-field" style={{ marginBottom: '16px' }}>
                    <label className="dash-import-field__label">FDALabel Excel</label>
                    <button
                      className="dash-file-picker"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.xlsx,.xls';
                        input.onchange = (e: any) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setUploadedFile(file);
                            if (importTargetMode === 'new') {
                              setNewImportProjectName(prev => prev.trim() ? prev : file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '));
                            }
                          }
                        };
                        input.click();
                      }}
                    >
                      {uploadedFile ? uploadedFile.name : 'Choose file...'}
                    </button>
                  </div>

                  {/* Submit Button */}
                  <Button
                    variant="primary"
                    style={{ width: '100%' }}
                    onClick={() => { if(uploadedFile) handleExcelFile(uploadedFile); }}
                    disabled={
                      uploading ||
                      !uploadedFile ||
                      (importTargetMode === 'new' && !newImportProjectName.trim()) ||
                      (importTargetMode === 'existing' && !importTargetProjectId)
                    }
                  >
                    {uploading ? 'Importing...' : importTargetMode === 'new' ? 'Create Task' : 'Import to Task'}
                  </Button>
                </div>
              )}
            </div>

            {/* Tag Filter for Tasks */}
            {allProjectsTags.length > 0 && (
              <div className="dash-tag-filter">
                <label className="dash-import-field__label" style={{ marginBottom: '6px' }}>Filter tasks by tag</label>
                <Select
                  style={{ width: '100%' }}
                  value={sidebarTagFilter}
                  onChange={(e) => setSidebarTagFilter(e.target.value)}
                >
                  <option value="All">All Tags</option>
                  {allProjectsTags.map(tag => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </Select>
              </div>
            )}

            <div className="workspace-list">
              {projectsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}><div className="loader" style={{ width: '30px', height: '30px' }}></div></div>
              ) : filteredProjects.length > 0 ? (
                filteredProjects.map(p => {
                  const isActive = activeProject?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isActive}
                      onClick={() => setActiveProject(isActive ? null : p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveProject(isActive ? null : p);
                        }
                      }}
                      className={cx('project-selection-card', 'dash-project-card')}
                    >
                      <div className="dash-project-card__row">
                        {p.title === 'Favorite' ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="#eab308"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isActive ? "var(--afl-a-500)" : "var(--afl-n-400)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        )}
                        <span className="dash-project-card__title">{p.title}</span>
                      </div>
                      <div className="dash-project-card__meta">{p.count} labels • {p.role.toUpperCase()}</div>
                    </div>
                  );
                })
              ) : (
                <div className="dash-sidebar-empty">
                  {projects.length > 0 ? 'No tasks match selected tag.' : 'No tasks found.'}
                </div>
              )}
            </div>
          </aside>

          {/* Main: Active Workspace or Setup */}
          <main className="dashboard-main">
            {activeProject ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {/* Active Project Hero Header */}
                <div className="active-workspace-hero">
                  <div className="dashboard-header-container">
                    <div>
                      <div className="dash-hero-title-row">
                        <h1 className="dash-hero-title">{activeProject.title}</h1>
                        <Badge tone="accent">{activeProject.role}</Badge>
                      </div>
                      <p className="dash-hero-desc">
                        Task: Managing <strong>{activeProject.count}</strong> pharmaceutical product labels.
                      </p>
                    </div>

                    <div className="dash-hero-actions">
                      <Button variant="secondary" onClick={openProjectStatsModal}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                        Stats
                      </Button>
                      {activeProject.is_mutable && (
                        <>
                          <Button
                            variant="tint-success"
                            onClick={() => {
                              setImportTargetMode('existing');
                              setImportTargetProjectId(activeProject.id.toString());
                              setShowImportUI(true);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            Import Excel
                          </Button>
                          <Button variant="tint-danger" onClick={() => handleDeleteProject(activeProject.id)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Toolbar & Tabs */}
                  <div className="dashboard-toolbar">
                    <div className="dash-tab-group" role="tablist" aria-label="Project view">
                      <button
                        role="tab"
                        aria-selected={projectTab === 'labels'}
                        className="dash-tab"
                        onClick={() => setProjectTab('labels')}
                      >
                        Labels ({filteredLabels.length})
                      </button>
                    </div>

                    <div className="dashboard-toolbar-actions">
                      {activeProjectTags.length > 0 && (
                        <div>
                          <Select
                            value={tableTagFilter}
                            onChange={(e) => setTableTagFilter(e.target.value)}
                          >
                            <option value="All">All Tags</option>
                            {activeProjectTags.map(tag => (
                              <option key={tag} value={tag}>{tag}</option>
                            ))}
                          </Select>
                        </div>
                      )}

                      <div className="dash-search">
                        <Input
                          className="dash-search__input"
                          type="text"
                          placeholder="Filter task content..."
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                        />
                        <svg className="dash-search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                      </div>

                      <div ref={dropdownRef} style={{ position: 'relative' }}>
                        <Button variant="primary" onClick={() => setActiveDropdown(activeDropdown === 'analyze' ? null : 'analyze')}>
                          Export ▼
                        </Button>
                        {activeDropdown === 'analyze' && (
                          <div className="dropdown-menu visible" style={{ right: 0, top: '100%', marginTop: '8px', width: '220px', display: 'block', position: 'absolute', zIndex: 1000 }}>
                            <button className="dropdown-item" onClick={() => { handleExportProject(activeProject.id, activeProject.title); setActiveDropdown(null); }}>to XLSX</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Table Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
                  {projectTab === 'labels' ? (
                    <div>
                      {/* Comparison Selection Banner */}
                      {/*
                        Selected labels form a labelSet context, so the actions
                        come from the tool registry rather than a hardcoded
                        Compare button. Any future multi-label tool shows up
                        here automatically.
                      */}
                      {selectedLabels.length > 0 && (
                        <div className="afl-selection-bar">
                            <div className="afl-selection-bar__queue">
                                <span className="afl-selection-bar__label">
                                    Selected ({selectedLabels.length}/4)
                                </span>
                                {selectedLabels.map(l => (
                                    <span key={l.set_id} className="afl-chip">
                                        <span className="afl-chip__text" title={l.brand_name}>
                                            {l.brand_name || l.set_id}
                                        </span>
                                        <button
                                            type="button"
                                            className="afl-chip__remove"
                                            onClick={() => removeLabel(l.set_id)}
                                            aria-label={`Remove ${l.brand_name || l.set_id} from selection`}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="afl-selection-bar__actions">
                                <Button variant="ghost" size="sm" onClick={clearSelections}>
                                    Reset
                                </Button>
                                {/*
                                  Compare declares both 'label' and 'labelSet',
                                  so it is offered from a single selection too —
                                  labelcomp opens with one slot filled and the
                                  user adds the rest there.
                                */}
                                <ToolLauncher
                                    context={selectionContext}
                                    variant="strip"
                                    matchContexts={['labelSet']}
                                    aria-label="Tools for the selected labels"
                                    emptyState={
                                        <span className="afl-selection-bar__hint">
                                            No tools available for this selection
                                        </span>
                                    }
                                />
                            </div>
                        </div>
                      )}

                      <div className="afl-table-wrap">
                        <table className="afl-table" style={{ minWidth: '750px' }}>
                          <thead>
                            <tr>
                              <th style={{ width: '40px' }}></th>
                              <th>Product Name</th>
                              <th>Manufacturer</th>
                              <th
                                  aria-sort={effTimeSort === 'asc' ? 'ascending' : effTimeSort === 'desc' ? 'descending' : 'none'}
                                  onClick={toggleEffTimeSort}
                              >
                                  Effective Time {effTimeSort === 'asc' ? '↑' : effTimeSort === 'desc' ? '↓' : '↕'}
                              </th>
                              <th>Tag</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedLabels.map((item, idx) => {
                              const isSelected = selectedLabels.some(l => l.set_id === item.set_id);
                              return (
                                <tr key={`${item.set_id}-${idx}`} data-selected={isSelected}>
                                  <td style={{ textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleLabelSelection(item)}
                                      style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--afl-a-500)' }}
                                    />
                                  </td>
                                  <td>
                                    <Link href={labelRoute(item.set_id)} style={{ fontWeight: 700, color: 'var(--afl-text-primary)', textDecoration: 'none' }}>
                                        <TruncatedText text={item.brand_name || 'N/A'} />
                                    </Link>
                                    <div style={{ fontSize: 'var(--afl-text-xs)', color: 'var(--afl-text-muted)', marginTop: '2px' }}>
                                        <TruncatedText text={item.generic_name || ''} limit={120} />
                                    </div>
                                  </td>
                                  <td>{item.manufacturer_name || 'N/A'}</td>
                                  <td>{formatEffectiveTime(item.effective_time)}</td>
                                  <td>
                                    {item.tag ? (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                        {item.tag.split(/[;,]/).map(t => t.trim()).filter(Boolean).map((t, idx) => (
                                          <span
                                            key={idx}
                                            className="dash-tag-chip"
                                            onClick={() => handleUpdateTag(item.id, item.set_id, item.tag || '')}
                                          >
                                            🏷️ {t}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <button
                                        className="dash-tag-add"
                                        onClick={() => handleUpdateTag(item.id, item.set_id, '')}
                                      >
                                        + Tag
                                      </button>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                      <ButtonLink
                                        href={labelRoute(item.set_id)}
                                        variant="primary"
                                        size="sm"
                                      >
                                        Open
                                      </ButtonLink>
                                      <button
                                        className="dash-row-delete"
                                        onClick={() => handleDeleteLabel(item.id)}
                                        title="Remove from Task"
                                      >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H5c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination Toolbar (Labels) */}
                      {filteredLabels.length > ITEMS_PER_PAGE && (
                        <div className="afl-pagination">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={labelPage === 1}
                            onClick={() => setLabelPage(p => Math.max(1, p - 1))}
                          >
                            Previous
                          </Button>
                          <span className="afl-pagination__status">
                            Page {labelPage} of {Math.ceil(filteredLabels.length / ITEMS_PER_PAGE)}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={labelPage >= Math.ceil(filteredLabels.length / ITEMS_PER_PAGE)}
                            onClick={() => setLabelPage(p => p + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p>TO BE DEVELOPED</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 'var(--afl-space-7)' }}>
                <EmptyState
                  style={{ maxWidth: '440px' }}
                  icon={
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                  }
                  title="No Task Selected"
                  description="Select a task from the sidebar to view the labeling list, or import a new task."
                />
              </div>
            )}
          </main>
        </div>

        {/* Global Dashboard Modals */}
        <ProjectSummary
          open={showProjectStats}
          onClose={closeProjectStatsModal}
          projectTitle={activeProject?.title || ''}
          projectRole={activeProject?.role || ''}
          loading={projectStatsLoading}
          error={projectStatsError}
          stats={projectStats}
          formatEffectiveTime={formatEffectiveTime}
        />
        <AEProfileModal
          isOpen={showAEProfileModal}
          onClose={() => setShowAEProfileModal(false)}
          projectId={activeProject?.id || 0}
          projectName={activeProject?.title || ''}
        />
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--afl-bg-page)' }}>
        <div className="loader"></div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
