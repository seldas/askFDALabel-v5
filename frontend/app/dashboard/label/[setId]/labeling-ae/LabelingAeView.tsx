'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './labeling-ae.css';

interface LabelingAeViewProps {
  setId: string;
  splId?: string | null;
  labelMeta?: any;
}

interface ApiResponse {
  status: 'success' | 'not_found' | 'unreachable' | 'error';
  set_id: string;
  server?: string;
  target_url?: string;
  data?: any;
  error?: string;
}

const SAMPLE_DEMO_DATA = {
  model_version: 'LabelingAE-v2.1',
  timestamp: new Date().toISOString(),
  total_annotations: 8,
  confidence_threshold: 0.85,
  sections_analyzed: ['BOXED WARNING', 'WARNINGS AND PRECAUTIONS', 'ADVERSE REACTIONS'],
  annotations: [
    {
      id: 'ae-001',
      term: 'Hepatotoxicity',
      meddra_pt: 'Hepatic failure',
      soc: 'Hepatobiliary disorders',
      section: 'BOXED WARNING',
      severity: 'Severe',
      confidence: 0.98,
      excerpt: 'Severe and sometimes fatal hepatotoxicity has occurred with this drug.'
    },
    {
      id: 'ae-002',
      term: 'QT Prolongation',
      meddra_pt: 'Electrocardiogram QT prolonged',
      soc: 'Cardiac disorders',
      section: 'WARNINGS AND PRECAUTIONS',
      severity: 'Moderate',
      confidence: 0.94,
      excerpt: 'Patients should be monitored for QT prolongation and ventricular arrhythmias.'
    },
    {
      id: 'ae-003',
      term: 'Nausea',
      meddra_pt: 'Nausea',
      soc: 'Gastrointestinal disorders',
      section: 'ADVERSE REACTIONS',
      severity: 'Mild',
      confidence: 0.99,
      excerpt: 'The most commonly reported adverse reaction was nausea occurring in 24% of patients.'
    },
    {
      id: 'ae-004',
      term: 'Headache',
      meddra_pt: 'Headache',
      soc: 'Nervous system disorders',
      section: 'ADVERSE REACTIONS',
      severity: 'Mild',
      confidence: 0.97,
      excerpt: 'Headache was reported in 18% of clinical trial participants.'
    },
    {
      id: 'ae-005',
      term: 'Thrombocytopenia',
      meddra_pt: 'Platelet count decreased',
      soc: 'Blood and lymphatic system disorders',
      section: 'WARNINGS AND PRECAUTIONS',
      severity: 'Moderate',
      confidence: 0.91,
      excerpt: 'Dose reduction is recommended in cases of persistent thrombocytopenia.'
    },
    {
      id: 'ae-006',
      term: 'Acute Kidney Injury',
      meddra_pt: 'Renal failure acute',
      soc: 'Renal and urinary disorders',
      section: 'WARNINGS AND PRECAUTIONS',
      severity: 'Severe',
      confidence: 0.95,
      excerpt: 'Cases of acute kidney injury requiring hemodialysis have been reported postmarketing.'
    }
  ]
};

