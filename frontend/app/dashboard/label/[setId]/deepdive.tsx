'use client';

import { useState, useEffect, useMemo } from 'react';
import { withDashboardBase, withApiBase } from '../../../utils/appPaths';

interface PeerItem {
  term: string;
  count: number;
}

interface PeerCounts {
  names: PeerItem[];
  epcs: PeerItem[];
  source: string;
}

interface MatrixRow {
  term: string;
  soc: string;
  target: 'B' | 'W' | 'A' | 'N';
  consensus: 'B' | 'W' | 'A' | 'N';
  coverage: string;
  dist: { [key: string]: number };
  peers: ('B' | 'W' | 'A' | 'N')[];
  is_discrepancy: boolean;
  originals: string[];
}

interface Anomaly {
  term: string;
  soc: string;
  target_code: string;
  consensus_code: string;
  peer_coverage: number;
  peer_max_level: number;
  distribution: { [key: string]: number };
  note?: string;
  weight: number;
  originals: string[];
}

interface PeerMeta {
  brand: string;
  manufacturer: string;
}

interface TieredResults {
  matrix: MatrixRow[];
  tiers: {
    critical: Anomaly[];
    moderate: Anomaly[];
    minor: Anomaly[];
  };
  peer_count: number;
  peers_metadata: { [setId: string]: PeerMeta };
  target_set_id: string;
  _stats?: {
    cache_hits: number;
    cache_misses: number;
  };
}

