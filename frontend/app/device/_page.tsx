"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from "../components/Header";
import MaudeReport from './components/MaudeReport';
import DeviceCompare from './components/DeviceCompare';

function DeviceSearchContent() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzeTarget, setAnalyzeTarget] = useState<{ code: string, id: string } | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<any[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      handleSearch(q);
    }
  }, [searchParams]);

  const handleSearch = async (overrideQuery?: string) => {
    const searchTerm = overrideQuery || query;
    if (!searchTerm) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/device/search?q=${encodeURIComponent(searchTerm)}`);
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
        setResults([]);
      } else {
        setResults(data.results || []);
      }
    } catch (err) {
      console.error("Search failed", err);
      setError("An unexpected error occurred during search.");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (device: any) => {
    setSelectedDevices(prev => {
      const isSelected = prev.find(d => d.id === device.id);
      if (isSelected) {
        return prev.filter(d => d.id !== device.id);
      } else {
        if (prev.length >= 2) return prev; // Max 2
        return [...prev, device];
      }
    });
  };

  const examples = [
    { label: 'Stent', query: 'Stent' },
    { label: 'Pacemaker', query: 'Pacemaker' },
    { label: 'Robotic Surgery', query: 'Intuitive Surgical' },
    { label: 'Infusion Pump', query: 'Infusion Pump' },
    { label: 'K230001', query: 'K230001' },
    { label: 'Orthopedic', query: 'Orthopedic' }
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      <Header />

      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(2rem, 5vh, 4rem) clamp(1rem, 5vw, 2rem)' }}>
        {/* Hero Section */}
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <h1 className="hero-title-animated" style={{ fontSize: 'clamp(2.25rem, 6vw, 3.5rem)', fontWeight: 900, color: '#0f172a', marginBottom: '1rem', letterSpacing: '-0.025em' }}>
            Device Safety & Labeling
          </h1>
          <p className="hero-subtitle-animated" style={{ fontSize: 'clamp(1rem, 2vw, 1.15rem)', color: '#64748b', fontWeight: '500', maxWidth: '800px', margin: '0 auto' }}>
            Unified intelligence for Premarket Notifications (510k), Approvals (PMA), and MAUDE adverse event monitoring.
          </p>
        </div>

        {/* Search Toolbar */}
        <div style={{ 
          backgroundColor: 'white', 
          padding: '1.5rem', 
          borderRadius: '24px', 
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          border: '1px solid #e2e8f0',
          marginBottom: '3rem'
        }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </span>
              <input 
                type="text" 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by Device Name, Manufacturer, or Identifier (e.g. K230001)..."
                style={{ 
                  width: '100%', 
                  padding: '1.15rem 1rem 1.15rem 3rem', 
                  borderRadius: '16px', 
                  border: '2px solid #f1f5f9',
                  backgroundColor: '#f8fafc',
                  fontSize: '1.05rem',
                  fontWeight: 500,
                  outline: 'none',
                  transition: 'all 0.2s'
                }}
                className="search-input-focus"
              />
            </div>
            <button 
              onClick={() => handleSearch()}
              disabled={loading}
              style={{ 
                padding: '0 2.5rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                borderRadius: '16px',
                fontWeight: 800,
                border: 'none',
                cursor: 'pointer',
                fontSize: '1rem',
                boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.2)',
                transition: 'all 0.2s'
              }}
            >
              {loading ? 'Analyzing...' : 'Run Analysis'}
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '0 0.5rem' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '8px' }}>Rapid Starters:</span>
            {examples.map((ex) => (
              <button
                key={ex.query}
                onClick={() => {
                  setQuery(ex.query);
                  handleSearch(ex.query);
                }}
                style={{
                  padding: '6px 14px',
                  backgroundColor: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#475569',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ 
            backgroundColor: '#fff7ed', 
            color: '#c2410c', 
            border: '1px solid #fdba74', 
            padding: '1.5rem', 
            borderRadius: '16px', 
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.95rem'
          }}>
            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            <div>
              <strong style={{ display: 'block', marginBottom: '2px' }}>Search Restricted</strong>
              {error}
            </div>
          </div>
        )}

        {analyzeTarget && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', overflowY: 'auto' }}>
            <div style={{ width: '100%', maxWidth: '1000px', margin: '2rem 0' }}>
              <MaudeReport 
                productCode={analyzeTarget.code} 
                kNumber={analyzeTarget.id}
                onClose={() => setAnalyzeTarget(null)} 
              />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '2rem' }}>
          {results.map((device: any) => {
            const isSelected = selectedDevices.some(d => d.id === device.id);
            return (
              <div key={device.id} style={{ 
                backgroundColor: isSelected ? '#eff6ff' : 'white', 
                padding: '1.75rem', 
                borderRadius: '24px', 
                border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                boxShadow: isSelected ? '0 10px 15px -3px rgba(59, 130, 246, 0.1)' : '0 1px 3px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                overflow: 'hidden'
              }} className="device-card">
                
                <div style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 10 }}>
                  <button 
                    onClick={() => toggleSelection(device)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      border: isSelected ? 'none' : '2px solid #cbd5e1',
                      backgroundColor: isSelected ? '#3b82f6' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {isSelected && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', paddingRight: '32px' }}>
                  <span style={{ padding: '4px 10px', backgroundColor: isSelected ? '#dbeafe' : '#eff6ff', color: '#1d4ed8', fontSize: '0.65rem', fontWeight: 900, borderRadius: '100px', textTransform: 'uppercase', letterSpacing: '0.02em', border: '1px solid #dbeafe' }}>
                    {device.type}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700 }}>{device.date}</span>
                </div>
                
                <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', marginBottom: '0.5rem', lineHeight: 1.2 }}>{device.name}</h2>
                <p style={{ color: '#64748b', marginBottom: '1.75rem', fontSize: '0.9rem', fontWeight: 600 }}>{device.manufacturer}</p>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: 'auto' }}>
                  <div style={{ backgroundColor: isSelected ? 'white' : '#f8fafc', padding: '10px 14px', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                    <p style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', marginBottom: '2px' }}>Product Code</p>
                    <p style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 800, color: '#334155' }}>{device.product_code || 'N/A'}</p>
                  </div>
                  <div style={{ backgroundColor: isSelected ? 'white' : '#f8fafc', padding: '10px 14px', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                    <p style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', marginBottom: '2px' }}>Identifier</p>
                    <p style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 800, color: '#334155' }}>{device.id}</p>
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '12px' }}>
                  <button 
                    style={{ flex: 1, padding: '12px', backgroundColor: '#0f172a', color: 'white', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800, border: 'none', cursor: 'pointer' }}
                    onClick={() => window.open(`https://api.fda.gov/device/${device.type === 'PMA' ? 'pma' : '510k'}.json?search=${device.type === 'PMA' ? 'pma_number' : 'k_number'}:${device.id}`, '_blank')}
                  >
                    FDA Metadata
                  </button>
                  {device.product_code && (
                    <button 
                      style={{ flex: 1, padding: '12px', backgroundColor: '#3b82f6', color: 'white', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)' }}
                      onClick={() => setAnalyzeTarget({ code: device.product_code, id: device.id })}
                    >
                      Safety Profile
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!loading && results.length === 0 && query && (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', backgroundColor: '#f8fafc', borderRadius: '32px', border: '2px dashed #e2e8f0', marginTop: '3rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>🔍</div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#475569', marginBottom: '0.5rem' }}>No results for "{query}"</h3>
            <p style={{ color: '#94a3b8', fontWeight: 600 }}>Try searching by brand name, applicant, or Premarket number (K- or P-).</p>
          </div>
        )}
      </main>

      {/* Floating Compare Bar */}
      {selectedDevices.length > 0 && (
        <div style={{ 
          position: 'fixed', 
          bottom: '2rem', 
          left: '50%', 
          transform: 'translateX(-50%)', 
          backgroundColor: '#1e293b', 
          color: 'white', 
          padding: '1rem 2rem', 
          borderRadius: '100px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '2rem', 
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          zIndex: 1000,
          animation: 'slideUp 0.3s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              {selectedDevices.length} Device{selectedDevices.length > 1 ? 's' : ''} Selected
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {selectedDevices.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#334155', padding: '4px 10px', borderRadius: '100px', fontSize: '0.7rem', fontWeight: 800 }}>
                  {d.id}
                  <button onClick={() => toggleSelection(d)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button 
            onClick={() => setShowCompare(true)}
            disabled={selectedDevices.length !== 2}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: selectedDevices.length === 2 ? '#3b82f6' : '#475569', 
              color: 'white', 
              border: 'none', 
              borderRadius: '100px', 
              fontWeight: 800, 
              cursor: selectedDevices.length === 2 ? 'pointer' : 'not-allowed',
              transition: 'background-color 0.2s'
            }}
          >
            Compare IFUs
          </button>
        </div>
      )}

      {showCompare && selectedDevices.length === 2 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', overflowY: 'auto' }}>
          <DeviceCompare 
            device1={selectedDevices[0]} 
            device2={selectedDevices[1]} 
            onClose={() => setShowCompare(false)} 
          />
        </div>
      )}

      <style jsx global>{`
        .search-input-focus:focus {
          border-color: #3b82f6 !important;
          background-color: white !important;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
        }
        .device-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02) !important;
          border-color: #dbeafe !important;
        }
        .hero-title-animated {
          animation: slideUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .hero-subtitle-animated {
          animation: slideUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default function DeviceSearchPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading Device Module...</div>}>
      <DeviceSearchContent />
    </Suspense>
  );
}