export default function LabelingAeView({ setId, splId, labelMeta }: LabelingAeViewProps) {
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'smart' | 'json'>('smart');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArrayKey, setSelectedArrayKey] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  const fetchAnnotations = useCallback(async () => {
    setLoading(true);
    setIsDemo(false);
    try {
      const res = await fetch(`/api/dashboard/labeling_ae/${encodeURIComponent(setId)}`);
      const json: ApiResponse = await res.json().catch(() => ({
        status: 'error',
        set_id: setId,
        error: `HTTP ${res.status}: Failed to parse JSON response`
      }));
      setResponse(json);
    } catch (err) {
      setResponse({
        status: 'unreachable',
        set_id: setId,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setLoading(false);
    }
  }, [setId]);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  const loadDemo = () => {
    setResponse({
      status: 'success',
      set_id: setId,
      server: 'http://ncslphpcgpu02:8809 (Demo Preview)',
      target_url: `http://ncslphpcgpu02:8809/v1/safety/labels/${setId}/annotations`,
      data: SAMPLE_DEMO_DATA
    });
    setIsDemo(true);
  };

  const payload = response?.data;

  // Inspect payload to identify arrays of items and scalar metadata
  const { arrayKeys, scalarEntries, rootArray } = useMemo(() => {
    if (!payload) return { arrayKeys: [], scalarEntries: [], rootArray: null };

    if (Array.isArray(payload)) {
      return { arrayKeys: ['root'], scalarEntries: [], rootArray: payload };
    }

    if (typeof payload === 'object') {
      const arrKeys: string[] = [];
      const scalars: Array<[string, any]> = [];

      Object.entries(payload).forEach(([key, val]) => {
        if (Array.isArray(val)) {
          arrKeys.push(key);
        } else if (val !== null && typeof val !== 'object') {
          scalars.push([key, val]);
        }
      });

      return { arrayKeys: arrKeys, scalarEntries: scalars, rootArray: null };
    }

    return { arrayKeys: [], scalarEntries: [], rootArray: null };
  }, [payload]);

  // Set default active array key
  useEffect(() => {
    if (rootArray) {
      setSelectedArrayKey('root');
    } else if (arrayKeys.length > 0 && (!selectedArrayKey || !arrayKeys.includes(selectedArrayKey))) {
      setSelectedArrayKey(arrayKeys[0]);
    }
  }, [arrayKeys, rootArray, selectedArrayKey]);

  // Current active collection
  const activeItems: any[] = useMemo(() => {
    if (rootArray) return rootArray;
    if (!payload || !selectedArrayKey) return [];
    const val = payload[selectedArrayKey];
    return Array.isArray(val) ? val : [];
  }, [payload, selectedArrayKey, rootArray]);

  // Columns for the active collection
  const columns = useMemo(() => {
    if (!activeItems || activeItems.length === 0) return [];
    const colSet = new Set<string>();
    activeItems.slice(0, 50).forEach((item) => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach((k) => colSet.add(k));
      }
    });
    return Array.from(colSet);
  }, [activeItems]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return activeItems;
    const q = searchQuery.toLowerCase();
    return activeItems.filter((item) => {
      if (item == null) return false;
      if (typeof item !== 'object') return String(item).toLowerCase().includes(q);
      return Object.values(item).some((v) =>
        String(v != null && typeof v === 'object' ? JSON.stringify(v) : v)
          .toLowerCase()
          .includes(q)
      );
    });
  }, [activeItems, searchQuery]);

  const handleCopyJson = () => {
    if (!payload) return;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const drugTitle = labelMeta?.brand_name || labelMeta?.drug_name || setId;

  return (
    <div className="afl-ae-container">
      {/* Top Header */}
      <div className="afl-ae-header">
        <div className="afl-ae-header__title-group">
          <h2 className="afl-ae-header__title">
            <span>LabelingAE</span>
            <span className="afl-ae-beta-badge">beta</span>
            {isDemo && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: '6px' }}>
                Preview Mode
              </span>
            )}
          </h2>
          <p className="afl-ae-header__subtitle">
            <span>Server:</span>
            <span className="afl-ae-server-pill">
              {response?.server || 'http://ncslphpcgpu02:8809'}
            </span>
            <span>· Product:</span>
            <strong style={{ color: '#0f172a' }}>{drugTitle}</strong>
          </p>
        </div>

        <div className="afl-ae-header__actions">
          <div className="afl-ae-tabs">
            <button
              className={`afl-ae-tab ${activeTab === 'smart' ? 'afl-ae-tab--active' : ''}`}
              onClick={() => setActiveTab('smart')}
            >
              Smart View
            </button>
            <button
              className={`afl-ae-tab ${activeTab === 'json' ? 'afl-ae-tab--active' : ''}`}
              onClick={() => setActiveTab('json')}
            >
              Raw JSON
            </button>
          </div>

          <button
            className="afl-ae-btn afl-ae-btn--secondary"
            onClick={fetchAnnotations}
            disabled={loading}
            title="Refresh annotations from server"
          >
            {loading ? 'Fetching…' : '↻ Refresh'}
          </button>

          {payload && (
            <button
              className="afl-ae-btn afl-ae-btn--secondary"
              onClick={handleCopyJson}
              title="Copy JSON to clipboard"
            >
              {copied ? '✓ Copied' : '⧉ Copy JSON'}
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="afl-ae-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', marginBottom: '8px' }}>⚡</div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>Connecting to LabelingAE Server…</div>
          <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '4px' }}>
            Calling <code>/v1/safety/labels/{setId}/annotations</code>
          </div>
        </div>
      )}

      {/* Offline / Unreachable Banner */}
      {!loading && response?.status === 'unreachable' && (
        <div className="afl-ae-banner afl-ae-banner--warn">
          <div className="afl-ae-banner__title">
            <span>⚠</span>
            <span>External LabelingAE Server Unreachable</span>
          </div>
          <div className="afl-ae-banner__content">
            <p style={{ margin: '0 0 8px 0' }}>
              Could not reach the safety annotation server at{' '}
              <strong>{response.server || 'http://ncslphpcgpu02:8809'}</strong>.
            </p>
            <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem', opacity: 0.9 }}>
              Details: <code>{response.error}</code>
            </p>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
              <button
                className="afl-ae-btn afl-ae-btn--secondary"
                onClick={fetchAnnotations}
              >
                Retry Connection
              </button>
              <button
                className="afl-ae-btn afl-ae-btn--primary"
                onClick={loadDemo}
              >
                Load Demo / Preview Annotations
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Not Found Banner */}
      {!loading && response?.status === 'not_found' && (
        <div className="afl-ae-banner afl-ae-banner--info">
          <div className="afl-ae-banner__title">
            <span>ℹ</span>
            <span>No Annotations Found For This Label</span>
          </div>
          <div className="afl-ae-banner__content">
            <p style={{ margin: '0 0 8px 0' }}>
              The LabelingAE server connected successfully, but no safety annotations are currently recorded for Set ID <code>{setId}</code>.
            </p>
            <button
              className="afl-ae-btn afl-ae-btn--primary"
              onClick={loadDemo}
              style={{ marginTop: '6px' }}
            >
              Load Demo / Preview Annotations
            </button>
          </div>
        </div>
      )}

      {/* General Error Banner */}
      {!loading && response?.status === 'error' && (
        <div className="afl-ae-banner afl-ae-banner--error">
          <div className="afl-ae-banner__title">
            <span>✕</span>
            <span>Error Fetching Annotations</span>
          </div>
          <div className="afl-ae-banner__content">
            <p style={{ margin: 0 }}>{response.error}</p>
          </div>
        </div>
      )}

      {/* Data Visualization */}
      {!loading && payload && (
        <>
          {/* Metrics summary cards */}
          <div className="afl-ae-metrics">
            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Active Collection</div>
              <div className="afl-ae-metric-card__value">
                {activeItems.length}
              </div>
              <div className="afl-ae-metric-card__sub">
                {selectedArrayKey || 'Items'}
              </div>
            </div>

            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Total Fields</div>
              <div className="afl-ae-metric-card__value">
                {typeof payload === 'object' ? Object.keys(payload).length : 1}
              </div>
              <div className="afl-ae-metric-card__sub">Top-level keys</div>
            </div>

            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Identified Collections</div>
              <div className="afl-ae-metric-card__value">
                {arrayKeys.length || (rootArray ? 1 : 0)}
              </div>
              <div className="afl-ae-metric-card__sub">Array structures</div>
            </div>

            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Set ID</div>
              <div className="afl-ae-metric-card__value" style={{ fontSize: '0.9rem', fontFamily: 'monospace' }}>
                {setId.slice(0, 14)}…
              </div>
              <div className="afl-ae-metric-card__sub">Target label</div>
            </div>
          </div>

          {/* Scalar parameters grid if any */}
          {scalarEntries.length > 0 && (
            <div className="afl-ae-card">
              <div className="afl-ae-card__header">
                <h3 className="afl-ae-card__title">Metadata & Parameters</h3>
              </div>
              <div className="afl-ae-kv-grid">
                {scalarEntries.map(([k, v]) => (
                  <div key={k} className="afl-ae-kv-item">
                    <div className="afl-ae-kv-key">{k.replace(/_/g, ' ')}</div>
                    <div className="afl-ae-kv-val">{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Smart View (Tables & Cards) */}
          {activeTab === 'smart' && (
            <div className="afl-ae-card">
              <div className="afl-ae-card__header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <h3 className="afl-ae-card__title">
                    Extracted Annotations & Entities
                  </h3>

                  {/* Switch between collections if multiple arrays exist */}
                  {arrayKeys.length > 1 && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {arrayKeys.map((k) => (
                        <button
                          key={k}
                          onClick={() => setSelectedArrayKey(k)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            border: '1px solid #cbd5e1',
                            background: selectedArrayKey === k ? '#8b5cf6' : '#ffffff',
                            color: selectedArrayKey === k ? '#ffffff' : '#475569',
                            cursor: 'pointer'
                          }}
                        >
                          {k} ({Array.isArray(payload[k]) ? payload[k].length : 0})
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    className="afl-ae-search-input"
                    placeholder="Filter records…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                    {filteredItems.length} of {activeItems.length}
                  </span>
                </div>
              </div>

              {activeItems.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                  No items found in this section.
                </div>
              ) : columns.length > 0 ? (
                <div className="afl-ae-table-wrap">
                  <table className="afl-ae-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        {columns.map((col) => (
                          <th key={col}>{col.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>
                          {columns.map((col) => {
                            const val = item?.[col];
                            return (
                              <td key={col}>
                                {val == null ? (
                                  <span style={{ color: '#cbd5e1' }}>—</span>
                                ) : typeof val === 'object' ? (
                                  <span className="afl-ae-tag">
                                    {JSON.stringify(val).slice(0, 40)}…
                                  </span>
                                ) : col.toLowerCase().includes('confidence') || col.toLowerCase().includes('score') ? (
                                  <span style={{ fontWeight: 700, color: '#059669' }}>
                                    {typeof val === 'number' ? `${(val * 100).toFixed(1)}%` : String(val)}
                                  </span>
                                ) : col.toLowerCase().includes('severity') ? (
                                  <span
                                    style={{
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 800,
                                      background:
                                        String(val).toLowerCase() === 'severe'
                                          ? '#fee2e2'
                                          : String(val).toLowerCase() === 'moderate'
                                          ? '#fef3c7'
                                          : '#ecfdf5',
                                      color:
                                        String(val).toLowerCase() === 'severe'
                                          ? '#991b1b'
                                          : String(val).toLowerCase() === 'moderate'
                                          ? '#92400e'
                                          : '#065f46'
                                    }}
                                  >
                                    {String(val)}
                                  </span>
                                ) : (
                                  <span>{String(val)}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: '20px' }}>
                  <pre style={{ margin: 0, fontSize: '0.82rem' }}>
                    {JSON.stringify(filteredItems, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Raw JSON Tree View */}
          {activeTab === 'json' && (
            <div className="afl-ae-card">
              <div className="afl-ae-card__header">
                <h3 className="afl-ae-card__title">Payload Inspector</h3>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Full response from {response?.target_url || response?.server}
                </span>
              </div>
              <div style={{ padding: '16px' }}>
                <pre className="afl-ae-json-box">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
