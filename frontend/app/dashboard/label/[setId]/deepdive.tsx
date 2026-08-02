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
      case 'B': return { bg: '#fee2e2', text: '#b91c1c', border: '#ef4444', label: 'Boxed', shadow: '0 0 8px rgba(239,68,68,0.2)' };
      case 'W': return { bg: '#ffedd5', text: '#c2410c', border: '#f97316', label: 'Warning', shadow: 'none' };
      case 'A': return { bg: '#fef9c3', text: '#a16207', border: '#eab308', label: 'Adverse', shadow: 'none' };
      default:  return { bg: '#f8fafc', text: '#94a3b8', border: '#e2e8f0', label: 'None', shadow: 'none' };
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
            <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>Regulatory Intelligence</h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.9rem', color: '#64748b', fontWeight: 500 }}>Select a clinical cohort to perform a comparative gap analysis.</p>
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
            color: '#64748b',
            padding: '8px 0',
            fontSize: '0.85rem',
            marginBottom: '16px',
            borderBottom: '1px dashed #e2e8f0',
            display: 'flex',
            gap: '20px',
            alignItems: 'center',
            fontWeight: 500
          }}>
            <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '0.75rem', letterSpacing: '0.05em' }}>[DEV_LOG]</span>
            {results._stats ? (
              <>
                <span style={{ color: '#475569' }}>Optimization Active:</span>
                <span>Cache Hits: <strong style={{ color: '#0f172a' }}>{results._stats.cache_hits}</strong></span>
                <span>New Scans: <strong style={{ color: '#0f172a' }}>{results._stats.cache_misses}</strong></span>
                <span style={{ 
                  backgroundColor: '#f0fdf4', 
                  color: '#16a34a', 
                  padding: '2px 8px', 
                  borderRadius: '12px',
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
                <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.03em' }}>Signal Anomalies</h2>
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
        .selection-card { background: white; border-radius: 24px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 10px 40px -10px rgba(0,0,0,0.05); margin-bottom: 32px; }
        .source-toggle { background: #f1f5f9; padding: 6px; border-radius: 14px; display: flex; gap: 4px; }
        .source-btn { padding: 8px 18px; border-radius: 10px; font-size: 0.8rem; font-weight: 800; cursor: pointer; border: none; background: transparent; color: #64748b; text-transform: uppercase; transition: all 0.2s; }
        .source-btn.active { background: white; color: #0f172a; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        
        .cohort-column { background: #f8fafc; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; }
        .cohort-header { padding: 16px 24px; background: rgba(255,255,255,0.6); border-bottom: 1px solid #e2e8f0; font-weight: 900; font-size: 0.8rem; color: #475569; text-transform: uppercase; }
        .cohort-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
        .cohort-card { display: flex; justify-content: space-between; align-items: center; background: white; padding: 16px 20px; border-radius: 14px; border: 2px solid #f1f5f9; cursor: pointer; transition: all 0.3s ease; }
        .cohort-card:hover { transform: translateY(-3px); border-color: #3b82f6; }
        .cohort-card.active { border-color: #3b82f6; background: #eff6ff; }
        .cohort-name { font-weight: 800; color: #1e293b; }
        .cohort-count { font-size: 0.75rem; font-weight: 900; background: #eff6ff; color: #1d4ed8; padding: 4px 10px; border-radius: 8px; }

        .analysis-loading { text-align: center; padding: 80px; background: white; border-radius: 24px; border: 1px solid #e2e8f0; }
        .peer-summary-badge { background: #f1f5f9; color: #475569; padding: 6px 14px; border-radius: 30px; font-size: 0.8rem; font-weight: 800; }
        .memo-action-btn { background: #e11d48; color: white; border: none; padding: 12px 24px; border-radius: 14px; font-weight: 900; cursor: pointer; transition: all 0.3s; }
        .memo-action-btn:disabled { background: #fca5a5; cursor: not-allowed; }

        .anomaly-tier { background: white; border-radius: 24px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.03); }
        .tier-label { padding: 14px 24px; font-weight: 900; font-size: 0.8rem; text-transform: uppercase; }
        .critical .tier-label { background: #fee2e2; color: #b91c1c; }
        .moderate .tier-label { background: #fffbeb; color: #92400e; }
        .tier-content { padding: 20px; }

        .matrix-container { background: white; border-radius: 24px; border: 1px solid #e2e8f0; overflow: hidden; }
        .matrix-header-main { padding: 20px 32px; background: #f8fafc; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .matrix-controls { display: flex; align-items: center; gap: 12px; }
        .control-btn { padding: 6px 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.75rem; font-weight: 700; color: #475569; cursor: pointer; transition: all 0.2s; }
        .control-btn:hover { background: #f8fafc; border-color: #3b82f6; color: #3b82f6; }
        .filter-toggle { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; }
        .toggle-label { font-size: 0.75rem; font-weight: 700; color: #475569; }

        .matrix-legend { display: flex; gap: 16px; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .gem { width: 12px; height: 12px; border-radius: 3px; border: 1.5px solid; flex-shrink: 0; display: inline-block; }
        .gem.B { background: #fee2e2; border-color: #ef4444; }
        .gem.W { background: #ffedd5; border-color: #f97316; }
        .gem.A { background: #fef9c3; border-color: #eab308; }
        .gem.N { background: #f8fafc; border-color: #e2e8f0; }
        .legend-text { font-size: 0.7rem; font-weight: 800; color: #64748b; }

        .soc-group { border-bottom: 1px solid #f1f5f9; }
        .soc-header { padding: 16px 32px; background: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
        .soc-header:hover { background: #f8fafc; }
        .soc-name { font-weight: 900; color: #0f172a; }
        .soc-count { font-size: 0.7rem; font-weight: 800; background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 10px; }
        .soc-summary-line { flex: 1; margin-left: 20px; height: 1px; background: #f1f5f9; }

        .modern-matrix-table { width: 100%; border-collapse: collapse; }
        .modern-matrix-table th { padding: 12px 24px; font-size: 0.7rem; font-weight: 900; color: #94a3b8; text-transform: uppercase; text-align: left; }
        .modern-matrix-table td { padding: 16px 24px; border-bottom: 1px solid #f8fafc; }
        .is-discrepancy { background: #fffcf0; }
        .pt-text { font-weight: 800; color: #1e293b; }
        .original-match-tag { font-size: 0.7rem; font-weight: 700; color: #3b82f6; background: #eff6ff; padding: 2px 8px; border-radius: 6px; margin-left: 8px; }
        .gem-badge { width: 32px; height: 32px; line-height: 32px; text-align: center; border-radius: 8px; font-size: 0.85rem; font-weight: 900; border: 2px solid; margin: 0 auto; }
        .consensus-meta { font-size: 0.65rem; color: #94a3b8; font-weight: 900; margin-top: 6px; text-align: center; }
        .peer-track { display: flex; gap: 4px; flex-wrap: wrap; }
        .peer-gem { width: 10px; height: 20px; border-radius: 3px; cursor: pointer; }

        .memo-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.7); backdrop-filter: blur(12px); z-index: 5000; display: flex; alignItems: center; justifyContent: center; padding: 40px; }
        .memo-modal-advanced { background: #f8fafc; width: 100%; maxWidth: 1000px; height: 85vh; border-radius: 24px; display: flex; overflow: hidden; box-shadow: 0 40px 100px -12px rgba(0,0,0,0.4); animation: modalPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        @keyframes modalPop { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .memo-modal-sidebar { width: 280px; background: #1e293b; padding: 32px; color: white; display: flex; flex-direction: column; }
        .stat-item { margin-top: 24px; }
        .stat-item label { display: block; font-size: 0.65rem; text-transform: uppercase; font-weight: 800; color: #94a3b8; letter-spacing: 0.1em; }
        .stat-item span { font-size: 0.95rem; font-weight: 600; color: #f8fafc; }
        .memo-modal-main { flex: 1; display: flex; flex-direction: column; background: white; overflow: hidden; }
        .memo-document-container { flex: 1; padding: 40px; display: flex; flex-direction: column; overflow: hidden; }
        .memo-header-formal { border-bottom: 2px solid #f1f5f9; padding-bottom: 24px; margin-bottom: 24px; }
        .memo-title { font-size: 1.25rem; font-weight: 900; color: #0f172a; }
        .memo-scroll-area { flex: 1; overflow-y: auto; padding-right: 10px; }
        .memo-textarea-formal { width: 100%; height: 350px; border: none; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; line-height: 1.7; outline: none; resize: none; color: #334155; }
        
        .memo-references-ui { margin-top: 40px; border-top: 2px dashed #f1f5f9; paddingTop: 24px; }
        .refs-title { font-size: 0.75rem; font-weight: 900; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; }
        .refs-list { display: flex; flex-direction: column; gap: 12px; }
        .ref-item { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: #f8fafc; border-radius: 10px; border: 1px solid #f1f5f9; }
        .ref-meta { font-size: 0.85rem; font-weight: 700; color: #1e293b; }
        .ref-link { font-size: 0.8rem; color: #3b82f6; text-decoration: none; font-family: monospace; font-weight: 600; word-break: break-all; }
        .ref-link:hover { text-decoration: underline; }

        .memo-modal-footer-advanced { padding: 24px 40px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 16px; }
        .btn-copy-modern { background: #0f172a; color: white; padding: 12px 32px; border-radius: 12px; font-weight: 800; border: none; cursor: pointer; transition: all 0.2s; }
        .btn-cancel-modern { background: white; color: #64748b; padding: 12px 24px; border-radius: 12px; font-weight: 800; border: 1px solid #e2e8f0; cursor: pointer; }
        .animate-fade-in { animation: fadeIn 0.6s cubic-bezier(0.23, 1, 0.32, 1); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 2s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>

    </div>
  );
}

function renderAnomalyCard(s: Anomaly, tier: 'critical' | 'moderate' | 'minor', onToggle: (t:string)=>void, selected: Set<string>) {
  const isSelected = selected.has(s.term);
  const tierColors = {
    critical: { bg: '#fff1f2', border: '#fecaca', text: '#9f1239', accent: '#e11d48' },
    moderate: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', accent: '#f59e0b' },
    minor: { bg: '#f8fafc', border: '#e2e8f0', text: '#475569', accent: '#94a3b8' }
  };
  const color = tierColors[tier];
  const distStr = `B:${s.distribution.B}% W:${s.distribution.W}% A:${s.distribution.A}% N:${s.distribution.N}%`;

  return (
    <div key={s.term} onClick={() => onToggle(s.term)} className="anomaly-card" style={{ 
      background: isSelected ? 'white' : color.bg, 
      borderColor: isSelected ? color.accent : color.border,
      borderWidth: '2px', borderStyle: 'solid',
      padding: '16px 20px', borderRadius: '16px', marginBottom: '12px', cursor: 'pointer', transition: 'all 0.2s ease',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <input type="checkbox" checked={isSelected} readOnly style={{ width: '18px', height: '18px', accentColor: color.accent }} />
        <div>
          <div style={{ fontWeight: 900, color: color.text, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>{s.term}</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, marginTop: '2px' }}>{s.soc}</div>
          <div style={{ fontSize: '0.75rem', color: color.accent, fontWeight: 800, marginTop: '6px', background: 'rgba(255,255,255,0.5)', padding: '2px 8px', borderRadius: '4px', width: 'fit-content' }}>
            {s.note}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 900, marginBottom: '4px' }}>Peer Distribution</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 800, color: '#334155', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px' }}>
          {distStr}
        </div>
      </div>
    </div>
  );
}
