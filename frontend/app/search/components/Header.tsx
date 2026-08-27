import React, { useState, useEffect } from 'react';
import { useUser } from '../../context/UserContext';
import Link from 'next/link';

const Header: React.FC = () => {
  const { session, loading, updateAiProvider, openAuthModal } = useUser();
  const [activeDropdown, setActiveDropdown] = useState<'ai' | 'user' | 'nav' | 'more' | null>(null);
  const [isInternal, setIsInternal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const checkInternalStatus = async () => {
      try {
        const response = await fetch("/api/check-fdalabel", { method: 'POST' });
        const data = await response.json();
        setIsInternal(data.isInternal);
      } catch (error) {
        setIsInternal(false);
      }
    };
    checkInternalStatus();
  }, []);

  return (
    <header className="header-main">
      {/* Left: Branding & Page Title */}
      <div className="header-branding">
        <a href={process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/fdalabel-v3'} className="header-logo-link" style={{
          background: 'rgba(255,255,255,0.15)',
          padding: '4px 12px',
          borderRadius: '20px',
          transition: 'all 0.2s ease',
          textDecoration: 'none',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center'
        }}>
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
             <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
             <polyline points="9 22 9 12 15 12 15 22"></polyline>
           </svg>
           <span style={{ marginLeft: '8px', fontSize: '0.85rem', fontWeight: 700 }}>Home</span>
        </a>
        <h1 className="header-title" style={{ fontSize: '1.1rem' }}>
          AFL Agent
        </h1>
      </div>

      {/* Mobile Toggle Button */}
      <button 
        className="mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        )}
      </button>

      {/* Center: Main Navigation */}
      <nav className={`header-nav ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="hp-nav-dropdown" onMouseEnter={() => setActiveDropdown('nav')} onMouseLeave={() => setActiveDropdown(null)}>
          <button className="hp-nav-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"></path><path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path><path d="M5 21V10.85"></path><path d="M19 21V10.85"></path><path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path></svg>
            Resources <span className="dropdown-caret">▼</span>
          </button>
          <div className={`hp-dropdown-content ${activeDropdown === 'nav' ? 'visible' : ''}`}>
            <Link href="/localquery" className="hp-dropdown-item">
              <span className="hp-dropdown-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                </svg>
              </span>
              <div>
                <div style={{ fontWeight: 800 }}>Local Database Search</div>
                <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Query local SPL & drug records</div>
              </div>
            </Link>
            {isInternal ? (
              <>
                <a href="https://fdalabel.fda.gov:8443/fdalabel/ui/search" target="_blank" rel="noopener noreferrer" className="hp-dropdown-item">
                  <span className="hp-dropdown-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"></path><path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path><path d="M5 21V10.85"></path><path d="M19 21V10.85"></path><path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path></svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 800 }}>FDA Official</div>
                    <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Internal Review Interface</div>
                  </div>
                </a>
                <a href="https://fdalabel.fda.gov:8443/fdalabel-r/ui/search" target="_blank" rel="noopener noreferrer" className="hp-dropdown-item">
                  <span className="hp-dropdown-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 800 }}>CDER-CBER</div>
                    <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Internal Review Interface</div>
                  </div>
                </a>
              </>
            ) : (
              <>
                <div className="hp-dropdown-item is-disabled" style={{ opacity: 0.45, cursor: 'not-allowed', userSelect: 'none' }} title="Disabled — Available on internal FDA network only">
                  <span className="hp-dropdown-icon" style={{ filter: 'grayscale(1)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"></path><path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path><path d="M5 21V10.85"></path><path d="M19 21V10.85"></path><path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path></svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 800, color: '#94a3b8', textDecoration: 'line-through' }}>FDA Official</div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600 }}>Disabled (Internal Only)</div>
                  </div>
                </div>
                <div className="hp-dropdown-item is-disabled" style={{ opacity: 0.45, cursor: 'not-allowed', userSelect: 'none' }} title="Disabled — Available on internal FDA network only">
                  <span className="hp-dropdown-icon" style={{ filter: 'grayscale(1)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 800, color: '#94a3b8', textDecoration: 'line-through' }}>CDER-CBER</div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600 }}>Disabled (Internal Only)</div>
                  </div>
                </div>
              </>
            )}
            <a href="https://nctr-crs.fda.gov/fdalabel/ui/search" target="_blank" rel="noopener noreferrer" className="hp-dropdown-item">
              <span className="hp-dropdown-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"></path><path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path><path d="M5 21V10.85"></path><path d="M19 21V10.85"></path><path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path></svg>
              </span>
              <div>
                <div style={{ fontWeight: 800 }}>Public FDALabel</div>
                <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Global Public Interface</div>
              </div>
            </a>
          </div>
        </div>

        <Link href="/search" className="hp-nav-item hp-nav-item-flagship">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><path d="M11 8a2 2 0 0 0-2 2"></path></svg>
          AI Chat
        </Link>

        <Link href="/dashboard" className="hp-nav-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          My Dashboard
        </Link>

        <div className="hp-nav-dropdown" onMouseEnter={() => setActiveDropdown('more')} onMouseLeave={() => setActiveDropdown(null)}>
          <button className="hp-nav-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>
            More <span className="dropdown-caret">▼</span>
          </button>
          <div className={`hp-dropdown-content ${activeDropdown === 'more' ? 'visible' : ''}`}>
            <Link href="/labelcomp" className="hp-dropdown-item">
              <span className="hp-dropdown-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="M7 21h10"></path><path d="M12 3v18"></path><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"></path></svg>
              </span>
              <div>
                <div style={{ fontWeight: 800 }}>Label Compare</div>
                <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Side-by-side analysis</div>
              </div>
            </Link>
            <Link href="/drugtox" target="_blank" rel="noopener noreferrer" className="hp-dropdown-item">
              <span className="hp-dropdown-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2v8"></path><path d="M14 2v8"></path><path d="M8.5 15c.7 0 1.3-.5 1.5-1.2l.5-2.3c.2-.7.8-1.2 1.5-1.2s1.3.5 1.5 1.2l.5 2.3c.2.7.8 1.2 1.5 1.2"></path><path d="M6 18h12"></path><path d="M6 22h12"></path><circle cx="12" cy="13" r="10"></circle></svg>
              </span>
              <div>
                <div style={{ fontWeight: 800 }}>DrugTox Intelligence</div>
                <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Toxicity profile tracking</div>
              </div>
            </Link>
            <Link href="/disclaimer" className="hp-dropdown-item">
              <span className="hp-dropdown-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </span>
              <div>
                <div style={{ fontWeight: 800 }}>Disclaimer</div>
                <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>FDA medical & legal notice</div>
              </div>
            </Link>
          </div>
        </div>
      </nav>

      {/* Right: User Controls */}
      <div className={`header-controls ${mobileMenuOpen ? 'open' : ''}`}>
        {loading ? (
          <span style={{ fontSize: '0.875rem', opacity: 0.8, color: 'white' }}>Loading...</span>
        ) : session?.is_authenticated ? (
          <>
            {/* AI Provider Indicator (Static) */}
            <div style={{ 
              fontSize: '0.85rem', 
              color: 'white', 
              background: 'rgba(255,255,255,0.1)', 
              padding: '4px 12px', 
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }} title={!session?.is_admin ? "this model is selected by the admin" : undefined}>
              <span style={{ opacity: 0.7 }}>AI:</span>
              <span style={{ fontWeight: 700 }}>{session.ai_provider?.toUpperCase()}</span>
            </div>

            {/* User Settings Dropdown */}
            <div className="custom-dropdown" onClick={(e) => e.stopPropagation()}>
              <button 
                className="dropdown-trigger"
                onClick={() => setActiveDropdown(activeDropdown === 'user' ? null : 'user')}
                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <div style={{ 
                  width: '24px', 
                  height: '24px', 
                  background: '#3b82f6', 
                  borderRadius: '50%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  color: 'white'
                }}>
                  {session.username?.[0].toUpperCase()}
                </div>
                <span className="username-text" style={{ fontSize: '0.875rem', color: 'white' }}>{session.username}</span>
              </button>

              {activeDropdown === 'user' && (
                <div className="dropdown-menu">
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>ACCOUNT</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>{session.username}</div>
                  </div>
                  <div style={{ borderTop: '1px solid #f1f5f9', marginTop: '4px' }}>
                    <Link href="/dashboard" className="dropdown-item">My Dashboard</Link>
                    {session?.username?.toLowerCase() !== 'guest' && (
                      <button 
                        onClick={() => { openAuthModal('change_password'); setActiveDropdown(null); }}
                        style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', display: 'block', padding: 10, fontSize: '0.875rem', color: '#1e293b' }} 
                      >
                        Change Password
                      </button>
                    )}
                    <a href="/api/dashboard/auth/logout" className="dropdown-item" style={{ color: '#ef4444' }}>Sign Out</a>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <button 
            onClick={() => openAuthModal('login')}
            style={{ color: 'white', fontSize: '0.875rem', border: 'none', background: 'rgba(255,255,255,0.1)', padding: '6px 16px', borderRadius: '20px', cursor: 'pointer' }}
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
