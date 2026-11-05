"use client";

import React, { useState, useEffect } from 'react';

interface DeviceCompareProps {
  device1: { id: string, name: string };
  device2: { id: string, name: string };
  onClose: () => void;
}

export default function DeviceCompare({ device1, device2, onClose }: DeviceCompareProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchComparison() {
      setLoading(true);
      try {
        const resp = await fetch(`/api/device/compare?id1=${device1.id}&id2=${device2.id}`);
        const result = await resp.json();
        setData(result);
      } catch (err) {
        console.error("Comparison failed", err);
      } finally {
        setLoading(false);
      }
    }
    fetchComparison();
  }, [device1.id, device2.id]);

  const cardStyle = {
    backgroundColor: 'var(--fdl-paper, #ffffff)',
    borderRadius: 'var(--fdl-radius-sm, 2px)',
    boxShadow: '0 12px 32px rgba(7, 31, 61, 0.18)',
    padding: '2rem 2.5rem',
    width: '100%',
    maxWidth: '1000px',
    border: '1px solid var(--fdl-line, #b8c8d7)',
    borderTop: '3px solid var(--fdl-navy-800, #12375b)',
    position: 'relative' as const,
    animation: 'slideUp 0.2s ease-out',
    maxHeight: '90vh',
    overflowY: 'auto' as const
  };

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', backgroundColor: 'var(--fdl-paper, #ffffff)', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', borderTop: '3px solid var(--fdl-navy-800, #12375b)', fontWeight: 700, color: 'var(--fdl-blue-700, #0759a5)' }}>
      Comparing Indications for Use using AI...
    </div>
  );

  if (!data || data.error) return (
    <div style={{ padding: '3rem', textAlign: 'center', backgroundColor: '#fef2f2', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid #fecaca', fontWeight: 700, color: '#b91c1c' }}>
      Failed to perform comparison. {data?.error}
    </div>
  );

  return (
    <div style={cardStyle} className="custom-scrollbar">
      {/* Close Button */}
      <button 
        onClick={onClose} 
        style={{ 
          position: 'absolute', 
          top: '16px', 
          right: '16px', 
          background: 'var(--fdl-paper, #ffffff)', 
          border: '1px solid var(--fdl-line, #b8c8d7)', 
          width: '32px', 
          height: '32px', 
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div style={{ marginBottom: '2rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)', paddingBottom: '1.25rem', textAlign: 'center', position: 'relative' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', margin: 0 }}>IFU Comparison</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--fdl-muted, #5e6e7c)', fontWeight: 600, marginTop: '6px' }}>
          {device1.name} ({device1.id}) vs. {device2.name} ({device2.id})
        </p>
        <button
          onClick={() => {
            const htmlContent = `
              <html>
                <head>
                  <title>IFU Comparison: ${device1.id} vs ${device2.id}</title>
                  <style>
                    body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; }
                    h1, h2 { color: #071f3d; }
                    .summary { background: #f3f6f8; padding: 20px; border-radius: 2px; border: 1px solid #d7e0e7; margin-bottom: 30px; }
                  </style>
                </head>
                <body>
                  <h1>IFU Comparison Report</h1>
                  <p><strong>${device1.name} (${device1.id})</strong> vs. <strong>${device2.name} (${device2.id})</strong></p>
                  <div class="summary">
                    <h2>AI Summary of Differences</h2>
                    ${data.comparison}
                  </div>
                  <hr/>
                  <h2>Raw IFU Content</h2>
                  <h3>${device1.id}</h3>
                  <p>${data.device1.ifu}</p>
                  <h3>${device2.id}</h3>
                  <p>${data.device2.ifu}</p>
                </body>
              </html>
            `;
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `IFU_Comparison_${device1.id}_vs_${device2.id}.html`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '0',
            padding: '5px 10px',
            backgroundColor: 'var(--fdl-paper, #ffffff)',
            color: 'var(--fdl-ink-soft, #273843)',
            border: '1px solid var(--fdl-line, #b8c8d7)',
            borderRadius: 'var(--fdl-radius-sm, 2px)',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseOver={e => { e.currentTarget.style.backgroundColor = 'var(--fdl-canvas, #f3f6f8)'; }}
          onMouseOut={e => { e.currentTarget.style.backgroundColor = 'var(--fdl-paper, #ffffff)'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export Report
        </button>
      </div>

      <div style={{ backgroundColor: 'var(--fdl-canvas, #f3f6f8)', padding: '1.25rem 1.5rem', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--fdl-muted, #5e6e7c)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>AI Summary of Differences</h3>
        <div 
          style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--fdl-ink, #132332)' }}
          dangerouslySetInnerHTML={{ __html: data.comparison }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <div style={{ padding: '1.25rem', border: '1px solid var(--fdl-line-soft, #d7e0e7)', borderRadius: 'var(--fdl-radius-sm, 2px)', backgroundColor: 'var(--fdl-paper, #ffffff)' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '0.75rem' }}>{device1.id}</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft, #273843)', whiteSpace: 'pre-wrap', lineHeight: 1.5, margin: 0 }}>
            {data.device1.ifu}
          </p>
        </div>
        <div style={{ padding: '1.25rem', border: '1px solid var(--fdl-line-soft, #d7e0e7)', borderRadius: 'var(--fdl-radius-sm, 2px)', backgroundColor: 'var(--fdl-paper, #ffffff)' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '0.75rem' }}>{device2.id}</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft, #273843)', whiteSpace: 'pre-wrap', lineHeight: 1.5, margin: 0 }}>
            {data.device2.ifu}
          </p>
        </div>
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
