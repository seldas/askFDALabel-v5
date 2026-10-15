'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '../../components/Modal';
import { debounce } from 'lodash';
import { useUser } from '../../context/UserContext';

import { withAppBase } from '../../utils/appPaths';

interface AEProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  projectName: string;
}

interface AEReport {
  id: number;
  target_pt: string;
  status: string;
  progress: number;
  created_at: string;
}

export default function AEProfileModal({ isOpen, onClose, projectId, projectName }: AEProfileModalProps) {
  const { activeTasks, refreshTasks } = useUser();
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);

  // Report Generation State
  const [existingReports, setExistingReports] = useState<AEReport[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentReportId, setCurrentReportId] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [reportStatus, setReportStatus] = useState<string | null>(null);

  const fetchExistingReports = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/dashboard/ae_report/list/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setExistingReports(data);
        
        // Check if any report in THIS project is already generating
        const activeInThisProject = data.find((r: any) => r.status === 'processing' || r.status === 'pending');
        if (activeInThisProject && !isGenerating) {
          setIsGenerating(true);
          setCurrentReportId(activeInThisProject.id);
          setSearchTerm(activeInThisProject.target_pt);
        }
      }
    } catch (error) {
      console.error('Failed to fetch existing AE reports:', error);
    }
  }, [projectId, isGenerating]);

  // Sync progress from global activeTasks if available
  useEffect(() => {
    if (isGenerating && currentReportId) {
      const globalTask = activeTasks.find(t => t.id === currentReportId);
      if (globalTask) {
        setProgress(globalTask.progress);
        setReportStatus(globalTask.status);
      } else if (reportStatus === 'processing' || reportStatus === 'pending') {
        // If it's not in activeTasks anymore but was processing, it might have finished or failed
        fetchExistingReports();
      }
    }
  }, [activeTasks, isGenerating, currentReportId, reportStatus, fetchExistingReports]);

  useEffect(() => {
    if (isOpen) {
      fetchExistingReports();
      if (!isGenerating) {
        setSearchTerm('');
        setCurrentReportId(null);
        setProgress(0);
        setReportStatus(null);
      }
    }
  }, [isOpen, fetchExistingReports, isGenerating]);

  // Polling for status - fallback if UserContext polling is slow or if we want faster updates here
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating && currentReportId) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/dashboard/ae_report/status/${currentReportId}`);
          if (res.ok) {
            const data = await res.json();
            setProgress(data.progress);
            setReportStatus(data.status);
            if (data.status === 'completed' || data.status === 'failed') {
              setIsGenerating(false);
              fetchExistingReports();
              refreshTasks(); // Update global state too
            }
          }
        } catch (error) {
          console.error('Error polling report status:', error);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [isGenerating, currentReportId, fetchExistingReports, refreshTasks]);

  const fetchSuggestions = useCallback(
    debounce(async (query: string) => {
      if (query.length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/dashboard/meddra/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShowSuggestions(true);
        }
      } catch (error) {
        console.error('Failed to fetch MedDRA suggestions:', error);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    if (searchTerm) {
      fetchSuggestions(searchTerm);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchTerm, fetchSuggestions]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSuggestion = (suggestion: string) => {
    setSearchTerm(suggestion);
    setShowSuggestions(false);
  };

  const handleGenerateProfile = async () => {
    if (!searchTerm || isGenerating) return;
    setIsGenerating(true);
    setProgress(0);
    setReportStatus('pending');

    try {
      const res = await fetch('/api/dashboard/ae_report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, target_pt: searchTerm })
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentReportId(data.report_id);
      } else {
        setIsGenerating(false);
        alert('Failed to start AE profile generation.');
      }
    } catch (error) {
      console.error('Failed to generate AE profile:', error);
      setIsGenerating(false);
    }
  };

  const handleReanalyze = async (reportId: number) => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    setCurrentReportId(reportId);
    setProgress(0);
    setReportStatus('pending');

    try {
      const res = await fetch(`/api/dashboard/ae_report/reanalyze/${reportId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        let errorMsg = 'Failed to restart AE profile generation.';
        try {
          const data = await res.json();
          if (data.error) errorMsg = data.error;
        } catch (e) {}
        
        setIsGenerating(false);
        setCurrentReportId(null);
        alert(errorMsg);
      }
    } catch (error) {
      console.error('Failed to re-analyze AE profile:', error);
      setIsGenerating(false);
      setCurrentReportId(null);
      alert('Network error occurred while restarting analysis.');
    }
  };

  const handleDeleteReport = async (e: React.MouseEvent, reportId: number) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this AE report?')) return;

    try {
      const res = await fetch(`/api/dashboard/ae_report/delete/${reportId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchExistingReports();
      } else {
        let errorMsg = 'Failed to delete report.';
        try {
          const data = await res.json();
          if (data.error) errorMsg = data.error;
        } catch (e) {}
        alert(errorMsg);
      }
    } catch (error) {
      console.error('Failed to delete report:', error);
      alert('Network error occurred while deleting report.');
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AE Profile Generation" compact>
      <div>
        <p style={{ 
          fontSize: '0.82rem', 
          color: 'var(--fdl-muted, #5e6e7c)', 
          marginBottom: '0.85rem',
          lineHeight: '1.45'
        }}>
          Generate a statistical overview of a specific Adverse Event (AE) across 
          <strong> {projectName}</strong>. Select a MedDRA Preferred Term (PT).
        </p>

        {isGenerating ? (
          <div style={{ padding: '1.25rem 0' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '0.5rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: 'var(--fdl-navy-800, #12375b)'
            }}>
              <span>
                {progress < 50 ? 'Phase 1: Scanning labels...' : 'Phase 2: Fetching FAERS data...'}
              </span>
              <span>{progress}%</span>
            </div>
            <div style={{ 
              width: '100%', 
              height: '6px', 
              backgroundColor: 'var(--fdl-blue-100, #dcecf8)', 
              borderRadius: '0',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${progress}%`, 
                height: '100%', 
                backgroundColor: 'var(--fdl-blue-600, #0071bc)',
                transition: 'width 0.4s ease'
              }} />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--fdl-muted, #5e6e7c)', marginTop: '0.5rem', textAlign: 'center' }}>
              {progress < 50 
                ? 'Processing drug labels for text matches in specific sections.' 
                : 'Collecting unique drug counts from openFDA FAERS API.'}
            </p>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center', gap: '8px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  background: 'var(--fdl-paper, #ffffff)',
                  color: 'var(--fdl-ink-soft, #273843)',
                  border: '1px solid var(--fdl-line, #b8c8d7)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                Minimize & Continue
              </button>
              <button
                onClick={async () => {
                  if (confirm('Stop this analysis? Progress will be lost.')) {
                    await fetch(`/api/dashboard/ae_report/delete/${currentReportId}`, { method: 'DELETE' });
                    setIsGenerating(false);
                    setCurrentReportId(null);
                    fetchExistingReports();
                    refreshTasks();
                  }
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  background: 'var(--fdl-red-050, #fff1f1)',
                  color: 'var(--fdl-red, #b50909)',
                  border: '1px solid #fca5a5',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                Stop Analysis
              </button>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '0.75rem', 
              fontWeight: 700, 
              color: 'var(--fdl-navy-800, #12375b)',
              marginBottom: '0.4rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}>
              Target MedDRA Preferred Term
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="e.g., Acute Kidney Injury"
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  minHeight: '34px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  border: '1px solid var(--fdl-line, #b8c8d7)',
                  fontSize: '0.85rem',
                  outline: 'none',
                  backgroundColor: 'var(--fdl-paper, #ffffff)',
                  color: 'var(--fdl-ink, #132332)',
                  boxSizing: 'border-box'
                }}
                onFocus={() => searchTerm.length >= 2 && setShowSuggestions(true)}
              />
              {loading && (
                <div style={{ 
                  position: 'absolute', 
                  right: '12px', 
                  top: '50%', 
                  transform: 'translateY(-50%)' 
                }}>
                  <div className="loader" style={{ width: '16px', height: '16px', borderTopWidth: '2px', borderLeftWidth: '2px' }} />
                </div>
              )}
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <div 
                ref={suggestionRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'var(--fdl-paper, #ffffff)',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  boxShadow: '0 8px 16px rgba(7, 31, 61, 0.12)',
                  border: '1px solid var(--fdl-line, #b8c8d7)',
                  marginTop: '2px',
                  zIndex: 100,
                  maxHeight: '240px',
                  overflowY: 'auto'
                }}
              >
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    onClick={() => handleSelectSuggestion(suggestion)}
                    style={{
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      color: 'var(--fdl-ink, #132332)',
                      borderBottom: index === suggestions.length - 1 ? 'none' : '1px solid var(--fdl-line-soft, #d7e0e7)'
                    }}
                    className="suggestion-item"
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  background: 'var(--fdl-paper, #ffffff)',
                  color: 'var(--fdl-ink-soft, #273843)',
                  border: '1px solid var(--fdl-line, #b8c8d7)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.82rem'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateProfile}
                disabled={!searchTerm || loading || isGenerating}
                style={{
                  padding: '6px 18px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  background: searchTerm ? 'var(--fdl-blue-700, #0759a5)' : 'var(--fdl-line-soft, #d7e0e7)',
                  color: 'var(--fdl-paper, #ffffff)',
                  border: `1px solid ${searchTerm ? 'var(--fdl-blue-700, #0759a5)' : 'var(--fdl-line, #b8c8d7)'}`,
                  fontWeight: 700,
                  cursor: searchTerm ? 'pointer' : 'not-allowed',
                  fontSize: '0.82rem'
                }}
              >
                Analyze AE Profile
              </button>
            </div>
          </div>
        )}

        {existingReports.length > 0 && (
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--fdl-line-soft, #d7e0e7)', paddingTop: '0.85rem' }}>
            <h4 style={{ 
              fontSize: '0.72rem', 
              fontWeight: 800, 
              color: 'var(--fdl-navy-800, #12375b)', 
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '0.65rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span>📑</span> Previous AE Reports
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
              {existingReports.map((report) => (
                <div 
                  key={report.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    background: 'var(--fdl-canvas, #f3f6f8)',
                    borderRadius: 'var(--fdl-radius-sm, 2px)',
                    border: '1px solid var(--fdl-line-soft, #d7e0e7)'
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--fdl-navy-950, #071f3d)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {report.target_pt}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--fdl-muted, #5e6e7c)' }}>{formatDate(report.created_at)}</div>
                  </div>
                  
                  <div style={{ marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {report.status === 'completed' ? (
                      <a 
                        href={withAppBase(`/dashboard/ae-report/${report.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '3px 8px',
                          background: 'var(--fdl-blue-050, #edf4fa)',
                          color: 'var(--fdl-blue-700, #0759a5)',
                          borderRadius: 'var(--fdl-radius-sm, 2px)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textDecoration: 'none',
                          border: '1px solid var(--fdl-line, #b8c8d7)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        View
                      </a>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: report.status === 'failed' ? 'var(--fdl-red, #b50909)' : 'var(--fdl-amber, #8a5700)', textTransform: 'capitalize' }}>
                          {report.status} ({report.progress}%)
                        </span>
                        <button
                          onClick={() => handleReanalyze(report.id)}
                          disabled={isGenerating}
                          style={{
                            padding: '2px 6px',
                            background: 'var(--fdl-paper, #ffffff)',
                            color: 'var(--fdl-ink-soft, #273843)',
                            borderRadius: 'var(--fdl-radius-sm, 2px)',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            border: '1px solid var(--fdl-line, #b8c8d7)',
                            cursor: isGenerating ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {report.status === 'processing' ? 'Restart' : 'Re-analyze'}
                        </button>
                      </div>
                    )}
                    
                    <button
                      onClick={(e) => handleDeleteReport(e, report.id)}
                      style={{
                        padding: '4px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--fdl-muted, #5e6e7c)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 'var(--fdl-radius-sm, 2px)',
                        marginLeft: '4px'
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.color = 'var(--fdl-red, #b50909)')}
                      onMouseOut={(e) => (e.currentTarget.style.color = 'var(--fdl-muted, #5e6e7c)')}
                      title="Delete report"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .suggestion-item:hover {
          background-color: var(--fdl-blue-050, #edf4fa);
          color: var(--fdl-blue-700, #0759a5);
        }
        .loader {
          border: 2px solid var(--fdl-line-soft, #d7e0e7);
          border-radius: 50%;
          border-top: 2px solid var(--fdl-blue-600, #0071bc);
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </Modal>
  );
}
