'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { Badge, Button, ButtonLink, EmptyState, Input, Select, cx } from '../../platform/primitives';
import { useUser } from '../../context/UserContext';
import '../dashboard.css';

interface QueryHistoryItem {
  id: number;
  query_title: string;
  query_link: string;
  query_json: any;
  result_count: number;
  target_db: string;
  timestamp: string;
}

type SortOption = 'time_desc' | 'time_asc' | 'count_desc' | 'count_asc';

export default function QueryHistoryPage() {
  const { session, loading: userLoading } = useUser();
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('time_desc');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/query_history?sort=desc');
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (e) {
      console.error('Failed to fetch query history', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to remove this query from your history?')) return;
    try {
      const res = await fetch(`/api/dashboard/query_history/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (e) {
      alert('Failed to delete query history item.');
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear your ENTIRE search history? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/dashboard/query_history/clear', { method: 'DELETE' });
      if (res.ok) {
        setHistory([]);
      }
    } catch (e) {
      alert('Failed to clear history.');
    }
  };

  const copyToClipboard = (link: string, id: number) => {
    const fullUrl = window.location.origin + link;
    navigator.clipboard.writeText(fullUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTimestamp = (ts: string) => {
    if (!ts) return '—';
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return ts;
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  const formatRelativeTime = (ts: string) => {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } catch {
      return '';
    }
  };

  const filteredAndSortedHistory = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    let filtered = history.filter((item) => {
      if (!q) return true;
      return (
        item.query_title.toLowerCase().includes(q) ||
        item.target_db.toLowerCase().includes(q) ||
        item.query_link.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortOption === 'time_desc') {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
      if (sortOption === 'time_asc') {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      }
      if (sortOption === 'count_desc') {
        return b.result_count - a.result_count;
      }
      if (sortOption === 'count_asc') {
        return a.result_count - b.result_count;
      }
      return 0;
    });
  }, [history, searchTerm, sortOption]);

  const totalResultsCount = useMemo(() => {
    return history.reduce((sum, item) => sum + (item.result_count || 0), 0);
  }, [history]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--afl-bg-page, #f8fafc)' }}>
      <Header activeApp="dashboard" />

      <main style={{ flex: 1, padding: '2rem 1.5rem', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        {/* Breadcrumb & Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#64748b', marginBottom: '1.25rem' }}>
          <Link href="/dashboard" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
            My Dashboard
          </Link>
          <span>/</span>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>Search & Query History</span>
        </div>

        {/* Hero Section */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
            borderRadius: '16px',
            padding: '2rem',
            marginBottom: '2rem',
            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.5rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#60a5fa',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Search & Query History</h1>
            </div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.95rem', maxWidth: '600px', lineHeight: 1.5 }}>
              Automatically records your search executions, query parameters, returned result counts, and permanent links for easy re-running and sharing.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.07)', padding: '12px 20px', borderRadius: '12px', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>Total Queries</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ffffff' }}>{history.length}</div>
            </div>
            <div style={{ background: 'rgba(255, 255, 255, 0.07)', padding: '12px 20px', borderRadius: '12px', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>Total Results Discovered</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#60a5fa' }}>{totalResultsCount.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Toolbar Bar */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.5rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: '1rem', flex: 1, minWidth: '280px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
              <Input
                type="text"
                placeholder="Search history by criteria, database, or URL..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', paddingLeft: '2.4rem' }}
              />
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2.5"
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Sort by:</span>
              <Select value={sortOption} onChange={(e) => setSortOption(e.target.value as SortOption)}>
                <option value="time_desc">Query Time (Newest First)</option>
                <option value="time_asc">Query Time (Oldest First)</option>
                <option value="count_desc">Result Count (High to Low)</option>
                <option value="count_asc">Result Count (Low to High)</option>
              </Select>
            </div>
          </div>

          {history.length > 0 && (
            <Button variant="tint-danger" size="sm" onClick={handleClearAll}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                <path d="M3 6h18"></path>
                <path d="M19 6v14c0 1-1 2-2 2H5c-1 0-2-1-2-2V6"></path>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              </svg>
              Clear History
            </Button>
          )}
        </div>

        {/* Query History Content */}
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div className="loader" style={{ width: '36px', height: '36px', margin: '0 auto 1rem' }}></div>
            <p style={{ color: '#64748b', fontWeight: 600 }}>Loading query history...</p>
          </div>
        ) : filteredAndSortedHistory.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredAndSortedHistory.map((item) => {
              const isOracle = item.target_db?.toLowerCase() === 'oracle';
              return (
                <div
                  key={item.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '1.25rem 1.5rem',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '300px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{item.query_title}</h3>
                        <Badge tone={isOracle ? 'accent' : 'neutral'} style={{ fontSize: '0.75rem' }}>
                          {isOracle ? 'Oracle DB' : 'Local Postgres DB'}
                        </Badge>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', color: '#64748b', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                          </svg>
                          {formatTimestamp(item.timestamp)}
                        </span>
                        {formatRelativeTime(item.timestamp) && (
                          <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                            {formatRelativeTime(item.timestamp)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Result Count Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          background: item.result_count > 0 ? '#eff6ff' : '#f8fafc',
                          border: `1px solid ${item.result_count > 0 ? '#bfdbfe' : '#e2e8f0'}`,
                          borderRadius: '10px',
                          padding: '8px 16px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: item.result_count > 0 ? '#1d4ed8' : '#64748b' }}>
                          Results Count
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 900, color: item.result_count > 0 ? '#1e40af' : '#475569' }}>
                          {item.result_count.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Permanent Link Bar */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingTop: '12px',
                      borderTop: '1px solid #f1f5f9',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem', color: '#64748b', background: '#f8fafc', padding: '6px 12px', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
                      <span style={{ fontWeight: 700, color: '#475569', marginRight: '6px' }}>Link:</span>
                      <code>{item.query_link}</code>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <ButtonLink href={item.query_link} variant="primary" size="sm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        Run Query
                      </ButtonLink>

                      <Button variant="secondary" size="sm" onClick={() => copyToClipboard(item.query_link, item.id)}>
                        {copiedId === item.id ? '✓ Copied!' : 'Copy Link'}
                      </Button>

                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Delete entry"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 6h18"></path>
                          <path d="M19 6v14c0 1-1 2-2 2H5c-1 0-2-1-2-2V6"></path>
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '4rem 2rem' }}>
            <EmptyState
              icon={
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              }
              title={searchTerm ? 'No Matching Query History' : 'No Query History Recorded Yet'}
              description={
                searchTerm
                  ? 'No search history records match your search filter.'
                  : 'Every search query you run will automatically be logged here with its results count and permanent link.'
              }
              action={
                <ButtonLink href="/search" variant="primary">
                  Build New Query
                </ButtonLink>
              }
            />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
