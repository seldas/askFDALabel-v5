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

const INLINE_FALLBACK_DATA = {
  model_version: 'LabelingAE-v2.1',
  timestamp: new Date().toISOString(),
  summary: {
    annotation_count: 6,
    meddra_adverse_reactions: 4,
    rxbert_adverse_reactions: 2,
    section_count: 3
  },
  annotations: [
    {
      id: 'ann_000001',
      term: 'Hepatotoxicity',
      display_classification: 'MedDRA Adverse Reaction',
      coding: {
        name: 'Hepatic failure',
        code: '10019663',
        soc_name: 'Hepatobiliary disorders'
      },
      section: {
        observed_section_name: 'BOXED WARNING',
        name: 'BOXED WARNING'
      },
      source: { annotator: 'meddra_exact_matcher' },
      confidence: 1.0,
      start: 120,
      end: 134
    },
    {
      id: 'ann_000002',
      term: 'QT Prolongation',
      display_classification: 'RxBERT Adverse Reaction',
      coding: {
        name: 'Electrocardiogram QT prolonged',
        code: '10014387',
        soc_name: 'Cardiac disorders'
      },
      section: {
        observed_section_name: '5 WARNINGS AND PRECAUTIONS',
        name: 'WARNINGS AND PRECAUTIONS'
      },
      source: { annotator: 'rxb_ner' },
      confidence: 0.94,
      start: 850,
      end: 865
    },
    {
      id: 'ann_000003',
      term: 'Nausea',
      display_classification: 'MedDRA Adverse Reaction',
      coding: {
        name: 'Nausea',
        code: '10028813',
        soc_name: 'Gastrointestinal disorders'
      },
      section: {
        observed_section_name: '6 ADVERSE REACTIONS',
        name: 'ADVERSE REACTIONS'
      },
      source: { annotator: 'meddra_exact_matcher' },
      confidence: 1.0,
      start: 1420,
      end: 1426
    }
  ]
};

