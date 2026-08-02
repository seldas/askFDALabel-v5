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
    backgroundColor: 'white',
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '1000px',
    border: '1px solid #e2e8f0',
    position: 'relative' as const,
    animation: 'slideUp 0.3s ease-out',
    maxHeight: '90vh',
    overflowY: 'auto' as const
  };

  if (loading) return (
    <div style={{ padding: '4rem', textAlign: 'center', backgroundColor: 'white', borderRadius: '24px', fontWeight: 800, color: '#6366f1' }}>
      Comparing Indications for Use using AI...
    </div>
  );

  if (!data || data.error) return (
    <div style={{ padding: '4rem', textAlign: 'center', backgroundColor: '#fef2f2', borderRadius: '24px', fontWeight: 800, color: '#ef4444' }}>
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
          top: '20px', 
          right: '20px', 
          background: '#f1f5f9', 
          border: 'none', 
          width: '36px', 
          height: '36px', 
          borderRadius: '50%', 
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748b',
          transition: 'all 0.2s',
          zIndex: 10
        }}
        onMouseOver={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
        onMouseOut={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div style={{ marginBottom: '2.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1.5rem', textAlign: 'center', position: 'relative' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>IFU Comparison</h2>
        <p style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600, marginTop: '8px' }}>
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
                    h1, h2 { color: #0f172a; }
                    .summary { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
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
            padding: '6px 12px',
            backgroundColor: '#f1f5f9',
            color: '#475569',
            border: 'none',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontWeight: 800,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseOver={e => { e.currentTarget.style.backgroundColor = '#e2e8f0'; e.currentTarget.style.color = '#0f172a'; }}
          onMouseOut={e => { e.currentTarget.style.backgroundColor = '#f1f5f9'; e.currentTarget.style.color = '#475569'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export Report
        </button>
      </div>

      <div style={{ backgroundColor: '#f8fafc', padding: '1.5rem', borderRadius: '20px', border: '1px solid #f1f5f9', marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>AI Summary of Differences</h3>
        <div 
          style={{ fontSize: '0.95rem', lineHeight: 1.6, color: '#334155' }}
          dangerouslySetInnerHTML={{ __html: data.comparison }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div style={{ padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '16px' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem' }}>{device1.id}</h4>
          <p style={{ fontSize: '0.85rem', color: '#475569', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {data.device1.ifu}
          </p>
        </div>
        <div style={{ padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '16px' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem' }}>{device2.id}</h4>
          <p style={{ fontSize: '0.85rem', color: '#475569', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {data.device2.ifu}
          </p>
        </div>
      </div>
      
      <style jsx>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
