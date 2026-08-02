'use client';

import { useState, useEffect } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import './analysis.css';

interface LabelMatch {
  section: string;
  snippet: string;
}

interface AiMatch {
  term: string;
  found: boolean;
  section?: string;
  explanation: string;
}

interface EmergingAe {
  term: string;
  count: number;
  prev_count: number;
  soc: string;
  hlt: string;
  soc_abbrev: string;
  label_matches: LabelMatch[];
  ai_match?: AiMatch;
}

interface TrendPoint {
  timestamp: number;
  cumulative: number;
  count?: number;
}

function EmergingAeAnalysis({ 
  drugName, 
  setId,
  activeTab
}: { 
  drugName?: string, 
  setId?: string,
  activeTab: string
}) {
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [data, setData] = useState<EmergingAe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiMinCount, setAiMinCount] = useState(10);
  const [hasAiResult, setHasAiResult] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);

  // Pagination & Filtering Logic
  const [activeFilters, setActiveFilters] = useState<Set<'exact' | 'semantic' | 'none'>>(new Set(['exact', 'semantic', 'none']));

  // Trend State
  const [selectedAe, setSelectedAe] = useState<EmergingAe | null>(null);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  const toggleFilter = (filter: 'exact' | 'semantic' | 'none') => {
    setActiveFilters(prev => {
        const next = new Set(prev);
        if (next.has(filter)) {
            if (next.size > 1) next.delete(filter); // Don't allow deselecting all
        } else {
            next.add(filter);
        }
        return next;
    });
  };

  useEffect(() => {
    if (setId && drugName) {
        checkExistingAiResults();
    }
  }, [setId, drugName]);

  // Automated scan when tab is active
  useEffect(() => {
    if (activeTab === 'faers-view' && drugName && !data && !loading) {
        runAnalysis();
    }
  }, [activeTab, drugName, data, loading]);

  // Reset to first page when data or itemsPerPage changes
  useEffect(() => {
    setCurrentPage(1);
  }, [data, itemsPerPage]);

  useEffect(() => {
    if (selectedAe) {
        fetchTrend(selectedAe.term);
    }
  }, [selectedAe]);

  const fetchTrend = async (term: string) => {
    setTrendLoading(true);
    try {
        const resp = await fetch('/api/dashboard/faers/trends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drug_name: drugName, terms: [term] })
        });
        const json = await resp.json();
        const rawPoints = json.trends[term] || [];

        // Transform to cumulative format with real timestamps
        let cumulative = 0;
        const formatted: TrendPoint[] = rawPoints.map((p: any) => {
            cumulative += p.count;
            
            const year = parseInt(p.time.substring(0, 4));
            const month = parseInt(p.time.substring(4, 6)) - 1; // 0-indexed
            const day = parseInt(p.time.substring(6, 8) || "01");
            const timestamp = new Date(year, month, day).getTime();

            return {
                timestamp,
                count: p.count,
                cumulative: cumulative
            };
        });

        // Ensure it starts from 0 exactly 5 years ago
        const fiveYearsAgo = new Date();
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
        const startTimestamp = fiveYearsAgo.getTime();

        if (formatted.length > 0) {
            // Sort by timestamp just in case
            formatted.sort((a: TrendPoint, b: TrendPoint) => a.timestamp - b.timestamp);
            
            // If the first data point is after our 5y window start, prepend a 0 point
            if (formatted[0].timestamp > startTimestamp) {
                setTrendData([{ timestamp: startTimestamp, cumulative: 0, count: 0 }, ...formatted]);
            } else {
                setTrendData(formatted);
            }
        } else {
            // Even if no data, show a flat line from 0
            setTrendData([
                { timestamp: startTimestamp, cumulative: 0 },
                { timestamp: new Date().getTime(), cumulative: 0 }
            ]);
        }
    } catch (e) {
        console.error("Failed to fetch trend", e);
    } finally {
        setTrendLoading(false);
    }
  };


  const checkExistingAiResults = async () => {
    try {
        const resp = await fetch(`/api/dashboard/faers/ai_results?set_id=${setId}&drug_name=${encodeURIComponent(drugName || '')}`);
        const json = await resp.json();
        if (json.results) {
            setHasAiResult(true);
            setAiMinCount(json.min_count || 10);
            if (data) {
                applyAiResults(data, json.results);
            }
        }
    } catch (e) {
        console.error("Failed to check AI results", e);
    }
  };

  const applyAiResults = (currentData: EmergingAe[], aiResults: AiMatch[]) => {
    const updated = currentData.map(ae => {
        const aiMatch = aiResults.find(r => r.term.toUpperCase() === ae.term.toUpperCase());
        return { ...ae, ai_match: aiMatch };
    });
    setData(updated);
  };

  const runAnalysis = async () => {
    if (!drugName) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/dashboard/faers/emerging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drug_name: drugName, set_id: setId })
      });
      if (!resp.ok) {
        const errJson = await resp.json();
        throw new Error(errJson.error || 'Failed to fetch analysis');
      }
      const json = await resp.json();
      
      // If we have existing AI results, apply them now
      if (hasAiResult) {
          const aiResp = await fetch(`/api/dashboard/faers/ai_results?set_id=${setId}&drug_name=${encodeURIComponent(drugName || '')}`);
          const aiJson = await aiResp.json();
          if (aiJson.results) {
              applyAiResults(json.emerging, aiJson.results);
          } else {
              setData(json.emerging);
          }
      } else {
          setData(json.emerging);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runAiMatch = async () => {
    if (!data || !setId || !drugName) return;
    
    // Identify undocumented terms with count >= aiMinCount
    const targetTerms = data
        .filter(ae => ae.label_matches.length === 0 && ae.count >= aiMinCount)
        .map(ae => ({ term: ae.term, count: ae.count }));

    if (targetTerms.length === 0) {
        alert(`No undocumented terms found with report count >= ${aiMinCount}`);
        return;
    }

    setAiLoading(true);
    try {
        const resp = await fetch('/api/dashboard/faers/ai_rematch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                set_id: setId,
                drug_name: drugName,
                terms: targetTerms,
                min_count: aiMinCount
            })
        });
        if (!resp.ok) {
            const errJson = await resp.json();
            throw new Error(errJson.error || 'AI rematch failed');
        }
        const json = await resp.json();
        applyAiResults(data, json.results);
        setHasAiResult(true);
    } catch (err: any) {
        alert("AI Semantic Matching Error: " + err.message);
    } finally {
        setAiLoading(false);
    }
  };

  // Pagination & Filtering Logic
  const filteredData = data ? data.filter(ae => {
    const isExact = ae.label_matches && ae.label_matches.length > 0;
    const isSemantic = ae.ai_match?.found === true;
    const isNone = !isExact && !isSemantic;

    if (activeFilters.has('exact') && isExact) return true;
    if (activeFilters.has('semantic') && isSemantic) return true;
    if (activeFilters.has('none') && isNone) return true;
    return false;
  }) : [];

  const totalItems = filteredData.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="chart-card full-width" style={{ marginTop: '0', borderTop: 'none', paddingTop: '0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.5rem' }}>🆕</span>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Emerging Adverse Events (Last 5 Years Only)</h3>
        </div>
        {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="loader" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: '#0071bc' }}></div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>Analyzing Reports...</span>
            </div>
        )}
      </div>

      <div style={{ 
          marginTop: '16px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          background: '#eff6ff', 
          padding: '12px 20px', 
          borderRadius: '10px', 
          border: '1px solid #dbeafe' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>🤖</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e40af' }}>AI Semantic Matcher</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#60a5fa' }}>Min Reports:</label>
                <input 
                    type="number" 
                    value={aiMinCount} 
                    onChange={(e) => setAiMinCount(parseInt(e.target.value) || 0)}
                    style={{ 
                        width: '60px', 
                        padding: '4px 8px', 
                        borderRadius: '6px', 
                        border: '1px solid #bfdbfe', 
                        fontSize: '0.75rem', 
                        fontWeight: 700 
                    }}
                />
            </div>
        </div>
        <button 
            onClick={runAiMatch}
            disabled={aiLoading || !data}
            style={{ 
                backgroundColor: aiLoading ? '#94a3b8' : '#3b82f6', 
                color: 'white', 
                padding: '6px 16px', 
                borderRadius: '6px', 
                fontSize: '0.75rem', 
                fontWeight: 800, 
                border: 'none', 
                cursor: (aiLoading || !data) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}
        >
            {aiLoading ? 'Processing AI...' : (hasAiResult ? '🔄 AI Semantic Rematch' : '✨ AI Semantic Check')}
        </button>
      </div>
      
      <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '12px', marginBottom: '20px', maxWidth: '900px', lineHeight: '1.5', padding: '0 4px' }}>
        Identifies reactions present in the <strong>recent 5 years</strong> of reports but absent in the previous 5 years. 
        String matching verifies exact label presence; <strong>AI Semantic Matcher</strong> uses LLMs to find undocumented terms mentioned via synonyms or clinical context.
      </p>

      {error && (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fee2e2', color: '#991b1b', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.8rem' }}>
            <strong>Analysis Error:</strong> {error}
        </div>
      )}

      {data && (
        <div className="table-container" style={{ marginTop: '0', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', padding: '0 4px' }}>
              <button 
                onClick={() => toggleFilter('exact')}
                style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    border: '1px solid',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backgroundColor: activeFilters.has('exact') ? '#dcfce7' : 'transparent',
                    color: activeFilters.has('exact') ? '#166534' : '#64748b',
                    borderColor: activeFilters.has('exact') ? '#22c55e' : '#e2e8f0',
                }}
              >
                  {activeFilters.has('exact') ? '✓ ' : ''}Exact Match
              </button>
              <button 
                onClick={() => toggleFilter('semantic')}
                style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    border: '1px solid',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backgroundColor: activeFilters.has('semantic') ? '#ecfdf5' : 'transparent',
                    color: activeFilters.has('semantic') ? '#065f46' : '#64748b',
                    borderColor: activeFilters.has('semantic') ? '#10b981' : '#e2e8f0',
                }}
              >
                  {activeFilters.has('semantic') ? '✓ ' : ''}Semantic Match
              </button>
              <button 
                onClick={() => toggleFilter('none')}
                style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    border: '1px solid',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backgroundColor: activeFilters.has('none') ? '#fef2f2' : 'transparent',
                    color: activeFilters.has('none') ? '#991b1b' : '#64748b',
                    borderColor: activeFilters.has('none') ? '#ef4444' : '#e2e8f0',
                }}
              >
                  {activeFilters.has('none') ? '✓ ' : ''}Not Matched
              </button>
          </div>

          <table className="coverage-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0', background: '#f1f5f9' }}>
                <th style={{ padding: '10px 12px', width: '22%' }}>Emerging AE (MedDRA PT)</th>
                <th style={{ padding: '10px 12px', width: '8%' }}>Reports</th>
                <th style={{ padding: '10px 12px', width: '18%' }}>SOC Hierarchy</th>
                <th style={{ padding: '10px 12px', width: '26%' }}>Direct Match Context</th>
                <th style={{ padding: '10px 12px', width: '26%' }}>AI Semantic Validation</th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.length > 0 ? paginatedData.map((ae, i) => (
                <tr 
                    key={i} 
                    onClick={() => setSelectedAe(ae)}
                    style={{ 
                        borderBottom: '1px solid #f1f5f9', 
                        verticalAlign: 'top',
                        cursor: 'pointer',
                        backgroundColor: selectedAe?.term === ae.term ? '#f1f7fd' : 'transparent',
                        transition: 'background-color 0.2s ease'
                    }}
                    onMouseOver={e => { if (selectedAe?.term !== ae.term) e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                    onMouseOut={e => { if (selectedAe?.term !== ae.term) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <td style={{ padding: '12px', fontWeight: 700, color: '#0f172a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {selectedAe?.term === ae.term && <span style={{ color: '#0071bc' }}>→</span>}
                        {ae.term}
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontWeight: 800, color: '#334155', fontSize: '0.75rem' }}>
                        {ae.count}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{ae.soc}</div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500, marginTop: '2px' }}>{ae.hlt}</div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {ae.label_matches && ae.label_matches.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {ae.label_matches.map((match, mIdx) => (
                          <div key={mIdx} style={{ background: '#f0fdf4', padding: '8px', borderRadius: '6px', borderLeft: '3px solid #22c55e' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#166534', marginBottom: '4px', textTransform: 'uppercase' }}>
                                Found in: {match.section}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#334155', lineHeight: 1.4, fontStyle: 'italic' }}>
                                "...{match.snippet}..."
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991b1b', background: '#fef2f2', padding: '6px 12px', borderRadius: '6px', width: 'fit-content', fontSize: '0.7rem', fontWeight: 800 }}>
                        <span style={{ fontSize: '1rem' }}>⚠</span> NOT FOUND (EXACT)
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px' }}>
                    {ae.ai_match ? (
                        <div style={{ 
                            background: ae.ai_match.found ? '#ecfdf5' : '#fff7ed', 
                            padding: '10px', 
                            borderRadius: '8px', 
                            border: `1px solid ${ae.ai_match.found ? '#10b981' : '#f97316'}` 
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '0.9rem' }}>{ae.ai_match.found ? '✅' : '❓'}</span>
                                <span style={{ 
                                    fontSize: '0.7rem', 
                                    fontWeight: 800, 
                                    color: ae.ai_match.found ? '#065f46' : '#9a3412',
                                    textTransform: 'uppercase'
                                }}>
                                    {ae.ai_match.found ? `Semantic Match: ${ae.ai_match.section || 'General'}` : 'Still Undocumented'}
                                </span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#334155', lineHeight: 1.4 }}>
                                {ae.ai_match.explanation}
                            </div>
                        </div>
                    ) : (
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', padding: '10px', textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                            {ae.label_matches.length > 0 ? 'Verified by exact match' : (ae.count < aiMinCount ? 'Below AI count threshold' : 'Pending AI evaluation')}
                        </div>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontStyle: 'italic' }}>
                    No entirely new AE terms found in the recent period for this drug.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Show:</label>
                    <select 
                        value={itemsPerPage} 
                        onChange={(e) => setItemsPerPage(parseInt(e.target.value))}
                        style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600 }}
                    >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                    </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button 
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        style={{ 
                            padding: '6px 12px', 
                            borderRadius: '6px', 
                            border: '1px solid #e2e8f0', 
                            background: currentPage === 1 ? '#f8fafc' : 'white', 
                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: currentPage === 1 ? '#cbd5e1' : '#334155'
                        }}
                    >
                        Previous
                    </button>
                    
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                        Page {currentPage} of {totalPages}
                    </span>

                    <button 
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        style={{ 
                            padding: '6px 12px', 
                            borderRadius: '6px', 
                            border: '1px solid #e2e8f0', 
                            background: currentPage === totalPages ? '#f8fafc' : 'white', 
                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: currentPage === totalPages ? '#cbd5e1' : '#334155'
                        }}
                    >
                        Next
                    </button>
                </div>
            </div>
          )}
          <div style={{ marginTop: '12px', fontSize: '0.7rem', color: '#94a3b8', textAlign: 'right', fontWeight: 500 }}>
            Analysis Engine: Hybrid exact-string + semantic-AI. Results cached in project database.
          </div>

          {/* Trend Chart Section */}
          <div style={{ 
              marginTop: '30px', 
              padding: '24px', 
              background: '#ffffff', 
              borderRadius: '16px', 
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>
                    {selectedAe ? `Cumulative Reporting Trend: ${selectedAe.term}` : 'Select an AE term above to view reporting trend'}
                </h4>
                {selectedAe && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                        Total Reports: <span style={{ color: '#0071bc', fontWeight: 800 }}>{selectedAe.count}</span>
                    </div>
                )}
            </div>

            <div style={{ height: '300px', width: '100%', position: 'relative' }}>
                {trendLoading ? (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.8)', zIndex: 10 }}>
                        <div className="loader"></div>
                    </div>
                ) : trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#0071bc" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#0071bc" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                                dataKey="timestamp" 
                                type="number"
                                domain={['dataMin', 'dataMax']}
                                fontSize={11} 
                                tickLine={false} 
                                axisLine={false} 
                                tick={{ fill: '#94a3b8' }}
                                minTickGap={30}
                                tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                            />
                            <YAxis 
                                fontSize={11} 
                                tickLine={false} 
                                axisLine={false} 
                                tick={{ fill: '#94a3b8' }}
                            />
                            <Tooltip 
                                labelFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                itemStyle={{ fontWeight: 700, fontSize: '0.85rem' }}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="cumulative" 
                                stroke="#0071bc" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorCumulative)" 
                                name="Cumulative Reports"
                                animationDuration={1000}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #e2e8f0' }}>
                        <span style={{ fontSize: '2rem', marginBottom: '8px' }}>📈</span>
                        <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {selectedAe ? 'No trend data available for this term.' : 'Click a row in the table above to analyze its growth.'}
                        </p>
                    </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FaersView({ 
  activeTab, 
  drugName,
  setId
}: { 
  activeTab: string;
  drugName?: string;
  setId?: string;
}) {
  return (
    <div id="faers-view" className={`tab-content ${activeTab === 'faers-view' ? 'active' : ''}`} style={{ display: activeTab === 'faers-view' ? 'block' : 'none' }}>
        <div id="faers-loading" className="loader"></div>
        <div id="dashboard-content" className="dashboard-grid" style={{ display: 'none' }}>
            <EmergingAeAnalysis drugName={drugName} setId={setId} activeTab={activeTab} />
        </div>
    </div>
  );
}
