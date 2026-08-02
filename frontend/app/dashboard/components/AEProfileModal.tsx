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
          color: '#64748b', 
          marginBottom: '0.85rem',
          lineHeight: '1.4'
        }}>
          Generate a statistical overview of a specific Adverse Event (AE) across 
          <strong> {projectName}</strong>. Select a MedDRA Preferred Term (PT).
        </p>

        {isGenerating ? (
          <div style={{ padding: '1.5rem 0' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: '#4338ca'
            }}>
              <span>
                {progress < 50 ? 'Phase 1: Scanning labels...' : 'Phase 2: Fetching FAERS data...'}
              </span>
              <span>{progress}%</span>
            </div>
            <div style={{ 
              width: '100%', 
              height: '8px', 
              backgroundColor: '#eef2ff', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${progress}%`, 
                height: '100%', 
                backgroundColor: progress < 50 ? '#6366f1' : '#0ea5e9',
                transition: 'width 0.4s ease'
              }} />
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem', textAlign: 'center' }}>
              {progress < 50 
                ? 'Processing drug labels for text matches in specific sections.' 
                : 'Collecting unique drug counts from openFDA FAERS API.'}
            </p>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
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
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  color: '#ef4444',
                  border: '1px solid #fee2e2',
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
              fontWeight: 800, 
              color: '#475569',
              marginBottom: '0.4rem',
              textTransform: 'uppercase'
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
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '2px solid #e2e8f0',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'border-color 0.2s',
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
                  <div className="loader" style={{ width: '18px', height: '18px', borderTopWidth: '2px', borderLeftWidth: '2px' }} />
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
                  background: 'white',
                  borderRadius: '10px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  border: '1px solid #e2e8f0',
                  marginTop: '4px',
                  zIndex: 100,
                  maxHeight: '280px',
                  overflowY: 'auto'
                }}
              >
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    onClick={() => handleSelectSuggestion(suggestion)}
                    style={{
                      padding: '6px 14px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      color: '#1e293b',
                      borderBottom: index === suggestions.length - 1 ? 'none' : '1px solid #f1f5f9'
                    }}
                    className="suggestion-item"
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateProfile}
                disabled={!searchTerm || loading || isGenerating}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  background: searchTerm ? '#6366f1' : '#e2e8f0',
                  color: 'white',
                  border: 'none',
                  fontWeight: 700,
                  cursor: searchTerm ? 'pointer' : 'not-allowed',
                  boxShadow: searchTerm ? '0 4px 12px rgba(99, 102, 241, 0.2)' : 'none',
                  fontSize: '0.85rem'
                }}
              >
                Analyze AE Profile
              </button>
            </div>
          </div>
        )}

        {existingReports.length > 0 && (
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
            <h4 style={{ 
              fontSize: '0.75rem', 
              fontWeight: 800, 
              color: '#475569', 
              textTransform: 'uppercase',
              marginBottom: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span>📑</span> Previous AE Reports
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
              {existingReports.map((report) => (
                <div 
                  key={report.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {report.target_pt}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatDate(report.created_at)}</div>
                  </div>
                  
                  <div style={{ marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {report.status === 'completed' ? (
                      <a 
                        href={withAppBase(`/dashboard/ae-report/${report.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '4px 10px',
                          background: '#eef2ff',
                          color: '#6366f1',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textDecoration: 'none',
                          border: '1px solid #e0e7ff',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        View
                      </a>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: report.status === 'failed' ? '#ef4444' : '#f59e0b', textTransform: 'capitalize' }}>
                          {report.status} ({report.progress}%)
                        </span>
                        <button
                          onClick={() => handleReanalyze(report.id)}
                          disabled={isGenerating}
                          style={{
                            padding: '2px 8px',
                            background: '#fff',
                            color: '#64748b',
                            borderRadius: '4px',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            border: '1px solid #e2e8f0',
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
                        color: '#94a3b8',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        transition: 'color 0.2s, background 0.2s',
                        marginLeft: '4px'
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.color = '#ef4444')}
                      onMouseOut={(e) => (e.currentTarget.style.color = '#94a3b8')}
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
          background-color: #f8fafc;
          color: #6366f1;
        }
        .loader {
          border: 2px solid #f3f3f3;
          border-radius: 50%;
          border-top: 2px solid #6366f1;
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
