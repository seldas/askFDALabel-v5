'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Header from '../../components/Header';
import Footer from '../../components/Footer';
import { Badge, Button, ButtonLink, EmptyState, Input, Select } from '../../platform/primitives';
import { useUser } from '../../context/UserContext';
import AccessRestricted from '../../components/AccessRestricted';
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
type TimeRange = 'all' | '7d' | '30d' | '3m' | '1y';

const ITEMS_PER_PAGE = 10;

export default function QueryHistoryPage() {
  const { session, loading: userLoading } = useUser();
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('time_desc');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Gate verdict from the backend, so an admin opening this feature to guests
  // takes effect here without a code change.
  const historyAllowed = session?.permissions?.query_history ?? false;

  const fetchHistory = async () => {
    if (!historyAllowed) { setLoading(false); return; }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyAllowed]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, timeRange, sortOption]);

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
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  const filteredAndSortedHistory = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const now = Date.now();

    let filtered = history.filter((item) => {
      // Keyword search
      const matchesSearch = !q || (
        item.query_title.toLowerCase().includes(q) ||
        item.target_db.toLowerCase().includes(q) ||
        item.query_link.toLowerCase().includes(q)
      );
      if (!matchesSearch) return false;

      // Time range filter
      if (timeRange !== 'all') {
        const itemTime = new Date(item.timestamp).getTime();
        if (!isNaN(itemTime)) {
          const diffDays = (now - itemTime) / (1000 * 60 * 60 * 24);
          if (timeRange === '7d' && diffDays > 7) return false;
          if (timeRange === '30d' && diffDays > 30) return false;
          if (timeRange === '3m' && diffDays > 90) return false;
          if (timeRange === '1y' && diffDays > 365) return false;
        }
      }

      return true;
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
  }, [history, searchTerm, timeRange, sortOption]);

  const totalPages = Math.ceil(filteredAndSortedHistory.length / ITEMS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);

  const paginatedHistory = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedHistory.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedHistory, safePage]);

  const totalResultsCount = useMemo(() => {
    return history.reduce((sum, item) => sum + (item.result_count || 0), 0);
  }, [history]);

  // Reachable by URL even though the header hides the link; the API returns
  // 403 for a guest regardless, so this only makes the refusal readable.
  if (!userLoading && !historyAllowed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--afl-bg-page, #f8fafc)' }}>
        <Header activeApp="dashboard" />
        <AccessRestricted
          feature="Search & Query History"
          title="Search & Query History is not available for your account"
          body="An administrator controls which accounts can use search history from the Function Control panel."
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--afl-bg-page, #f8fafc)' }}>
      <Header activeApp="dashboard" />

      <main style={{ flex: 1, padding: '1.25rem 1.5rem', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        {/* Breadcrumb & Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
          <Link href="/dashboard" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
            My Dashboard
          </Link>
          <span>/</span>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>Search & Query History</span>
        </div>

        {/* Compact Hero Section */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
            borderRadius: '12px',
            padding: '1.25rem 1.5rem',
            marginBottom: '1rem',
            boxShadow: '0 4px 14px rgba(15, 23, 42, 0.15)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#60a5fa',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Search & Query History</h1>
            </div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>
              Automatically records your search executions, query parameters, result counts, and permanent links.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>Queries</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff' }}>{history.length}</div>
            </div>
            <div style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>Results Found</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#60a5fa' }}>{totalResultsCount.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Toolbar & Filter Bar */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '10px',
            padding: '0.85rem 1.25rem',
            marginBottom: '1rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '280px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
              <Input
                type="text"
                placeholder="Search history by criteria or URL..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '0.75rem', height: '34px', fontSize: '0.85rem' }}
              />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2.5"
                style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>

            {/* Time Range Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>Time Range:</span>
              <Select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                style={{ height: '34px', fontSize: '0.85rem', paddingRight: '1.75rem' }}
              >
                <option value="all">All Time</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="3m">Last 3 Months</option>
                <option value="1y">Last 1 Year</option>
              </Select>
            </div>

            {/* Sort Order Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>Sort:</span>
              <Select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                style={{ height: '34px', fontSize: '0.85rem', paddingRight: '1.75rem' }}
              >
                <option value="time_desc">Newest First</option>
                <option value="time_asc">Oldest First</option>
                <option value="count_desc">Results (High to Low)</option>
                <option value="count_asc">Results (Low to High)</option>
              </Select>
            </div>
          </div>

          {history.length > 0 && (
            <Button variant="tint-danger" size="sm" onClick={handleClearAll} style={{ height: '34px', padding: '0 12px', fontSize: '0.8rem' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '4px' }}>
                <path d="M3 6h18"></path>
                <path d="M19 6v14c0 1-1 2-2 2H5c-1 0-2-1-2-2V6"></path>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              </svg>
              Clear History
            </Button>
          )}
        </div>

        {/* Concise Query History List */}
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div className="loader" style={{ width: '32px', height: '32px', margin: '0 auto 0.75rem' }}></div>
            <p style={{ color: '#64748b', fontWeight: 600, fontSize: '0.9rem' }}>Loading query history...</p>
          </div>
        ) : paginatedHistory.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {paginatedHistory.map((item) => {
              const isOracle = item.target_db?.toLowerCase() === 'oracle';
              return (
                <div
                  key={item.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '0.75rem 1.15rem',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Left: Criteria Title & Badges */}
                  <div style={{ flex: 1, minWidth: '280px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>{item.query_title}</span>
                      <Badge tone={isOracle ? 'accent' : 'neutral'} style={{ fontSize: '0.7rem', padding: '1px 6px' }}>
                        {isOracle ? 'Oracle DB' : 'Local DB'}
                      </Badge>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', color: '#64748b' }}>
                      <span>🕒 {formatTimestamp(item.timestamp)}</span>
                      {formatRelativeTime(item.timestamp) && (
                        <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, color: '#475569' }}>
                          {formatRelativeTime(item.timestamp)}
                        </span>
                      )}
                      <span style={{ color: '#cbd5e1' }}>•</span>
                      <code style={{ fontSize: '0.72rem', color: '#64748b', background: '#f8fafc', padding: '1px 6px', borderRadius: '4px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.query_link}
                      </code>
                    </div>
                  </div>

                  {/* Right: Result Count Badge & Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        background: item.result_count > 0 ? '#eff6ff' : '#f8fafc',
                        border: `1px solid ${item.result_count > 0 ? '#bfdbfe' : '#e2e8f0'}`,
                        borderRadius: '8px',
                        padding: '4px 10px',
                        textAlign: 'center',
                        minWidth: '85px',
                      }}
                    >
                      <div style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', color: item.result_count > 0 ? '#1d4ed8' : '#64748b' }}>
                        Results
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: item.result_count > 0 ? '#1e40af' : '#475569', lineHeight: 1.1 }}>
                        {item.result_count.toLocaleString()}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <ButtonLink href={item.query_link} variant="primary" size="sm" style={{ height: '30px', padding: '0 10px', fontSize: '0.78rem' }}>
                        Run
                      </ButtonLink>

                      <Button variant="secondary" size="sm" onClick={() => copyToClipboard(item.query_link, item.id)} style={{ height: '30px', padding: '0 10px', fontSize: '0.78rem' }}>
                        {copiedId === item.id ? '✓ Copied' : 'Copy Link'}
                      </Button>

                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          padding: '4px 6px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Delete entry"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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

            {/* Pagination Controls */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '10px',
                padding: '0.75rem 1.25rem',
                border: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '0.5rem',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                Showing <strong style={{ color: '#0f172a' }}>{(safePage - 1) * ITEMS_PER_PAGE + 1}</strong> to{' '}
                <strong style={{ color: '#0f172a' }}>{Math.min(safePage * ITEMS_PER_PAGE, filteredAndSortedHistory.length)}</strong> of{' '}
                <strong style={{ color: '#0f172a' }}>{filteredAndSortedHistory.length}</strong> history entries
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safePage === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={{ height: '30px', padding: '0 10px', fontSize: '0.8rem' }}
                  >
                    Previous
                  </Button>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', padding: '0 6px' }}>
                    Page {safePage} of {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    style={{ height: '30px', padding: '0 10px', fontSize: '0.8rem' }}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '3rem 2rem' }}>
            <EmptyState
              icon={
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              }
              title={searchTerm || timeRange !== 'all' ? 'No Matching Query History' : 'No Query History Recorded Yet'}
              description={
                searchTerm || timeRange !== 'all'
                  ? 'No search history records match your search filter or selected time range.'
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
