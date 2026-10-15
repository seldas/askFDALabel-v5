'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { withAppBase } from '../../utils/appPaths';

interface Label {
  set_id: string;
  brand_name: string;
  generic_name: string;
  manufacturer_name: string;
  effective_time: string;
  source?: string;
}

interface SearchResponse {
  drug_name: string;
  page_title: string;
  labels: Label[];
  total: number;
  page: number;
  limit: number;
  is_internal: boolean;
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = parseInt(searchParams.get('page') || '1');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams(searchParams.toString());
        params.set('json', '1');
        const response = await fetch(`/api/dashboard/search?${params.toString()}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch results');
        const json = await response.json();
        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [searchParams]);

  if (loading) return <div className="hp-main-layout"><div className="hp-container" style={{ textAlign: 'center', padding: '4rem' }}><div className="loader" style={{ margin: '0 auto' }}></div><p>Loading results...</p></div></div>;
  if (error) return <div className="hp-main-layout"><div className="hp-container" style={{ textAlign: 'center', padding: '4rem', color: '#ef4444' }}>Error: {error}</div></div>;
  if (!data) return null;

  const totalPages = Math.ceil(data.total / data.limit);

  return (
    <div className="hp-main-layout" style={{ minHeight: '100vh', backgroundColor: 'var(--fdl-canvas, #f3f6f8)' }}>
      {/* Main Header */}
      <header className="header-main">
        <div className="header-branding">
          <Link href="/" className="header-logo-link" style={{ 
            backgroundColor: 'white', 
            padding: '5px', 
            borderRadius: 'var(--fdl-radius-sm, 2px)'
          }}>
             <img src={withAppBase("/fdalabel-v3_icon.svg")} alt="Logo" style={{ height: '20px' }} />
          </Link>
          <h1 className="header-title" style={{ fontSize: '1.25rem' }}>
            askFDALabel <span className="header-title-suffix">Search</span>
          </h1>
        </div>

        <nav className="header-nav">
          <Link href="/" style={{ color: 'white', fontSize: '0.875rem', textDecoration: 'none', opacity: 0.9, fontWeight: 600 }}>Home</Link>
        </nav>
      </header>

      <div style={{ maxWidth: '1200px', margin: '2rem auto', padding: '0 1rem' }}>
        <div style={{ 
            backgroundColor: 'var(--fdl-paper, #ffffff)', 
            borderRadius: 'var(--fdl-radius-sm, 2px)', 
            border: '1px solid var(--fdl-line-soft, #d7e0e7)', 
            borderTop: '3px solid var(--fdl-navy-800, #12375b)',
            boxShadow: 'none',
            overflow: 'hidden'
        }}>
            <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)' }}>{data.page_title}</h2>
                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--fdl-muted, #5e6e7c)' }}>
                        {data.total} records found. Showing page {data.page} of {totalPages}.
                    </p>
                </div>
            </div>

            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: '800px' }}>
                  <thead>
                      <tr style={{ backgroundColor: 'var(--fdl-canvas, #f3f6f8)' }}>
                          <th style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>Trade Name</th>
                          <th style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>Generic Name</th>
                          <th style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>Manufacturer</th>
                          <th style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>Published</th>
                          <th style={{ padding: '0.875rem 1.25rem', textAlign: 'right', fontWeight: 800, color: 'var(--fdl-ink-soft, #273843)', textTransform: 'uppercase', fontSize: '0.75rem', borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)' }}>Action</th>
                      </tr>
                  </thead>
                  <tbody>
                      {data.labels.map((label) => (
                          <tr key={label.set_id} style={{ borderBottom: '1px solid var(--fdl-line-soft, #d7e0e7)' }} className="table-row-hover">
                              <td style={{ padding: '0.875rem 1.25rem', fontWeight: 700, color: 'var(--fdl-navy-950, #071f3d)' }}>{label.brand_name}</td>
                              <td style={{ padding: '0.875rem 1.25rem', color: 'var(--fdl-ink-soft, #273843)', fontStyle: 'italic' }}>{label.generic_name}</td>
                              <td style={{ padding: '0.875rem 1.25rem', color: 'var(--fdl-ink, #132332)' }}>{label.manufacturer_name}</td>
                              <td style={{ padding: '0.875rem 1.25rem', color: 'var(--fdl-muted, #5e6e7c)' }}>{label.effective_time}</td>
                              <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right' }}>
                                  <Link 
                                      href={`/dashboard/label/${label.set_id}`}
                                      style={{ 
                                          display: 'inline-flex',
                                          padding: '5px 12px',
                                          backgroundColor: 'var(--fdl-paper, #ffffff)',
                                          border: '1px solid var(--fdl-line, #b8c8d7)',
                                          color: 'var(--fdl-blue-700, #0759a5)',
                                          borderRadius: 'var(--fdl-radius-sm, 2px)',
                                          textDecoration: 'none',
                                          fontWeight: 700,
                                          fontSize: '0.825rem',
                                          transition: 'all 0.15s'
                                      }}
                                      className="btn-view-snippet"
                                  >
                                      View
                                  </Link>
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
            </div>
        </div>

        {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem', paddingBottom: '3rem' }}>
                {page > 1 ? (
                    <Link 
                        href={`/dashboard/results?${new URLSearchParams({...Object.fromEntries(searchParams.entries()), page: (page - 1).toString()}).toString()}`}
                        style={{ padding: '6px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line, #b8c8d7)', background: 'var(--fdl-paper, #ffffff)', color: 'var(--fdl-ink-soft, #273843)', textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                    >
                        &larr; Previous
                    </Link>
                ) : (
                    <span style={{ padding: '6px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', background: 'var(--fdl-canvas, #f3f6f8)', color: 'var(--fdl-muted, #5e6e7c)', opacity: 0.5, fontWeight: 600, fontSize: '0.85rem', cursor: 'not-allowed' }}>&larr; Previous</span>
                )}

                <span style={{ fontSize: '0.85rem', color: 'var(--fdl-muted, #5e6e7c)', fontWeight: 600 }}>
                    Page {page} of {totalPages}
                </span>

                {page < totalPages ? (
                    <Link 
                        href={`/dashboard/results?${new URLSearchParams({...Object.fromEntries(searchParams.entries()), page: (page + 1).toString()}).toString()}`}
                        style={{ padding: '6px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line, #b8c8d7)', background: 'var(--fdl-paper, #ffffff)', color: 'var(--fdl-ink-soft, #273843)', textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem' }}
                    >
                        Next &rarr;
                    </Link>
                ) : (
                    <span style={{ padding: '6px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', border: '1px solid var(--fdl-line-soft, #d7e0e7)', background: 'var(--fdl-canvas, #f3f6f8)', color: 'var(--fdl-muted, #5e6e7c)', opacity: 0.5, fontWeight: 600, fontSize: '0.85rem', cursor: 'not-allowed' }}>Next &rarr;</span>
                )}
            </div>
        )}
      </div>

      <style jsx>{`
        .table-row-hover:hover {
            background-color: var(--fdl-blue-050, #edf4fa);
        }
        .btn-view-snippet:hover {
            background-color: var(--fdl-blue-050, #edf4fa) !important;
            border-color: var(--fdl-blue-700, #0759a5) !important;
            color: var(--fdl-blue-700, #0759a5) !important;
        }
        .loader {
          border: 3px solid #f3f3f3;
          border-radius: 50%;
          border-top: 3px solid #0071bc;
          width: 30px;
          height: 30px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResultsContent />
    </Suspense>
  );
}
