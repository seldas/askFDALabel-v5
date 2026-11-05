'use client';

import { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';

export interface SelectedLabel {
  set_id: string;
  spl_id?: string;
  brand_name?: string;
  generic_name?: string;
  manufacturer_name?: string;
}

interface Project {
  id: number;
  title: string;
  count: number;
  role: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (label: SelectedLabel) => void;
}

export default function SelectLabelModal({ isOpen, onClose, onSelect }: Props) {
  const { session, openAuthModal } = useUser();
  const [tab, setTab] = useState<'projects' | 'setid'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectLabels, setProjectLabels] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [filter, setFilter] = useState('');
  const [manualSetId, setManualSetId] = useState('');
  const [manualSplId, setManualSplId] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSelectedProject(null);
      setFilter('');
      return;
    }
    if (session?.is_authenticated) {
      fetchProjects();
    } else {
      setTab('setid');
    }
  }, [isOpen, session]);

  const fetchProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/dashboard/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
    } finally {
      setLoadingProjects(false);
    }
  };

  const fetchProjectLabels = async (project: Project) => {
    setSelectedProject(project);
    setLoadingLabels(true);
    try {
      const res = await fetch(`/api/dashboard/favorites_data?project_id=${project.id}`);
      if (res.ok) {
        const data = await res.json();
        setProjectLabels(data.favorites || []);
      }
    } catch (e) {
      console.error('Failed to load labels for project:', e);
    } finally {
      setLoadingLabels(false);
    }
  };

  if (!isOpen) return null;

  const handleSelect = (item: any) => {
    onSelect({
      set_id: item.set_id,
      spl_id: item.spl_id,
      brand_name: item.brand_name || 'Selected Label',
      generic_name: item.generic_name,
      manufacturer_name: item.manufacturer_name,
    });
    onClose();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSetId.trim()) return;
    onSelect({
      set_id: manualSetId.trim(),
      spl_id: manualSplId.trim() || undefined,
      brand_name: `Label (${manualSetId.trim().slice(0, 8)}…)`,
    });
    onClose();
  };

  const filteredLabels = projectLabels.filter(label => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      (label.brand_name || '').toLowerCase().includes(q) ||
      (label.generic_name || '').toLowerCase().includes(q) ||
      (label.manufacturer_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="ivr-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ivr-modal" role="dialog" aria-modal="true" aria-labelledby="ivr-modal-title">
        <header className="ivr-modal-header">
          <div>
            <span className="ivr-eyebrow">FDA SPL REFERENCE</span>
            <h2 id="ivr-modal-title">Select Drug Labeling</h2>
            <p>Load labeling content from your dashboard tasks / projects or enter an SPL Set-ID.</p>
          </div>
          <button type="button" className="ivr-modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="ivr-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'projects'}
            className={tab === 'projects' ? 'is-active' : ''}
            onClick={() => setTab('projects')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7h6l2 2h10v11H3z" />
              <path d="M3 7V4h7l2 3" />
            </svg>
            My Tasks & Projects
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'setid'}
            className={tab === 'setid' ? 'is-active' : ''}
            onClick={() => setTab('setid')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="17" rx="1" />
              <path d="M8 2v4M16 2v4M3 9h18" />
            </svg>
            Import SPL Set-ID
          </button>
        </div>

        <div className="ivr-modal-body">
          {tab === 'projects' ? (
            <div className="ivr-modal-projects">
              {!session?.is_authenticated ? (
                <div className="ivr-modal-auth-prompt">
                  <p>Sign in to your account to load drug labels directly from your saved tasks & projects.</p>
                  <button type="button" className="ivr-button ivr-primary" onClick={() => openAuthModal('login')}>
                    Sign In Now
                  </button>
                </div>
              ) : selectedProject ? (
                <div className="ivr-modal-labels-view">
                  <div className="ivr-modal-project-subhead">
                    <button type="button" className="ivr-button" onClick={() => setSelectedProject(null)}>
                      ← Back to Projects
                    </button>
                    <strong>{selectedProject.title}</strong>
                    <span>{projectLabels.length} items</span>
                  </div>

                  <input
                    type="search"
                    className="ivr-modal-search"
                    placeholder="Search by drug name or manufacturer…"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    autoFocus
                  />

                  {loadingLabels ? (
                    <p className="ivr-modal-loading">Loading project labels…</p>
                  ) : filteredLabels.length === 0 ? (
                    <p className="ivr-modal-empty">
                      {projectLabels.length === 0 ? 'No labels saved in this project.' : 'No matching labels found.'}
                    </p>
                  ) : (
                    <div className="ivr-modal-label-list custom-scrollbar">
                      {filteredLabels.map(label => (
                        <button
                          key={label.set_id}
                          type="button"
                          className="ivr-modal-label-row"
                          onClick={() => handleSelect(label)}
                        >
                          <div className="ivr-modal-label-info">
                            <strong>{label.brand_name || 'Unlabeled Product'}</strong>
                            <span>{label.generic_name || ''}</span>
                            <small>{label.manufacturer_name || 'Manufacturer not listed'}</small>
                          </div>
                          <span className="ivr-modal-select-btn">Select →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="ivr-modal-project-list custom-scrollbar">
                  {loadingProjects ? (
                    <p className="ivr-modal-loading">Loading your dashboard tasks…</p>
                  ) : projects.length === 0 ? (
                    <p className="ivr-modal-empty">No projects found. Use "Import SPL Set-ID" or save labels in your dashboard first.</p>
                  ) : (
                    projects.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="ivr-modal-project-row"
                        onClick={() => fetchProjectLabels(p)}
                      >
                        <div className="ivr-modal-project-icon">
                          {p.title === 'Favorite' ? '★' : '📁'}
                        </div>
                        <div className="ivr-modal-project-info">
                          <strong>{p.title}</strong>
                          <span>{p.count} labels saved</span>
                        </div>
                        <span className="ivr-modal-arrow">→</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="ivr-modal-manual-form">
              <label>
                SPL Set-ID (UUID required)
                <input
                  type="text"
                  placeholder="e.g. 01e46f58-8bda-4ff3-ab21-82e70e281541"
                  value={manualSetId}
                  onChange={e => setManualSetId(e.target.value)}
                  autoFocus
                />
              </label>
              <label>
                Version Pin / SPL-ID (optional)
                <input
                  type="text"
                  placeholder="Leave empty for latest available version"
                  value={manualSplId}
                  onChange={e => setManualSplId(e.target.value)}
                />
              </label>
              <div className="ivr-modal-actions">
                <button type="button" className="ivr-button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ivr-button ivr-primary"
                  disabled={!manualSetId.trim()}
                >
                  Load Label
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