export default function LabelingAeView({ setId, splId, labelMeta }: LabelingAeViewProps) {
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'smart' | 'json'>('smart');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArrayKey, setSelectedArrayKey] = useState<string>('annotations');
  const [copied, setCopied] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  // Filters for annotations
  const [selectedSocFilter, setSelectedSocFilter] = useState<string>('all');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('all');

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

  const loadDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/labeling_ae/example');
      if (res.ok) {
        const json = await res.json();
        setResponse({
          status: 'success',
          set_id: setId,
          server: 'Local Example (deploy/data_transfer/example.labelingAE.json)',
          target_url: json.target_url,
          data: json.data
        });
        setIsDemo(true);
        setLoading(false);
        return;
      }
    } catch {
      // ignore
    }

    setResponse({
      status: 'success',
      set_id: setId,
      server: 'Local Demo Fallback',
      target_url: `demo://safety/labels/${setId}/annotations`,
      data: INLINE_FALLBACK_DATA
    });
    setIsDemo(true);
    setLoading(false);
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

  // Set default active array key (prioritize 'annotations' if present)
  useEffect(() => {
    if (rootArray) {
      setSelectedArrayKey('root');
    } else if (arrayKeys.length > 0) {
      if (arrayKeys.includes('annotations')) {
        setSelectedArrayKey('annotations');
      } else if (!selectedArrayKey || !arrayKeys.includes(selectedArrayKey)) {
        setSelectedArrayKey(arrayKeys[0]);
      }
    }
  }, [arrayKeys, rootArray, selectedArrayKey]);

  // Current active collection
  const activeItems: any[] = useMemo(() => {
    if (rootArray) return rootArray;
    if (!payload || !selectedArrayKey) return [];
    const val = payload[selectedArrayKey];
    return Array.isArray(val) ? val : [];
  }, [payload, selectedArrayKey, rootArray]);

  // Distinct SOCs and Classifications for filter dropdowns if this is annotations
  const isAnnotationCollection = selectedArrayKey === 'annotations' && activeItems.some((it) => it?.coding || it?.term);

  const distinctSocs = useMemo(() => {
    if (!isAnnotationCollection) return [];
    const socs = new Set<string>();
    activeItems.forEach((it) => {
      const soc = it?.coding?.soc_name;
      if (soc) socs.add(soc);
    });
    return Array.from(socs).sort();
  }, [activeItems, isAnnotationCollection]);

  const distinctClassifications = useMemo(() => {
    if (!isAnnotationCollection) return [];
    const classes = new Set<string>();
    activeItems.forEach((it) => {
      const cls = it?.display_classification || it?.classification || it?.safety_type;
      if (cls) classes.add(cls);
    });
    return Array.from(classes).sort();
  }, [activeItems, isAnnotationCollection]);

  // Columns for generic collection
  const genericColumns = useMemo(() => {
    if (!activeItems || activeItems.length === 0 || isAnnotationCollection) return [];
    const colSet = new Set<string>();
    activeItems.slice(0, 50).forEach((item) => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach((k) => colSet.add(k));
      }
    });
    return Array.from(colSet);
  }, [activeItems, isAnnotationCollection]);

  // Filter items by search query and dropdown filters
  const filteredItems = useMemo(() => {
    let result = activeItems;

    if (isAnnotationCollection) {
      if (selectedSocFilter !== 'all') {
        result = result.filter((it) => it?.coding?.soc_name === selectedSocFilter);
      }
      if (selectedClassFilter !== 'all') {
        result = result.filter((it) => (it?.display_classification || it?.classification || it?.safety_type) === selectedClassFilter);
      }
    }

    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter((item) => {
      if (item == null) return false;
      if (typeof item !== 'object') return String(item).toLowerCase().includes(q);
      return Object.values(item).some((v) =>
        String(v != null && typeof v === 'object' ? JSON.stringify(v) : v)
          .toLowerCase()
          .includes(q)
      );
    });
  }, [activeItems, searchQuery, isAnnotationCollection, selectedSocFilter, selectedClassFilter]);

  const handleCopyJson = () => {
    if (!payload) return;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const drugTitle = labelMeta?.brand_name || labelMeta?.drug_name || setId;
  const summary = payload?.summary;

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
                Example Preview
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
                Load Example / Demo Annotations
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
              Load Example / Demo Annotations
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
          {/* Metrics summary row */}
          <div className="afl-ae-metrics">
            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Total Annotations</div>
              <div className="afl-ae-metric-card__value">
                {summary?.combined_adverse_reactions || summary?.annotation_count || activeItems.length}
              </div>
              <div className="afl-ae-metric-card__sub">
                {selectedArrayKey || 'Items'}
              </div>
            </div>

            {summary?.meddra_adverse_reactions != null && (
              <div className="afl-ae-metric-card">
                <div className="afl-ae-metric-card__label">MedDRA Reactions</div>
                <div className="afl-ae-metric-card__value" style={{ color: '#2563eb' }}>
                  {summary.meddra_adverse_reactions}
                </div>
                <div className="afl-ae-metric-card__sub">Exact & PT Matches</div>
              </div>
            )}

            {summary?.rxbert_adverse_reactions != null && (
              <div className="afl-ae-metric-card">
                <div className="afl-ae-metric-card__label">RxBERT Reactions</div>
                <div className="afl-ae-metric-card__value" style={{ color: '#8b5cf6' }}>
                  {summary.rxbert_adverse_reactions}
                </div>
                <div className="afl-ae-metric-card__sub">Model Predictions</div>
              </div>
            )}

            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Sections Analyzed</div>
              <div className="afl-ae-metric-card__value">
                {summary?.section_count || payload?.sections?.length || '—'}
              </div>
              <div className="afl-ae-metric-card__sub">Safety Sections</div>
            </div>

            <div className="afl-ae-metric-card">
              <div className="afl-ae-metric-card__label">Set ID</div>
              <div className="afl-ae-metric-card__value" style={{ fontSize: '0.9rem', fontFamily: 'monospace' }}>
                {setId.slice(0, 14)}…
              </div>
              <div className="afl-ae-metric-card__sub">Target SPL</div>
            </div>
          </div>

          {/* Scalar parameters grid if any */}
          {scalarEntries.length > 0 && (
            <div className="afl-ae-card">
              <div className="afl-ae-card__header">
                <h3 className="afl-ae-card__title">Metadata & Processing Parameters</h3>
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
                    Extracted Safety Annotations
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

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* Classification Filter Dropdown */}
                  {distinctClassifications.length > 1 && (
                    <select
                      value={selectedClassFilter}
                      onChange={(e) => setSelectedClassFilter(e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.78rem', background: '#ffffff' }}
                    >
                      <option value="all">All Classifications</option>
                      {distinctClassifications.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}

                  {/* SOC Filter Dropdown */}
                  {distinctSocs.length > 1 && (
                    <select
                      value={selectedSocFilter}
                      onChange={(e) => setSelectedSocFilter(e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.78rem', background: '#ffffff', maxWidth: '200px' }}
                    >
                      <option value="all">All SOC Categories</option>
                      {distinctSocs.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}

                  <input
                    type="text"
                    className="afl-ae-search-input"
                    placeholder="Search terms, SOC, section…"
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
                  No items found in this collection.
                </div>
              ) : isAnnotationCollection ? (
                /* Tailored annotations table for the LabelingAE schema */
                <div className="afl-ae-table-wrap">
                  <table className="afl-ae-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Extracted Term</th>
                        <th>MedDRA PT</th>
                        <th>System Organ Class (SOC)</th>
                        <th>Observed Section</th>
                        <th>Classification / Method</th>
                        <th>Confidence</th>
                        <th>Offsets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item, idx) => {
                        const ptName = item.coding?.name || item.term;
                        const ptCode = item.coding?.code;
                        const socName = item.coding?.soc_name || '—';
                        const sectionName = item.section?.observed_section_name || item.section?.name || '—';
                        const classification = item.display_classification || item.safety_type || '—';
                        const annotator = item.source?.annotator;
                        const isRxBert = classification.includes('RxBERT') || annotator?.includes('rxb');

                        return (
                          <tr key={item.id || idx}>
                            <td style={{ color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>
                            <td>
                              <strong style={{ color: '#0f172a', textTransform: 'capitalize' }}>
                                {item.term}
                              </strong>
                            </td>
                            <td>
                              <div>
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>{ptName}</span>
                                {ptCode && (
                                  <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                                    PT: {ptCode}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span style={{ fontSize: '0.8rem', color: '#475569' }}>{socName}</span>
                            </td>
                            <td>
                              <span
                                style={{
                                  fontSize: '0.76rem',
                                  fontWeight: 600,
                                  background: '#f1f5f9',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  color: '#334155'
                                }}
                              >
                                {sectionName}
                              </span>
                            </td>
                            <td>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  background: isRxBert ? '#ede9fe' : '#dbeafe',
                                  color: isRxBert ? '#6d28d9' : '#1d4ed8'
                                }}
                              >
                                {classification}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontWeight: 700, color: '#059669', fontSize: '0.82rem' }}>
                                {typeof item.confidence === 'number'
                                  ? `${(item.confidence * 100).toFixed(0)}%`
                                  : '—'}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: '#64748b' }}>
                              {item.start != null && item.end != null ? `[${item.start}, ${item.end}]` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : genericColumns.length > 0 ? (
                /* Fallback generic table for any other collection (e.g. sections, tokens, etc.) */
                <div className="afl-ae-table-wrap">
                  <table className="afl-ae-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        {genericColumns.map((col) => (
                          <th key={col}>{col.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>
                          {genericColumns.map((col) => {
                            const val = item?.[col];
                            return (
                              <td key={col}>
                                {val == null ? (
                                  <span style={{ color: '#cbd5e1' }}>—</span>
                                ) : typeof val === 'object' ? (
                                  <span className="afl-ae-tag">
                                    {JSON.stringify(val).slice(0, 40)}…
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