export default function DeepDiveView({ 
  activeTab, 
  setId 
}: { 
  activeTab: string;
  setId: string;
}) {
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countsData, setCountsData] = useState<PeerCounts | null>(null);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [source, setSource] = useState<'local' | 'oracle' | 'openfda'>('local');

  // Analysis State
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<TieredResults | null>(null);
  const [selectedBaseline, setSelectedBaseline] = useState<{term: string, type: 'name' | 'epc'} | null>(null);
  
  // UI Toggles
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);
  const [collapsedSocs, setCollapsedSocs] = useState<Set<string>>(new Set());
  
  // Memo State
  const [selectedSignals, setSelectedSignals] = useState<Set<string>>(new Set());
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState('');

  const toggleSoc = (soc: string) => {
    const next = new Set(collapsedSocs);
    if (next.has(soc)) next.delete(soc);
    else next.add(soc);
    setCollapsedSocs(next);
  };

  const expandAllSocs = () => setCollapsedSocs(new Set());
  const collapseAllSocs = () => {
    if (results) {
      const allSocs = new Set(results.matrix.map(r => r.soc));
      setCollapsedSocs(allSocs);
    }
  };

  const toggleSignal = (term: string) => {
    const next = new Set(selectedSignals);
    if (next.has(term)) next.delete(term);
    else next.add(term);
    setSelectedSignals(next);
  };

  const generateMemo = () => {
    if (!results || selectedSignals.size === 0) return;
    let draft = `OBSERVATIONS ON REGULATORY DISCREPANCIES:\n\n`;
    const allAnomalies = [...results.tiers.critical, ...results.tiers.moderate, ...results.tiers.minor];
    allAnomalies.filter(s => selectedSignals.has(s.term)).forEach(s => {
      const distStr = `B:${s.distribution.B}%, W:${s.distribution.W}%, A:${s.distribution.A}%, N:${s.distribution.N}%`;
      draft += `[SIGNAL: ${s.term.toUpperCase()}]\n`;
      if (s.originals && s.originals.length > 0) draft += `  - Target XML Match: "${s.originals.join(', ')}"\n`;
      draft += `  - Compliance Status: Target is "${getLevelLabel(s.target_code)}", while Peer Consensus is "${getLevelLabel(s.consensus_code)}".\n`;
      draft += `  - Clinical Evidence: Class distribution is ${distStr}.\n`;
      if (s.note) draft += `  - Risk Assessment: ${s.note}\n`;
      draft += `\n`;
    });
    setMemoText(draft);
    setShowMemo(true);
  };

  const copyFullMemo = () => {
    if (!results) return;
    const header = `INTERNAL REGULATORY REVIEW MEMO\n================================\nDATE: ${new Date().toLocaleDateString()}\nCOHORT: ${selectedBaseline?.term}\nSCOPE: ${results.peer_count} peers analyzed\n================================\n\n`;
    let refs = `\n--------------------------------\nREFERENCES (Peer Evidence Base):\n`;
    Object.entries(results.peers_metadata).forEach(([pid, meta]) => {
      refs += `- ${meta.brand} (${meta.manufacturer}): ${window.location.origin}${withDashboardBase(`/dashboard/label/${pid}`)}\n`;
    });
    const fullText = header + memoText + refs;
    navigator.clipboard.writeText(fullText);
    const btn = document.querySelector('.btn-copy-modern') as HTMLElement;
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = '✅ Copied to Clipboard!';
      setTimeout(() => btn.innerHTML = originalText, 2000);
    }
  };

  const fetchCounts = async (currentSource: string) => {
    setLoadingCounts(true);
    setCountsError(null);
    try {
      const resp = await fetch(
        withApiBase(`/api/dashboard/deep_dive/peers_count/${setId}?source=${currentSource}`)
      );
      if (!resp.ok) throw new Error('Failed to fetch peer counts');
      const json = await resp.json();
      setCountsData(json);
    } catch (err: any) {
      setCountsError(err.message);
    } finally {
      setLoadingCounts(false);
    }
  };

  const runAnalysis = async (term: string, type: 'name' | 'epc') => {
    setAnalyzing(true);
    setSelectedBaseline({ term, type });
    setResults(null);
    setSelectedSignals(new Set());
    try {
      const params = new URLSearchParams({ source, [type === 'name' ? 'generic_names' : 'epcs']: term });
      const resp = await fetch(
        withApiBase(`/api/dashboard/deep_dive/analysis/${setId}?${params.toString()}`)
      );  
      if (!resp.ok) throw new Error('Analysis failed');
      const data = await resp.json();
      setResults(data);
      const criticalSet = new Set<string>();
      data.tiers.critical.forEach((s: any) => criticalSet.add(s.term));
      setSelectedSignals(criticalSet);
      setTimeout(() => {
        document.getElementById('analysis-results-anchor')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) { console.error(err); } finally { setAnalyzing(false); }
  };

  useEffect(() => {
    if (activeTab === 'deep-dive-view' && setId) fetchCounts(source);
  }, [activeTab, setId, source]);

  const groupedMatrix = useMemo(() => {
    if (!results) return {};
    const groups: { [soc: string]: MatrixRow[] } = {};
    results.matrix.forEach(row => {
      if (!groups[row.soc]) groups[row.soc] = [];
      groups[row.soc].push(row);
    });
    return groups;
  }, [results]);

  if (activeTab !== 'deep-dive-view') return null;

  const getLevelStyles = (code: string) => {
    switch (code) {
      case 'B': return { bg: 'var(--afl-danger-100)', text: 'var(--afl-danger-700)', border: 'var(--afl-danger-500)', label: 'Boxed', shadow: '0 0 8px rgba(239,68,68,0.2)' };
      case 'W': return { bg: 'var(--afl-warn-100)', text: 'var(--afl-warn-700)', border: 'var(--afl-warn-500)', label: 'Warning', shadow: 'none' };
      case 'A': return { bg: 'var(--afl-warn-50)', text: 'var(--afl-warn-700)', border: 'var(--afl-warn-500)', label: 'Adverse', shadow: 'none' };
      default:  return { bg: 'var(--afl-n-50)', text: 'var(--afl-n-400)', border: 'var(--afl-n-200)', label: 'None', shadow: 'none' };
    }
  };

  const getLevelLabel = (code: string) => {
    switch (code) {
      case 'B': return 'Boxed Warning';
      case 'W': return 'Warning';
      case 'A': return 'Adverse Rxn';
      default: return 'None';
    }
  };

  return (
    <div id="deep-dive-view" className="tab-content active" style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* 1. SELECTION AREA */}
      <div className="selection-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: 'var(--afl-n-900)', letterSpacing: '-0.02em' }}>Regulatory Intelligence</h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: 'var(--afl-n-500)', fontWeight: 500 }}>Select a clinical cohort to perform a comparative gap analysis.</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '32px' }}>
          <div className="cohort-column">
            <div className="cohort-header">Generic Peer Groups</div>
            <div className="cohort-body">
              {loadingCounts ? <div className="loader-box"><div className="loader"></div></div> : countsData?.names.map(item => (
                <div key={item.term} onClick={() => runAnalysis(item.term, 'name')} className={`cohort-card ${selectedBaseline?.term === item.term ? 'active' : ''}`}>
                  <div className="cohort-info">
                    <span className="cohort-icon">💊</span>
                    <span className="cohort-name">{item.term}</span>
                  </div>
                  <span className="cohort-count">{item.count} Peers</span>
                </div>
              ))}
            </div>
          </div>
          <div className="cohort-column">
            <div className="cohort-header">Pharmacologic Class (EPC)</div>
            <div className="cohort-body">
              {loadingCounts ? <div className="loader-box"><div className="loader"></div></div> : countsData?.epcs.map(item => (
                <div key={item.term} onClick={() => runAnalysis(item.term, 'epc')} className={`cohort-card ${selectedBaseline?.term === item.term ? 'active' : ''}`}>
                  <div className="cohort-info">
                    <span className="cohort-icon">🧬</span>
                    <span className="cohort-name">{item.term}</span>
                  </div>
                  <span className="cohort-count">{item.count} Labels</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div id="analysis-results-anchor"></div>

      {/* 2. ANALYSIS RESULTS AREA */}
      {analyzing && (
        <div className="analysis-loading">
          <div className="loader large"></div>
          <h4>Constructing Intelligence Matrix...</h4>
          <p>Scanning MedDRA hierarchy and calculating regulatory consensus across class peers.</p>
        </div>
      )}

      {results && !analyzing && (
        <div className="animate-fade-in">

          {/* DEV LOG: Cache Statistics */}
          <div style={{
            backgroundColor: 'transparent',
            color: 'var(--afl-n-500)',
            padding: '8px 0',
            fontSize: '0.85rem',
            marginBottom: '16px',
            borderBottom: '1px dashed var(--afl-n-200)',
            display: 'flex',
            gap: '20px',
            alignItems: 'center',
            fontWeight: 500
          }}>
            <span style={{ fontWeight: 800, color: 'var(--afl-n-400)', fontSize: '0.75rem', letterSpacing: '0.05em' }}>[DEV_LOG]</span>
            {results._stats ? (
              <>
                <span style={{ color: 'var(--afl-n-600)' }}>Optimization Active:</span>
                <span>Cache Hits: <strong style={{ color: 'var(--afl-n-900)' }}>{results._stats.cache_hits}</strong></span>
                <span>New Scans: <strong style={{ color: 'var(--afl-n-900)' }}>{results._stats.cache_misses}</strong></span>
                <span style={{ 
                  backgroundColor: 'var(--afl-success-50)', 
                  color: 'var(--afl-success-500)', 
                  padding: '2px 8px', 
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}>
                  {Math.round((results._stats.cache_hits / (results._stats.cache_hits + results._stats.cache_misses)) * 100)}% Pre-indexed
                </span>
              </>
            ) : (
              <span>Pre-indexing stats not available.</span>
            )}
          </div>

          <div style={{ marginBottom: '40px' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 900, color: 'var(--afl-n-900)', letterSpacing: '-0.03em' }}>Signal Anomalies</h2>
                <div className="peer-summary-badge">Analyzed {results.peer_count} Peers</div>
              </div>
              <button onClick={generateMemo} disabled={selectedSignals.size === 0} className="memo-action-btn">
                <span>📝</span> DRAFT REVIEWER MEMO ({selectedSignals.size})
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '24px' }}>
              <div className="anomaly-tier critical">
                <div className="tier-label">Critical Gaps</div>
                <div className="tier-content">
                  {results.tiers.critical.length > 0 ? results.tiers.critical.map(s => renderAnomalyCard(s, 'critical', toggleSignal, selectedSignals)) : <div className="empty-state">No critical gaps identified.</div>}
                </div>
              </div>
              <div className="anomaly-tier moderate">
                <div className="tier-label">Regulatory Discrepancies</div>
                <div className="tier-content">
                  {results.tiers.moderate.length > 0 ? results.tiers.moderate.map(s => renderAnomalyCard(s, 'moderate', toggleSignal, selectedSignals)) : <div className="empty-state">No major discrepancies found.</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="matrix-container">
            <div className="matrix-header-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <h4 style={{ margin: 0, fontWeight: 900, fontSize: '1.1rem' }}>Clinical Compliance Landscape</h4>
                <div className="matrix-controls">
                  <button className="control-btn" onClick={expandAllSocs}>⊕ Expand All</button>
                  <button className="control-btn" onClick={collapseAllSocs}>⊖ Collapse All</button>
                  <label className="filter-toggle">
                    <input type="checkbox" checked={showOnlyDiscrepancies} onChange={(e) => setShowOnlyDiscrepancies(e.target.checked)} />
                    <span className="toggle-label">Discrepancies Only</span>
                  </label>
                </div>
              </div>
              <div className="matrix-legend">
                {['B','W','A','N'].map(c => (
                  <div key={c} className="legend-item">
                    <span className={`gem mini ${c}`}></span>
                    <span className="legend-text">{getLevelLabel(c)}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="matrix-body">
              {Object.entries(groupedMatrix).map(([soc, rows]) => {
                const isCollapsed = collapsedSocs.has(soc);
                const filteredRows = rows.filter(r => !showOnlyDiscrepancies || r.is_discrepancy);
                if (filteredRows.length === 0) return null;

                return (
                  <div key={soc} className={`soc-group ${isCollapsed ? 'collapsed' : ''}`}>
                    <div className="soc-header" onClick={() => toggleSoc(soc)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="soc-toggle-icon">{isCollapsed ? '⊕' : '⊖'}</span>
                        <span className="soc-name">{soc}</span>
                        <span className="soc-count">{filteredRows.length} Terms</span>
                      </div>
                      <div className="soc-summary-line"></div>
                    </div>
                    
                    {!isCollapsed && (
                      <div className="soc-content">
                        <table className="modern-matrix-table">
                          <thead>
                            <tr>
                              <th style={{ width: '30%' }}>MedDRA Term (PT)</th>
                              <th style={{ width: '10%', textAlign: 'center' }}>Target</th>
                              <th style={{ width: '10%', textAlign: 'center' }}>Consensus</th>
                              <th style={{ width: '50%' }}>Peer Profile ({results.peer_count} Labels)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRows.map((row, idx) => {
                              const targetStyle = getLevelStyles(row.target);
                              const consensusStyle = getLevelStyles(row.consensus);
                              return (
                                <tr key={idx} className={row.is_discrepancy ? 'is-discrepancy' : ''}>
                                  <td className="term-cell">
                                    <div className="pt-wrap">
                                      <span className="pt-text">{row.term}</span>
                                      {row.originals.length > 0 && (
                                        <span className="original-match-tag">
                                          {row.originals[0]}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="status-cell">
                                    <div className={`gem-badge ${row.target}`} style={{ backgroundColor: targetStyle.bg, color: targetStyle.text, borderColor: targetStyle.border, boxShadow: targetStyle.shadow }}>
                                      {row.target}
                                    </div>
                                  </td>
                                  <td className="status-cell">
                                    <div className={`gem-badge ${row.consensus}`} style={{ backgroundColor: consensusStyle.bg, color: consensusStyle.text, borderColor: consensusStyle.border }}>
                                      {row.consensus}
                                    </div>
                                    <div className="consensus-meta">{row.coverage}</div>
                                  </td>
                                  <td className="peer-track-cell">
                                    <div className="peer-track">
                                      {row.peers.map((p, pIdx) => {
                                        const pStyle = getLevelStyles(p);
                                        const peerIds = Object.keys(results.peers_metadata);
                                        const peerId = peerIds[pIdx];
                                        const peerMeta = results.peers_metadata[peerId];
                                        return (
                                          <div key={pIdx} className={`peer-gem ${p}`} style={{ backgroundColor: pStyle.border, opacity: p === 'N' ? 0.15 : 1 }} title={peerMeta ? `${peerMeta.brand} (${peerMeta.manufacturer})` : ''} onClick={() => window.open(withDashboardBase(`/dashboard/label/${peerId}`), '_blank')}></div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Advanced Memo Modal */}
      {showMemo && (
        <div className="memo-overlay">
          <div className="memo-modal-advanced">
            <div className="memo-modal-sidebar">
              <div className="sidebar-header">
                <div className="memo-icon">📄</div>
                <h4>Memo Settings</h4>
              </div>
              <div className="sidebar-stats">
                <div className="stat-item">
                  <label>Baseline Group</label>
                  <span>{selectedBaseline?.term}</span>
                </div>
                <div className="stat-item">
                  <label>Peer Sample</label>
                  <span>{results?.peer_count} Labels</span>
                </div>
                <div className="stat-item">
                  <label>Date Generated</label>
                  <span>{new Date().toLocaleDateString()}</span>
                </div>
              </div>
              <div className="sidebar-footer">
                <p>This draft is based on an automated MedDRA comparison matrix.</p>
              </div>
            </div>

            <div className="memo-modal-main">
              <div className="memo-document-container">
                <div className="memo-header-formal">
                  <div className="memo-title">Internal Regulatory Review Memo</div>
                  <div className="memo-subtitle">Clinical Safety Labeling Comparison</div>
                </div>
                
                <div className="memo-scroll-area">
                  <textarea 
                    className="memo-textarea-formal"
                    value={memoText} 
                    onChange={(e) => setMemoText(e.target.value)} 
                    spellCheck={false} 
                  />
                  
                  <div className="memo-references-ui">
                    <h5 className="refs-title">REFERENCES (Peer Evidence Base)</h5>
                    <div className="refs-list">
                      {Object.entries(results?.peers_metadata || {}).map(([pid, meta]) => (
                        <div key={pid} className="ref-item">
                          <span className="ref-meta">{meta.brand} ({meta.manufacturer})</span>
                          <a 
                            href={withDashboardBase(`/dashboard/label/${pid}`)} 
                            target="_blank" 
                            rel="noreferrer"
                            className="ref-link"
                          >
                            {pid}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="memo-modal-footer-advanced">
                <button className="btn-cancel-modern" onClick={() => setShowMemo(false)}>Discard</button>
                <button className="btn-copy-modern" onClick={copyFullMemo}>
                  Copy Full Memo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .selection-card { background: white; border-radius: var(--fdl-radius-sm, 2px); padding: 24px; border: 1px solid var(--fdl-line, var(--afl-n-200)); margin-bottom: 24px; }
        .source-toggle { background: var(--fdl-canvas, var(--afl-n-100)); padding: 3px; border-radius: var(--fdl-radius-sm, 2px); display: flex; gap: 4px; border: 1px solid var(--fdl-line, var(--afl-n-200)); }
        .source-btn { padding: 6px 14px; border-radius: var(--fdl-radius-sm, 2px); font-size: 0.78rem; font-weight: 700; cursor: pointer; border: none; background: transparent; color: var(--fdl-muted, var(--afl-n-500)); text-transform: uppercase; transition: all 0.15s; }
        .source-btn.active { background: var(--fdl-surface, white); color: var(--fdl-text, var(--afl-n-900)); }
        
        .cohort-column { background: var(--fdl-canvas, var(--afl-n-50)); border-radius: var(--fdl-radius-sm, 2px); border: 1px solid var(--fdl-line, var(--afl-n-200)); overflow: hidden; }
        .cohort-header { padding: 12px 18px; background: var(--fdl-surface, white); border-bottom: 1px solid var(--fdl-line, var(--afl-n-200)); font-weight: 800; font-size: 0.75rem; color: var(--fdl-muted, var(--afl-n-600)); text-transform: uppercase; }
        .cohort-body { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
        .cohort-card { display: flex; justify-content: space-between; align-items: center; background: var(--fdl-surface, white); padding: 12px 16px; border-radius: var(--fdl-radius-sm, 2px); border: 1px solid var(--fdl-line, var(--afl-n-100)); cursor: pointer; transition: all 0.15s ease; }
        .cohort-card:hover { border-color: var(--fdl-accent, var(--afl-info-500)); }
        .cohort-card.active { border-color: var(--fdl-accent, var(--afl-info-500)); background: var(--fdl-accent-soft, var(--afl-info-50)); }
        .cohort-name { font-weight: 700; color: var(--fdl-text, var(--afl-n-800)); }
        .cohort-count { font-size: 0.72rem; font-weight: 800; background: var(--afl-info-50); color: var(--afl-info-700); padding: 2px 8px; border-radius: var(--fdl-radius-sm, 2px); }

        .analysis-loading { text-align: center; padding: 60px; background: var(--fdl-surface, white); border-radius: var(--fdl-radius-sm, 2px); border: 1px solid var(--fdl-line, var(--afl-n-200)); }
        .peer-summary-badge { background: var(--fdl-canvas, var(--afl-n-100)); color: var(--fdl-muted, var(--afl-n-600)); padding: 4px 10px; border-radius: var(--fdl-radius-sm, 2px); font-size: 0.75rem; font-weight: 700; border: 1px solid var(--fdl-line, var(--afl-n-200)); }
        .memo-action-btn { background: var(--afl-danger-600, #dc2626); color: white; border: none; padding: 8px 16px; border-radius: var(--fdl-radius-sm, 2px); font-weight: 700; cursor: pointer; transition: all 0.15s; }
        .memo-action-btn:disabled { background: var(--afl-danger-100); cursor: not-allowed; }

        .anomaly-tier { background: var(--fdl-surface, white); border-radius: var(--fdl-radius-sm, 2px); border: 1px solid var(--fdl-line, var(--afl-n-200)); overflow: hidden; }
        .tier-label { padding: 12px 18px; font-weight: 800; font-size: 0.75rem; text-transform: uppercase; }
        .critical .tier-label { background: var(--afl-danger-100); color: var(--afl-danger-700); }
        .moderate .tier-label { background: var(--afl-warn-50); color: var(--afl-warn-700); }
        .tier-content { padding: 16px; }

        .matrix-container { background: var(--fdl-surface, white); border-radius: var(--fdl-radius-sm, 2px); border: 1px solid var(--fdl-line, var(--afl-n-200)); overflow: hidden; }
        .matrix-header-main { padding: 16px 24px; background: var(--fdl-canvas, var(--afl-n-50)); border-bottom: 1px solid var(--fdl-line, var(--afl-n-100)); display: flex; justify-content: space-between; align-items: center; }
        .matrix-controls { display: flex; align-items: center; gap: 8px; }
        .control-btn { padding: 5px 10px; background: var(--fdl-surface, white); border: 1px solid var(--fdl-line, var(--afl-n-200)); border-radius: var(--fdl-radius-sm, 2px); font-size: 0.75rem; font-weight: 700; color: var(--fdl-text, var(--afl-n-600)); cursor: pointer; transition: all 0.15s; }
        .control-btn:hover { background: var(--fdl-canvas, var(--afl-n-50)); border-color: var(--fdl-accent, var(--afl-info-500)); color: var(--fdl-accent, var(--afl-info-500)); }
        .filter-toggle { display: flex; align-items: center; gap: 8px; padding: 5px 10px; background: var(--fdl-surface, white); border: 1px solid var(--fdl-line, var(--afl-n-200)); border-radius: var(--fdl-radius-sm, 2px); cursor: pointer; }
        .toggle-label { font-size: 0.75rem; font-weight: 700; color: var(--fdl-text, var(--afl-n-600)); }

        .matrix-legend { display: flex; gap: 16px; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .gem { width: 12px; height: 12px; border-radius: 2px; border: 1px solid; flex-shrink: 0; display: inline-block; }
        .gem.B { background: var(--afl-danger-100); border-color: var(--afl-danger-500); }
        .gem.W { background: var(--afl-warn-100); border-color: var(--afl-warn-500); }
        .gem.A { background: var(--afl-warn-50); border-color: var(--afl-warn-500); }
        .gem.N { background: var(--afl-n-50); border-color: var(--afl-n-200); }
        .legend-text { font-size: 0.7rem; font-weight: 700; color: var(--fdl-muted, var(--afl-n-500)); }

        .soc-group { border-bottom: 1px solid var(--fdl-line, var(--afl-n-100)); }
        .soc-header { padding: 12px 24px; background: var(--fdl-surface, var(--afl-n-0)); cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
        .soc-header:hover { background: var(--fdl-canvas, var(--afl-n-50)); }
        .soc-name { font-weight: 800; color: var(--fdl-text, var(--afl-n-900)); }
        .soc-count { font-size: 0.7rem; font-weight: 700; background: var(--fdl-canvas, var(--afl-n-100)); color: var(--fdl-muted, var(--afl-n-500)); padding: 2px 6px; border-radius: 2px; }
        .soc-summary-line { flex: 1; margin-left: 16px; height: 1px; background: var(--fdl-line, var(--afl-n-100)); }

        .modern-matrix-table { width: 100%; border-collapse: collapse; }
        .modern-matrix-table th { padding: 10px 18px; font-size: 0.7rem; font-weight: 800; color: var(--fdl-muted, var(--afl-n-400)); text-transform: uppercase; text-align: left; }
        .modern-matrix-table td { padding: 12px 18px; border-bottom: 1px solid var(--fdl-line, var(--afl-n-50)); }
        .is-discrepancy { background: var(--afl-warn-50); }
        .pt-text { font-weight: 700; color: var(--fdl-text, var(--afl-n-800)); }
        .original-match-tag { font-size: 0.7rem; font-weight: 700; color: var(--fdl-accent, var(--afl-info-500)); background: var(--afl-info-50); padding: 2px 6px; border-radius: 2px; margin-left: 8px; }
        .gem-badge { width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 2px; font-size: 0.82rem; font-weight: 800; border: 1px solid; margin: 0 auto; }
        .consensus-meta { font-size: 0.65rem; color: var(--fdl-muted, var(--afl-n-400)); font-weight: 800; margin-top: 4px; text-align: center; }
        .peer-track { display: flex; gap: 3px; flex-wrap: wrap; }
        .peer-gem { width: 8px; height: 16px; border-radius: 1px; cursor: pointer; }

        .memo-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.6); backdrop-filter: blur(4px); z-index: 5000; display: flex; alignItems: center; justifyContent: center; padding: 24px; }
        .memo-modal-advanced { background: var(--fdl-canvas, var(--afl-n-50)); width: 100%; maxWidth: 960px; height: 85vh; border-radius: var(--fdl-radius-sm, 2px); display: flex; overflow: hidden; border: 1px solid var(--fdl-line, var(--afl-n-200)); box-shadow: 0 8px 32px rgba(0,0,0,0.18); animation: modalPop 0.2s ease; }
        @keyframes modalPop { from { transform: scale(0.98); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .memo-modal-sidebar { width: 260px; background: var(--fdl-surface, var(--afl-n-800)); padding: 24px; color: var(--fdl-text, white); display: flex; flex-direction: column; border-right: 1px solid var(--fdl-line); }
        .stat-item { margin-top: 18px; }
        .stat-item label { display: block; font-size: 0.65rem; text-transform: uppercase; font-weight: 800; color: var(--fdl-muted, var(--afl-n-400)); letter-spacing: 0.08em; }
        .stat-item span { font-size: 0.9rem; font-weight: 600; }
        .memo-modal-main { flex: 1; display: flex; flex-direction: column; background: var(--fdl-surface, white); overflow: hidden; }
        .memo-document-container { flex: 1; padding: 28px; display: flex; flex-direction: column; overflow: hidden; }
        .memo-header-formal { border-bottom: 1px solid var(--fdl-line, var(--afl-n-100)); padding-bottom: 18px; margin-bottom: 18px; }
        .memo-title { font-size: 1.15rem; font-weight: 800; color: var(--fdl-text, var(--afl-n-900)); }
        .memo-scroll-area { flex: 1; overflow-y: auto; padding-right: 10px; }
        .memo-textarea-formal { width: 100%; height: 350px; border: none; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; line-height: 1.6; outline: none; resize: none; color: var(--fdl-text, var(--afl-n-700)); }
        
        .memo-references-ui { margin-top: 28px; border-top: 1px dashed var(--fdl-line, var(--afl-n-100)); paddingTop: 18px; }
        .refs-title { font-size: 0.72rem; font-weight: 800; color: var(--fdl-muted, var(--afl-n-400)); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
        .refs-list { display: flex; flex-direction: column; gap: 8px; }
        .ref-item { display: flex; flex-direction: column; gap: 3px; padding: 10px; background: var(--fdl-canvas, var(--afl-n-50)); border-radius: var(--fdl-radius-sm, 2px); border: 1px solid var(--fdl-line, var(--afl-n-100)); }
        .ref-meta { font-size: 0.82rem; font-weight: 700; color: var(--fdl-text, var(--afl-n-800)); }
        .ref-link { font-size: 0.78rem; color: var(--fdl-accent, var(--afl-info-500)); text-decoration: none; font-family: monospace; font-weight: 600; word-break: break-all; }
        .ref-link:hover { text-decoration: underline; }

        .memo-modal-footer-advanced { padding: 18px 28px; background: var(--fdl-canvas, var(--afl-n-50)); border-top: 1px solid var(--fdl-line, var(--afl-n-200)); display: flex; justify-content: flex-end; gap: 12px; }
        .btn-copy-modern { background: var(--fdl-text, var(--afl-n-900)); color: white; padding: 8px 20px; border-radius: var(--fdl-radius-sm, 2px); font-weight: 700; border: none; cursor: pointer; transition: all 0.15s; }
        .btn-cancel-modern { background: var(--fdl-surface, white); color: var(--fdl-muted, var(--afl-n-500)); padding: 8px 16px; border-radius: var(--fdl-radius-sm, 2px); font-weight: 700; border: 1px solid var(--fdl-line, var(--afl-n-200)); cursor: pointer; }
        .animate-fade-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .loader { border: 3px solid var(--afl-n-100); border-top: 3px solid var(--fdl-accent, var(--afl-info-500)); border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>

    </div>
  );
}

function renderAnomalyCard(s: Anomaly, tier: 'critical' | 'moderate' | 'minor', onToggle: (t:string)=>void, selected: Set<string>) {
  const isSelected = selected.has(s.term);
  const tierColors = {
    critical: { bg: 'var(--afl-danger-50)', border: 'var(--afl-danger-100)', text: 'var(--afl-danger-700)', accent: 'var(--afl-danger-500)' },
    moderate: { bg: 'var(--afl-warn-50)', border: 'var(--afl-warn-100)', text: 'var(--afl-warn-700)', accent: 'var(--afl-warn-500)' },
    minor: { bg: 'var(--afl-n-50)', border: 'var(--afl-n-200)', text: 'var(--afl-n-600)', accent: 'var(--afl-n-400)' }
  };
  const color = tierColors[tier];
  const distStr = `B:${s.distribution.B}% W:${s.distribution.W}% A:${s.distribution.A}% N:${s.distribution.N}%`;

  return (
    <div key={s.term} onClick={() => onToggle(s.term)} className="anomaly-card" style={{ 
      background: isSelected ? 'white' : color.bg, 
      borderColor: isSelected ? color.accent : color.border,
      borderWidth: '1px', borderStyle: 'solid',
      padding: '12px 16px', borderRadius: 'var(--fdl-radius-sm, 2px)', marginBottom: '8px', cursor: 'pointer', transition: 'all 0.15s ease',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <input type="checkbox" checked={isSelected} readOnly style={{ width: '16px', height: '16px', accentColor: color.accent }} />
        <div>
          <div style={{ fontWeight: 800, color: color.text, fontSize: '0.95rem' }}>{s.term}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--afl-n-400)', textTransform: 'uppercase', fontWeight: 800, marginTop: '2px' }}>{s.soc}</div>
          <div style={{ fontSize: '0.72rem', color: color.accent, fontWeight: 700, marginTop: '4px', background: 'rgba(255,255,255,0.7)', padding: '1px 6px', borderRadius: '2px', width: 'fit-content' }}>
            {s.note}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--afl-n-400)', textTransform: 'uppercase', fontWeight: 800, marginBottom: '3px' }}>Peer Distribution</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: 'var(--afl-n-700)', background: 'var(--afl-n-100)', padding: '2px 8px', borderRadius: '2px' }}>
          {distStr}
        </div>
      </div>
    </div>
  );
}
