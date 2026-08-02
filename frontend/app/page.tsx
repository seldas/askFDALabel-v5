'use client';

import Link from 'next/link';
import { useUser } from './context/UserContext';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Header from "./components/Header";
import Footer from './components/Footer';
import { withAppBase } from './utils/appPaths';
import StartPage from './components/StartPage';

interface Project {
  id: number;
  title: string;
  role: string;
  count: number;
}

export default function HomePage() {
  const router = useRouter();
  const { session, loading, updateAiProvider, refreshSession, openAuthModal } = useUser();
  const [activeDropdown, setActiveDropdown] = useState<'user' | 'nav' | 'more' | 'ai' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Start page logic
  // Removed anonymousAccess state as login is now required

  // New Search & Project State
  const [searchTerm, setSearchTerm] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  interface ChatHistoryItem {
    id: number;
    title: string;
    chat_data: any[];
    timestamp: string;
  }

  const [histories, setHistories] = useState<ChatHistoryItem[]>([]);
  const [historiesLoading, setHistoriesLoading] = useState(false);

  const fetchProjects = async () => {
    if (!session?.is_authenticated) return;
    setProjectsLoading(true);
    try {
      const res = await fetch('/api/dashboard/projects');
      const data = await res.json();
      // Show only top 5 recent projects on home page
      setProjects((data.projects || []).slice(0, 5));
    } catch (e) {
      console.error("Failed to fetch projects", e);
    } finally {
      setProjectsLoading(false);
    }
  };

  const fetchHistories = async () => {
    if (!session?.is_authenticated) return;
    setHistoriesLoading(true);
    try {
      const res = await fetch('/api/search/history');
      const data = await res.json();
      // Show only top 5 recent histories
      setHistories((data.histories || []).slice(0, 5));
    } catch (e) {
      console.error("Failed to fetch histories", e);
    } finally {
      setHistoriesLoading(false);
    }
  };

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'));
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return ts;
    }
  };

  useEffect(() => {
    if (session?.is_authenticated) {
      fetchProjects();
      fetchHistories();
    }
  }, [session?.is_authenticated]);

  const [isSearching, setIsSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startTimer = () => {
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // Clean up timer on unmount
  useEffect(() => { return () => stopTimer(); }, []);


  const handleSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
    if (e) e.preventDefault();
    const query = (overrideQuery || searchTerm).trim();
    if (!query) return;

    if (overrideQuery) {
      setSearchTerm(overrideQuery);
    }

    setIsSearching(true);
    startTimer();

    const done = (msg?: string) => {
      stopTimer();
      if (msg) setSearchStatus(msg);
    };

    try {
      // ── Step 1: DB lookup ─────────────────────────────────────────────────
      setSearchStatus('Querying database...');
      const dbRes = await fetch('/api/search/db_search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, ai_provider: session?.ai_provider }),
      });
      const dbData = await dbRes.json();

      if (dbData.action === 'single_label') {
        // Already answered by the backend (XML read + LLM) — go straight to /search
        done('Done!');
        sessionStorage.setItem('initial_search_result', JSON.stringify({
          query,
          response: dbData.response_text,
          results:  dbData.results || [],
        }));
        router.push('/search');
        return;
      }

      if (dbData.action === 'db_found') {
        done('Done!');
        sessionStorage.setItem('initial_search_result', JSON.stringify({
          query,
          response: dbData.response_text,
          results:  dbData.results || [],
        }));
        router.push('/search');
        return;
      }

      // ── Step 2: AI fallback ───────────────────────────────────────────────
      setSearchStatus('Composing AI answer...');
      const chatRes = await fetch('/api/search/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          chat_history:             [],
          ai_provider:              session?.ai_provider,
          is_failed_keyword_search: dbData.is_keyword ?? false,
        }),
      });
      const chatData = await chatRes.json();

      done('Done!');
      sessionStorage.setItem('initial_search_result', JSON.stringify({
        query,
        response: chatData.response_text,
        results:  [],
      }));
      router.push('/search');

    } catch (err) {
      console.error('Search error', err);
      done('Error — redirecting...');
      router.push(`/search?q=${encodeURIComponent(query)}`);
    }
  };


  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === 'true') {
      openAuthModal('login');
    }
  }, [openAuthModal]);

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/dashboard/auth/logout', {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        await refreshSession();
      }
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const handleGuestLogin = async () => {
    try {
      const res = await fetch('/api/dashboard/auth/guest-login', { method: 'POST' });
      if (res.ok) {
        await refreshSession();
      }
    } catch (err) {
      console.error('Guest login failed', err);
    }
  };

  if (!loading && !session?.is_authenticated) {
    return (
      <StartPage
        onLogin={() => openAuthModal('login')}
        onSignUp={() => openAuthModal('register')}
        onGuest={handleGuestLogin}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Header />

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 2rem 4rem 2rem' }}>
        {/* Hero Section with AI Search */}
        <section style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <img 
              src={withAppBase("/askFDALabel_hero.png")}
              alt="AskFDALabel"
              style={{
                maxWidth: '75%',
                height: 'auto',
                marginBottom: '0.5rem'
              }}
            />

          </div>

          {/* Central Search Bar */}
          <div style={{ maxWidth: '800px', margin: '2.5rem auto 2rem auto' }}>            <form onSubmit={handleSearch} style={{ position: 'relative' }}>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ask about clinical data, safety, or dosing..."
                disabled={isSearching}
                style={{
                  width: '100%',
                  padding: '1.25rem 4rem 1.25rem 1.5rem',
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  fontSize: '1.1rem',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 10px 15px -5px rgba(0, 0, 0, 0.1)',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  opacity: isSearching ? 0.7 : 1
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
              />
              <button 
                type="submit"
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: searchTerm.trim() ? '#6366f1' : '#cbd5e1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '8px 16px',
                  cursor: (searchTerm.trim() && !isSearching) ? 'pointer' : 'default',
                  fontSize: isSearching ? '0.9rem' : '1.2rem',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                disabled={!searchTerm.trim() || isSearching}
              >
                {isSearching ? (
                  <>
                    <div className="loading-spinner-small" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }}></div>
                    <span style={{ fontWeight: 600 }}>Thinking</span>
                  </>
                ) : "➤"}
              </button>
            </form>

            {/* ── Real-time search status bar ── */}
            <div style={{
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '0.6rem',
              opacity: isSearching ? 1 : 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: 'none',
            }}>
              {isSearching && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '999px',
                  padding: '5px 14px 5px 10px',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.08)',
                  fontSize: '0.82rem',
                  color: '#475569',
                  fontWeight: 600,
                }}>
                  {/* Animated pulse dot */}
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#6366f1',
                    display: 'inline-block',
                    animation: 'hpPulse 1.2s ease-in-out infinite',
                    flexShrink: 0,
                  }} />
                  <span>{searchStatus || 'Working...'}</span>
                  <span style={{ color: '#94a3b8', fontWeight: 500, minWidth: '38px', textAlign: 'right' }}>
                    {(elapsedMs / 1000).toFixed(1)}s
                  </span>
                </div>
              )}
            </div>

            {/* Keyframe for pulse dot — injected once */}
            <style>{`
              @keyframes hpPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50%       { opacity: 0.4; transform: scale(0.75); }
              }
            `}</style>

            <div style={{ textAlign: 'center', marginTop: '0.25rem' }}>
              <Link 
                href="/localquery" 
                style={{ 
                  fontSize: '0.9rem', 
                  color: '#6366f1', 
                  textDecoration: 'none', 
                  fontWeight: 700, 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                </svg>
                Direct Structured Database Query
              </Link>
            </div>

            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              justifyContent: 'center', 
              gap: '12px', 
              marginTop: '1.5rem' 
            }}>
              {[
                "Adverse events for Humira?",
                "Indications for Keytruda?",
                "Ozempic boxed warning?",
                "Mounjaro contraindications?"
              ].map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    handleSearch(undefined, suggestion);
                  }}
                  style={{
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '999px',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    color: '#64748b',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontWeight: 600
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                    e.currentTarget.style.color = '#334155';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'white';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.color = '#64748b';
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Recent Conversations Section */}
        {session?.is_authenticated && (
          <section style={{ marginBottom: '3.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>Recent Conversations</h2>
              <Link href="/search" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#6366f1', textDecoration: 'none' }}>
                Go to Chat →
              </Link>
            </div>

            {historiesLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="loader" style={{ margin: '0 auto' }}></div>
              </div>
            ) : histories.length > 0 ? (
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', 
                gap: '1.25rem' 
              }}>
                {histories.map(h => (
                  <div 
                    key={h.id} 
                    onClick={() => {
                      if (h.chat_data && h.chat_data.length > 0) {
                        sessionStorage.setItem('initial_history_chat', JSON.stringify(h.chat_data));
                        sessionStorage.setItem('initial_history_id', String(h.id));
                        router.push('/search');
                      }
                    }}
                    style={{ textDecoration: 'none', cursor: 'pointer' }}
                  >
                    <div style={{
                      padding: '1.5rem',
                      borderRadius: '16px',
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      transition: 'all 0.2s ease',
                      height: '100%',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
                          <div style={{ 
                            width: '32px', 
                            height: '32px', 
                            borderRadius: '8px', 
                            background: '#f5f3ff', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            color: '#7c3aed',
                            flexShrink: 0
                          }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                          </div>
                          <h3 style={{ 
                            margin: 0, 
                            fontSize: '1rem', 
                            fontWeight: 800, 
                            color: '#1e293b', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap',
                            width: 'calc(100% - 42px)'
                          }} title={h.title}>
                            {h.title}
                          </h3>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '1rem' }}>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                          💬 {h.chat_data?.length || 0} messages
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
                          {formatTimestamp(h.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ 
                padding: '3rem', 
                textAlign: 'center', 
                background: 'white', 
                borderRadius: '16px', 
                border: '1px dashed #e2e8f0' 
              }}>
                <p style={{ color: '#64748b', margin: 0 }}>No conversations yet. Ask your first question above!</p>
              </div>
            )}
          </section>
        )}

        {/* Recent Tasks Section */}
        {session?.is_authenticated && (
          <section style={{ marginBottom: '3.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>Recent Tasks</h2>
              <Link href="/dashboard" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#6366f1', textDecoration: 'none' }}>
                View all tasks →
              </Link>
            </div>
            
            {projectsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="loader" style={{ margin: '0 auto' }}></div>
              </div>
            ) : projects.length > 0 ? (
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', 
                gap: '1.25rem' 
              }}>
                {projects.map(p => (
                  <Link 
                    key={p.id} 
                    href={`/dashboard?projectId=${p.id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{
                      padding: '1.5rem',
                      borderRadius: '16px',
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                      height: '100%',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
                        <div style={{ 
                          width: '32px', 
                          height: '32px', 
                          borderRadius: '8px', 
                          background: '#f0f9ff', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          color: '#0369a1'
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        </div>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.title}
                        </h3>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                        {p.count} labels • {p.role.toUpperCase()}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div style={{ 
                padding: '3rem', 
                textAlign: 'center', 
                background: 'white', 
                borderRadius: '16px', 
                border: '1px dashed #e2e8f0' 
              }}>
                <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>No tasks yet. Import your first dataset to get started.</p>
                <Link 
                  href="/dashboard"
                  style={{
                    background: '#6366f1',
                    color: 'white',
                    padding: '10px 20px',
                    borderRadius: '10px',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: '0.9rem'
                  }}
                >
                  Go to Dashboard
                </Link>
              </div>
            )}

            {/* Webtest button under project list */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <Link 
                href="/webtest" 
                style={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '8px 16px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#64748b',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.color = '#334155';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.color = '#64748b';
                }}
              >
                🛠️ Auto Test Tool
              </Link>
            </div>
          </section>
        )}
      </main>
      
      <Footer />
    </div>
  );
}
