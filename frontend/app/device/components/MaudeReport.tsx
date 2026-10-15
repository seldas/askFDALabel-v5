import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell
} from 'recharts';

interface MaudeReportProps {
  productCode: string;
  kNumber?: string;
  onClose: () => void;
}

export default function MaudeReport({ productCode, kNumber, onClose }: MaudeReportProps) {
  const [data, setData] = useState<any>(null);
  const [recallData, setRecallData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSafetyData() {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/device/safety/${productCode}${kNumber ? `?id=${kNumber}` : ''}`;
        const recallUrl = `/api/device/recalls/${productCode}${kNumber ? `?id=${kNumber}` : ''}`;
        
        const [resp, recallResp] = await Promise.all([
          fetch(url),
          fetch(recallUrl)
        ]);
        
        const result = await resp.json();
        const recallResult = await recallResp.json();
        
        if (result.error) {
            setError(result.error);
        } else {
            setData(result);
            setRecallData(recallResult);
        }
      } catch (err) {
        console.error("Failed to fetch safety data", err);
        setError("Connectivity issue detected while reaching safety intelligence endpoints.");
      } finally {
        setLoading(false);
      }
    }
    fetchSafetyData();
  }, [productCode, kNumber]);

  const COLORS = ['#b82323', '#b86200', '#0759a5', '#2d7a4c', '#12375b'];

  const cardStyle = {
    backgroundColor: 'var(--fdl-paper, #ffffff)',
    borderRadius: 'var(--fdl-radius-sm, 2px)',
    boxShadow: '0 12px 32px rgba(7, 31, 61, 0.18)',
    padding: '1.5rem',
    width: '100%',
    maxWidth: '900px',
    border: '1px solid var(--fdl-line, #b8c8d7)',
    borderTop: '3px solid var(--fdl-navy-800, #12375b)',
    position: 'relative' as const,
    animation: 'slideUp 0.2s ease-out',
    maxHeight: '90vh',
    overflowY: 'auto' as const
  };

  const sectionStyle = {
    backgroundColor: 'var(--fdl-canvas, #f3f6f8)',
    padding: '1rem',
    borderRadius: 'var(--fdl-radius-sm, 2px)',
    border: '1px solid var(--fdl-line-soft, #d7e0e7)',
  };

  if (loading) return (
    <div style={{ padding: '2.5rem', textAlign: 'center', backgroundColor: 'var(--fdl-paper, #ffffff)', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', borderTop: '3px solid var(--fdl-navy-800, #12375b)', fontWeight: 700, color: 'var(--fdl-blue-700, #0759a5)', fontSize: '0.9rem' }}>
      <div className="loader" style={{ margin: '0 auto 1rem auto' }}></div>
      Synchronizing MAUDE & Recall Intelligence...
    </div>
  );

  if (error) return (
    <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#fff7ed', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid #fdba74', borderTop: '3px solid #c2410c', maxWidth: '600px' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
      <h3 style={{ color: '#c2410c', fontWeight: 800, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Data Source Restricted</h3>
      <p style={{ color: '#9a3412', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{error}</p>
      <button 
        onClick={onClose}
        style={{ padding: '8px 16px', backgroundColor: '#c2410c', color: 'white', border: 'none', borderRadius: 'var(--fdl-radius-sm, 2px)', fontWeight: 700, fontSize: '0.825rem', cursor: 'pointer' }}
      >
        Close Dashboard
      </button>
    </div>
  );

  if (!data) return (
    <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#fef2f2', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid #fecaca', fontWeight: 700, color: '#b91c1c', fontSize: '0.9rem' }}>
      Failed to synchronize safety data.
    </div>
  );

  return (
    <div style={cardStyle} className="custom-scrollbar">
      {/* Close Button */}
      <button 
        onClick={onClose} 
        style={{ 
          position: 'absolute', 
          top: '14px', 
          right: '14px', 
          background: 'var(--fdl-paper, #ffffff)', 
          border: '1px solid var(--fdl-line, #b8c8d7)', 
          width: '30px', 
          height: '30px', 
          borderRadius: 'var(--fdl-radius-sm, 2px)', 
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fdl-ink-soft, #273843)',
          transition: 'all 0.15s',
          zIndex: 10
        }}
        onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--fdl-canvas, #f3f6f8)'}
        onMouseOut={e => e.currentTarget.style.backgroundColor = 'var(--fdl-paper, #ffffff)'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div style={{ marginBottom: '1.25rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)', paddingBottom: '0.875rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ padding: '2px 8px', backgroundColor: 'var(--fdl-blue-050, #edf4fa)', color: 'var(--fdl-blue-700, #0759a5)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', borderRadius: 'var(--fdl-radius-sm, 2px)', fontSize: '0.68rem', fontWeight: 800 }}>CODE: {productCode}</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', margin: 0 }}>
              Analyzed Company: {data.target_manufacturer || 'N/A'}
            </h2>
        </div>
        <p style={{ fontSize: '0.825rem', color: 'var(--fdl-muted, #5e6e7c)', fontWeight: 500, margin: 0 }}>
          Safety Intelligence Profile for {kNumber} (MAUDE & Recalls)
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        {/* Event Type Breakdown */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--fdl-muted, #5e6e7c)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Event Distribution</h3>
          <div style={{ height: '180px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.event_types} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--fdl-line-soft, #d7e0e7)" />
                <XAxis type="number" hide />
                <YAxis dataKey="term" type="category" width={80} tick={{ fontSize: 9, fontWeight: 700, fill: '#5e6e7c' }} />
                <Tooltip 
                  cursor={{ fill: 'var(--fdl-canvas, #f3f6f8)' }}
                  contentStyle={{ borderRadius: '2px', border: '1px solid #b8c8d7', boxShadow: '0 4px 12px rgba(7,31,61,0.08)', padding: '6px 10px', fontSize: '0.75rem' }}
                />
                <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                  {data.event_types?.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Manufacturers */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--fdl-muted, #5e6e7c)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Key Manufacturers</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.manufacturers?.slice(0, 4).map((m: any, idx: number) => (
              <div key={idx} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '7px 10px', 
                backgroundColor: 'var(--fdl-paper, #ffffff)', 
                borderRadius: 'var(--fdl-radius-sm, 2px)', 
                border: '1px solid var(--fdl-line-soft, #d7e0e7)'
              }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--fdl-ink, #132332)', maxWidth: '65%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.term}</span>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, backgroundColor: 'var(--fdl-blue-050, #edf4fa)', color: 'var(--fdl-blue-700, #0759a5)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', padding: '2px 6px', borderRadius: 'var(--fdl-radius-sm, 2px)' }}>{m.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recall Intelligence Section */}
      {recallData && (
        <div style={{ ...sectionStyle, marginBottom: '1.25rem', backgroundColor: '#fff1f2', borderColor: '#fecdd3' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.7rem', fontWeight: 800, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Recall & Enforcement Actions</h3>
            {kNumber && (
               <span style={{ fontSize: '0.68rem', fontWeight: 800, backgroundColor: '#f43f5e', color: 'white', padding: '3px 8px', borderRadius: 'var(--fdl-radius-sm, 2px)' }}>
                 This Manufacturer: {recallData.manufacturer_specific_recalls || 0} Recalls
               </span>
            )}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
             <div style={{ backgroundColor: 'var(--fdl-paper, #ffffff)', padding: '10px', borderRadius: 'var(--fdl-radius-sm, 2px)', textAlign: 'center', border: '1px solid #fecdd3' }}>
                <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#fb7185', textTransform: 'uppercase', margin: 0 }}>Class I</p>
                <p style={{ fontSize: '1.35rem', fontWeight: 800, color: '#e11d48', margin: '4px 0 0' }}>{recallData.class_i}</p>
             </div>
             <div style={{ backgroundColor: 'var(--fdl-paper, #ffffff)', padding: '10px', borderRadius: 'var(--fdl-radius-sm, 2px)', textAlign: 'center', border: '1px solid #fecdd3' }}>
                <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#fb7185', textTransform: 'uppercase', margin: 0 }}>Class II</p>
                <p style={{ fontSize: '1.35rem', fontWeight: 800, color: '#e11d48', margin: '4px 0 0' }}>{recallData.class_ii}</p>
             </div>
             <div style={{ backgroundColor: 'var(--fdl-paper, #ffffff)', padding: '10px', borderRadius: 'var(--fdl-radius-sm, 2px)', textAlign: 'center', border: '1px solid #fecdd3' }}>
                <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#fb7185', textTransform: 'uppercase', margin: 0 }}>Class III</p>
                <p style={{ fontSize: '1.35rem', fontWeight: 800, color: '#e11d48', margin: '4px 0 0' }}>{recallData.class_iii}</p>
             </div>
          </div>
          
          {recallData.recent_recalls?.length > 0 && (
             <div>
                <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#9f1239', textTransform: 'uppercase', marginBottom: '6px' }}>Recent Class Events (Product Code: {productCode})</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                   {recallData.recent_recalls.slice(0, 3).map((r: any, idx: number) => (
                      <div key={idx} style={{ backgroundColor: 'var(--fdl-paper, #ffffff)', padding: '7px 10px', borderRadius: 'var(--fdl-radius-sm, 2px)', fontSize: '0.75rem', color: '#4c0519', border: '1px solid #fecdd3', display: 'flex', justifyContent: 'space-between' }}>
                         <span style={{ fontWeight: 600, maxWidth: '70%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.recalling_firm}</span>
                         <span style={{ fontWeight: 800, color: '#e11d48' }}>{r.recall_initiation_date}</span>
                      </div>
                   ))}
                </div>
             </div>
          )}
        </div>
      )}

      <div style={{ textAlign: 'center', padding: '8px 12px', backgroundColor: '#fffbeb', borderRadius: 'var(--fdl-radius-sm, 2px)', color: '#92400e', fontSize: '0.7rem', fontWeight: 600, border: '1px solid #fde68a' }}>
        NOTICE: MAUDE data represents clinical report counts and does not establish a definitive causal relationship.
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
