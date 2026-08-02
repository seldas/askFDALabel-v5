'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '../../../components/Header';
import { useUser } from '../../../context/UserContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import Modal from '../../../components/Modal';
import { withAppBase } from '../../../utils/appPaths';

interface ReportDetail {
  report: {
    id: number;
    target_pt: string;
    project_title: string;
    created_at: string;
    status: string;
  };
  frequent_contexts: Array<{
    snippet: string;
    count: number;
    set_ids: string[];
  }>;
  results: Array<{
    set_id: string;
    brand_name: string;
    generic_name: string;
    is_labeled: boolean;
    found_sections: Array<{ section: string; snippet: string }>;
    faers_count: number;
    faers_1yr_count: number;
    faers_5yr_count: number;
  }>;
}

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

export default function AEReportPage() {
  const { reportId } = useParams();
  const router = useRouter();
  const { session, loading: sessionLoading } = useUser();
  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedContexts, setExpandedContexts] = useState<Record<number, boolean>>({});
  const [showChartModal, setShowChartModal] = useState(false);
  const [chartType, setChartType] = useState<'total' | '1yr'>('total');

  // Sorting
  const [sortField, setSortField] = useState<'brand_name' | 'faers_count' | 'faers_1yr_count' | 'faers_5yr_count' | 'is_labeled'>('faers_count');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    async function fetchDetail() {
      try {
        const res = await fetch(`/api/dashboard/ae_report/detail/${reportId}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        } else {
          setError('Failed to load report details.');
        }
      } catch (err) {
        setError('Network error occurred.');
      } finally {
        setLoading(false);
      }
    }
    if (reportId) fetchDetail();
  }, [reportId]);

  const sortedResults = useMemo(() => {
    if (!data) return [];
    return [...data.results].sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      
      if (typeof valA === 'boolean') {
        valA = valA ? 1 : 0;
        valB = valB ? 1 : 0;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortOrder]);

  const { stats, chartData } = useMemo(() => {
    if (!data) return { stats: null, chartData: [] };

    // Group by unique drug name (Generic if available, otherwise Brand)
    const drugMap: Record<string, { total: number; yr1: number; brand: string }> = {};
    
    data.results.forEach(res => {
      const name = (res.generic_name || res.brand_name || 'Unknown').split(',')[0].trim();
      if (!drugMap[name]) {
        drugMap[name] = { total: res.faers_count || 0, yr1: res.faers_1yr_count || 0, brand: res.brand_name };
      }
    });

    const uniqueDrugs = Object.entries(drugMap);
    const totalFaers = uniqueDrugs.reduce((sum, [_, val]) => sum + val.total, 0);
    const total1yr = uniqueDrugs.reduce((sum, [_, val]) => sum + val.yr1, 0);
    
    const labeled = data.results.filter(r => r.is_labeled).length;
    const total = data.results.length;

    // Prepare chart data (Top 10 drugs + Others)
    const sortedForChart = uniqueDrugs
      .map(([name, val]) => ({ 
        name, 
        total: val.total, 
        yr1: val.yr1,
        brand: val.brand
      }))
      .sort((a, b) => b[chartType === 'total' ? 'total' : 'yr1'] - a[chartType === 'total' ? 'total' : 'yr1']);

    const top10 = sortedForChart.slice(0, 10);
    const others = sortedForChart.slice(10);
    
    const finalChartData = top10.map(d => ({ 
      name: d.name, 
      value: chartType === 'total' ? d.total : d.yr1 
    }));

    if (others.length > 0) {
      const othersValue = others.reduce((sum, d) => sum + (chartType === 'total' ? d.total : d.yr1), 0);
      if (othersValue > 0) {
        finalChartData.push({ name: 'Others', value: othersValue });
      }
    }

    return { 
      stats: { 
        total, 
        labeled, 
        totalFaers, 
        total1yr, 
        percentLabeled: ((labeled / total) * 100).toFixed(1) 
      },
      chartData: finalChartData.filter(d => d.value > 0)
    };
  }, [data, chartType]);

  if (loading) return <div style={{ padding: '100px', textAlign: 'center' }}><div className="loader" style={{ margin: '0 auto' }} /></div>;
  if (error || !data) return <div style={{ padding: '100px', textAlign: 'center', color: '#ef4444' }}>{error || 'Report not found.'}</div>;

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      <Header activeApp="dashboard" />
      
      <div className="hp-container" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header Section */}
        <div style={{ 
          background: 'white', 
          borderRadius: '24px', 
          padding: '2rem', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
          marginBottom: '2rem',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AE Profile Report</span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>{new Date(data.report.created_at).toLocaleDateString()}</span>
              </div>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>{data.report.target_pt}</h1>
              <p style={{ fontSize: '1.1rem', color: '#64748b', marginTop: '0.5rem' }}>Project: <strong>{data.report.project_title}</strong></p>
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={async () => {
                  const res = await fetch(`/api/dashboard/ae_report/export/${reportId}`);
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `AE_Report_${data.report.target_pt.replace(/ /g, '_')}.xlsx`;
                    a.click();
                  } else {
                    alert('Failed to export report.');
                  }
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '12px',
                  background: '#ecfeff',
                  color: '#0891b2',
                  border: '1px solid #cffafe',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>📊</span> Download Excel
              </button>

              <button 
                onClick={async () => {
                  const res = await fetch(`/api/dashboard/ae_report/export_json/${reportId}`);
                  if (res.ok) {
                    const json = await res.json();
                    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `AE_AI_Data_${data.report.target_pt.replace(/ /g, '_')}.json`;
                    a.click();
                  } else {
                    alert('Failed to export JSON.');
                  }
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '12px',
                  background: '#f5f3ff',
                  color: '#5b21b6',
                  border: '1px solid #ddd6fe',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>🤖</span> JSON for AI
              </button>

              <button 
                onClick={() => window.print()}
              style={{
                padding: '10px 20px',
                borderRadius: '12px',
                background: '#f1f5f9',
                color: '#475569',
                border: 'none',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>🖨️</span> Print Report
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginTop: '2rem' }}>
            <StatCard label="Total Labels" value={stats?.total || 0} icon="📄" color="#6366f1" />
            <StatCard label="Labeled Presence" value={`${stats?.labeled} (${stats?.percentLabeled}%)`} icon="✅" color="#10b981" />
            <div onClick={() => { setChartType('total'); setShowChartModal(true); }} style={{ cursor: 'pointer' }}>
              <StatCard label="Total FAERS Cases" value={stats?.totalFaers?.toLocaleString() || 0} icon="📊" color="#f59e0b" badge="Click for Chart" />
            </div>
            <div onClick={() => { setChartType('1yr'); setShowChartModal(true); }} style={{ cursor: 'pointer' }}>
              <StatCard label="Last Year Cases" value={stats?.total1yr?.toLocaleString() || 0} icon="📅" color="#0ea5e9" badge="Click for Chart" />
            </div>
          </div>
        </div>

        {/* Chart Modal */}
        <Modal 
          isOpen={showChartModal} 
          onClose={() => setShowChartModal(false)} 
          title={`${chartType === 'total' ? 'Total' : 'Last Year'} AE Case Distribution`}
        >
          <div style={{ height: '400px', width: '100%', marginTop: '1rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                  outerRadius={130}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Modal>

        {/* Context Ranking Table */}
        {data.frequent_contexts && data.frequent_contexts.length > 0 && (
          <div style={{ 
            background: 'white', 
            borderRadius: '24px', 
            padding: '2rem', 
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
            marginBottom: '2rem',
            border: '1px solid #e2e8f0'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>📈</span> Most Frequent Labeling Contexts
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.5rem', fontStyle: 'italic' }}>
              Phrases are grouped by semantic similarity (80% threshold). Document counts reflect unique labels containing at least one mention in the group.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.frequent_contexts.map((ctx, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  gap: '20px', 
                  padding: '1.25rem', 
                  background: '#f8fafc', 
                  borderRadius: '16px',
                  border: '1px solid #f1f5f9',
                  alignItems: 'center'
                }}>
                  <div style={{ 
                    minWidth: '40px', 
                    height: '40px', 
                    borderRadius: '50%', 
                    background: '#6366f1', 
                    color: 'white', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontWeight: 900,
                    fontSize: '0.9rem'
                  }}>
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1, fontSize: '0.9rem', color: '#334155', lineHeight: '1.5', fontStyle: 'italic' }}>
                    "...<HighlightedText text={ctx.snippet} highlight={data.report.target_pt} />..."
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '120px', position: 'relative' }}>
                    <div 
                      onClick={() => {
                        if (ctx.count < 5) {
                          setExpandedContexts(prev => ({ ...prev, [idx]: !prev[idx] }));
                        }
                      }}
                      style={{ 
                        fontSize: '1.25rem', 
                        fontWeight: 900, 
                        color: '#6366f1',
                        cursor: ctx.count < 5 ? 'pointer' : 'default',
                        textDecoration: ctx.count < 5 ? 'underline' : 'none',
                        textDecorationStyle: 'dashed',
                        display: 'inline-block'
                      }}
                      title={ctx.count < 5 ? "Click to see documents" : ""}
                    >
                      {ctx.count}
                    </div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Documents</div>
                    
                    {expandedContexts[idx] && ctx.set_ids && (
                      <div style={{ 
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '10px', 
                        width: '180px',
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '6px',
                        fontSize: '0.75rem',
                        textAlign: 'left',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        padding: '12px',
                        background: 'white',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                        zIndex: 100
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                          <span style={{ fontWeight: 800, color: '#475569', fontSize: '0.65rem', textTransform: 'uppercase' }}>Label IDs</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setExpandedContexts(prev => ({ ...prev, [idx]: false })); }}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', color: '#94a3b8', padding: 0 }}
                          >
                            ×
                          </button>
                        </div>
                        {ctx.set_ids.map(sid => (
                          <a 
                            key={sid} 
                            href={withAppBase(`/dashboard/label/${sid}`)} 
                            target="_blank" 
                            rel="noreferrer"
                            style={{ 
                              color: '#6366f1', 
                              textDecoration: 'none', 
                              fontWeight: 600,
                              padding: '4px 6px',
                              borderRadius: '4px',
                              background: '#f8fafc',
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            className="sid-link"
                          >
                            📄 {sid.slice(0, 12)}...
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results Table */}
        <div style={{ 
          background: 'white', 
          borderRadius: '24px', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Labeling & FAERS Analysis</h2>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Showing {data.results.length} labeling documents</div>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                  <Th label="Drug Product" field="brand_name" current={sortField} order={sortOrder} onClick={setSortField} setOrder={setSortOrder} />
                  <Th label="Labeled?" field="is_labeled" current={sortField} order={sortOrder} onClick={setSortField} setOrder={setSortOrder} />
                  <Th label="Sections Mentioned" field={null} />
                  <Th label="All Cases" field="faers_count" current={sortField} order={sortOrder} onClick={setSortField} setOrder={setSortOrder} />
                  <Th label="Last 5y" field="faers_5yr_count" current={sortField} order={sortOrder} onClick={setSortField} setOrder={setSortOrder} />
                  <Th label="Last 1y" field="faers_1yr_count" current={sortField} order={sortOrder} onClick={setSortField} setOrder={setSortOrder} />
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((res, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f8fafc', transition: 'background 0.2s' }} className="table-row">
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{res.brand_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>{res.set_id}</div>
                    </td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      {res.is_labeled ? (
                        <span style={{ padding: '4px 10px', background: '#dcfce7', color: '#166534', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 800 }}>LABELED</span>
                      ) : (
                        <span style={{ padding: '4px 10px', background: '#f1f5f9', color: '#64748b', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 800 }}>NOT MENTIONED</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      {res.found_sections.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {res.found_sections.map((s, i) => (
                              <span key={i} title={s.snippet} style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#fef3c7', color: '#92400e', borderRadius: '4px', fontWeight: 600, border: '1px solid #fde68a' }}>{s.section}</span>
                            ))}
                          </div>
                          {res.found_sections[0] && (
                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              "<HighlightedText text={res.found_sections[0].snippet} highlight={data.report.target_pt} />"
                            </div>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontWeight: 700, color: '#1e293b' }}>{res.faers_count?.toLocaleString() || 0}</td>
                    <td style={{ padding: '1rem 1.5rem', fontWeight: 700, color: '#64748b' }}>{res.faers_5yr_count?.toLocaleString() || 0}</td>
                    <td style={{ padding: '1rem 1.5rem', fontWeight: 700, color: '#0ea5e9' }}>{res.faers_1yr_count?.toLocaleString() || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <style jsx>{`
        .table-row:hover {
          background-color: #f1f5f9;
        }
        .sid-link:hover {
          background-color: #eef2ff !important;
          color: #4338ca !important;
        }
        .loader {
          border: 4px solid #f3f3f3;
          border-radius: 50%;
          border-top: 4px solid #6366f1;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}

function StatCard({ label, value, icon, color, badge }: { label: string, value: string | number, icon: string, color: string, badge?: string }) {
  return (
    <div style={{ padding: '1.25rem', borderRadius: '16px', border: '1px solid #f1f5f9', backgroundColor: '#fafafa', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem' }}>{icon}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 900, color }}>{value}</div>
      {badge && (
        <div style={{ 
          position: 'absolute', 
          top: '10px', 
          right: '10px', 
          fontSize: '0.6rem', 
          fontWeight: 900, 
          padding: '2px 6px', 
          background: '#f1f5f9', 
          color: '#64748b', 
          borderRadius: '4px',
          textTransform: 'uppercase'
        }}>
          {badge}
        </div>
      )}
    </div>
  );
}

function Th({ label, field, current, order, onClick, setOrder }: any) {
  const isCurrent = field === current;
  return (
    <th 
      onClick={() => {
        if (!field) return;
        if (isCurrent) {
          setOrder(order === 'asc' ? 'desc' : 'asc');
        } else {
          onClick(field);
          setOrder('desc');
        }
      }}
      style={{ 
        padding: '12px 1.5rem', 
        fontSize: '0.75rem', 
        fontWeight: 800, 
        color: '#475569', 
        textTransform: 'uppercase', 
        cursor: field ? 'pointer' : 'default',
        userSelect: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {label}
        {field && (
          <span style={{ color: isCurrent ? '#6366f1' : '#cbd5e1' }}>
            {isCurrent ? (order === 'asc' ? '↑' : '↓') : '⇅'}
          </span>
        )}
      </div>
    </th>
  );
}

function HighlightedText({ text, highlight }: { text: string, highlight: string }) {
  if (!highlight.trim()) return <span>{text}</span>;
  
  const regex = new RegExp(`(${highlight})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <span key={i} style={{ backgroundColor: '#bfdbfe', color: '#1e3a8a', padding: '0 2px', borderRadius: '2px', fontWeight: 700 }}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  );
}
