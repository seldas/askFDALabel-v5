'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '../context/UserContext';
import { useCapabilities } from '../platform/capabilities';
import { withAppBase } from '../utils/appPaths';

type DropdownKey = 'user' | 'nav' | 'more' | 'ai' | 'updates' | null;

export type ActiveApp =
  | 'home'
  | 'fdalabel'
  | 'device'
  | 'afl'
  | 'dashboard'
  | 'labelcomp'
  | 'drugtox'
  | 'localquery'
  | 'webtest';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function inferActiveApp(pathname: string): ActiveApp {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname.startsWith('/search')) return 'afl';
  if (pathname.startsWith('/device')) return 'device';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/labelcomp')) return 'labelcomp';
  if (pathname.startsWith('/drugtox')) return 'drugtox';
  if (pathname.startsWith('/localquery')) return 'localquery';
  if (pathname.startsWith('/webtest')) return 'webtest';
  return 'home';
}

export default function Header({ 
  activeApp 
}: { 
  activeApp?: ActiveApp 
}) {
  const { session, loading, updateAiProvider, refreshSession, openAuthModal, activeTasks } = useUser();

  const pathname = usePathname();
  const resolvedActiveApp = useMemo(
    () => activeApp ?? inferActiveApp(pathname || ''),
    [activeApp, pathname]
  );

  // Deployment capabilities come from the shared provider — this component and
  // the home page used to probe /api/check-fdalabel independently.
  const { capabilities } = useCapabilities();
  const { isInternal, fdaAccessible, cderAccessible, allowLocalQuery } = capabilities;

  const [activeDropdown, setActiveDropdown] = useState<DropdownKey | 'tasks'>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [selectedLogs, setSelectedLogs] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const logScrollRef = useRef<HTMLPreElement | null>(null);

  const totalActiveTasks = activeTasks.length;
  const avgProgress = totalActiveTasks > 0 
    ? Math.round(activeTasks.reduce((sum, t) => sum + t.progress, 0) / totalActiveTasks)
    : 0;

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const getTaskLabel = (task: any) => {
    if (task.type === 'labeling') return 'Database: Drug Labeling';
    if (task.type === 'orangebook') return 'Database: Orange Book';
    if (task.type === 'drugtox') return 'Database: askDrugTox';
    if (task.type === 'meddra') return 'Database: MedDRA';
    return `AE: ${task.target_pt || 'Report'}`;
  };

  const getTaskProjectLabel = (task: any) => {
    if (['labeling', 'orangebook', 'drugtox', 'meddra'].includes(task.type)) {
      return 'System Task';
    }
    return `Project: ${task.project_title || 'Unknown'}`;
  };

  const fetchLogs = async (taskId: number) => {
    try {
      const response = await fetch(`/api/dashboard/admin/tasks/${taskId}/logs`);
      const data = await response.json();
      setSelectedLogs(data.logs || 'No logs available.');
      setSelectedTaskId(taskId);
      setShouldAutoScroll(true);
      setIsLogModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch logs', err);
    }
  };

  // Poll for logs if the selected task is active
  useEffect(() => {
    if (!isLogModalOpen || !selectedTaskId) return;

    const isTaskActive = activeTasks.some(t => t.id === selectedTaskId && (t.status === 'processing' || t.status === 'pending'));
    if (!isTaskActive) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/dashboard/admin/tasks/${selectedTaskId}/logs`);
        const data = await response.json();
        setSelectedLogs(data.logs || 'No logs available.');
      } catch (err) {
        console.error('Failed to poll logs', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isLogModalOpen, selectedTaskId, activeTasks]);

  // Scroll to bottom when logs update or modal opens (if auto-scroll is enabled)
  useEffect(() => {
    if (isLogModalOpen && logScrollRef.current) {
      if (shouldAutoScroll) {
        logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
      }
    }
  }, [selectedLogs, isLogModalOpen, shouldAutoScroll]);

  const handleLogScroll = () => {
    const container = logScrollRef.current;
    if (!container) return;

    const threshold = 50; // pixels from the bottom
    const isAtBottom = container.scrollHeight - container.clientHeight - container.scrollTop <= threshold;
    setShouldAutoScroll(isAtBottom);
  };

  const cancelTask = async (taskId: number) => {
    if (!window.confirm("Are you sure you want to cancel this task?")) return;
    try {
      const res = await fetch(`/api/dashboard/admin/tasks/${taskId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) alert(data.error || 'Failed to cancel task');
    } catch (err) {
      alert('Error cancelling task');
    }
  };

  const closeMobile = () => setMobileMenuOpen(false);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (pathname === '/search' && typeof window !== 'undefined' && (window as any).__hasUnsavedSearchChanges) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to leave? Your conversation will be lost if not saved.")) {
        e.preventDefault();
        return;
      }
    }
    closeMobile();
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/dashboard/auth/logout', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        window.location.href = process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/askfdalabel';
      }
    } catch (err) {
      console.error('Logout failed', err);
    }
  };


  return (
    <>
    <header className="header-main header-typography">
      {/* Left: Branding */}
      <div className="header-branding">
        <a href={process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/askfdalabel'} className="header-logo-link" onClick={handleNavClick} aria-label="AskFDALabel Home">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="header-logo"
          >
            <path d="M12 2l8.66 5V17L12 22l-8.66-5V7L12 2z" strokeOpacity="0.3" />
            <path d="M12 22V12" strokeOpacity="0.3" />
            <path d="M12 12L3.34 7" strokeOpacity="0.3" />
            <path d="M12 12l8.66-5" strokeOpacity="0.3" />
            <path d="M7 16l5-9 5 9" stroke="#ffffff" strokeWidth="2.5" />
            <path d="M9 12h6" stroke="#ffffff" strokeWidth="2.5" />
            <circle cx="12" cy="12" r="2" fill="#3b82f6" stroke="#3b82f6" />
          </svg>
        </a>

        <h1 className="header-title">
          <a
            href={process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/askfdalabel'}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            AskFDALabel
          </a>
        </h1>

        <div className="custom-dropdown" onClick={(e) => e.stopPropagation()}>
          <button 
            className={cx('header-updates-btn', activeDropdown === 'updates' && 'active')}
            onClick={() => setActiveDropdown(activeDropdown === 'updates' ? null : 'updates')}
            aria-label="About"
            title="About AskFDALabel"
            style={{
              marginLeft: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px',
              borderRadius: '8px',
              color: 'rgba(255, 255, 255, 0.7)',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </button>

          {activeDropdown === 'updates' && (
            <div className="dropdown-menu" style={{ 
              width: '320px', 
              left: 0, 
              right: 'auto',
              padding: '1.5rem',
              backgroundColor: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              textAlign: 'center'
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                <img src={withAppBase("/askfdalabel_icon.svg")} alt="Logo" style={{ height: '48px' }} />
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', marginBottom: '12px' }}>
                AskFDALabel Suite
              </div>
              <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.6, marginBottom: '16px' }}>
                A next-generation AI-powered platform for scientific drug label intelligence. Features comprehensive integration with MedDRA classification and a vast repository of human drug labels.
              </div>
              <div style={{ marginBottom: '16px' }}>
                <a 
                  href="https://github.com/seldas/askFDALabel-Suite" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.85rem',
                    color: '#3b82f6',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                  </svg>
                  View on GitHub
                </a>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                &copy; {new Date().getFullYear()} FDA/NCTR
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Toggle Button */}
      <button
        className="mobile-menu-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setMobileMenuOpen((v) => !v);
        }}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        )}
      </button>

      {/* Center: Main Navigation */}
      <nav className={cx('header-nav', mobileMenuOpen && 'open')}>
        
        {/* Conversational AI Search */}
        <Link
          href="/search"
          className={cx('hp-nav-item', resolvedActiveApp === 'afl' && 'is-active')}
          aria-current={resolvedActiveApp === 'afl' ? 'page' : undefined}
          onClick={handleNavClick}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <path d="M11 8a2 2 0 0 0-2 2"></path>
          </svg>
          AI Chat
        </Link>

        {/* Dashboard */}
        <Link
          href="/dashboard"
          className={cx('hp-nav-item', resolvedActiveApp === 'dashboard' && 'is-active')}
          aria-current={resolvedActiveApp === 'dashboard' ? 'page' : undefined}
          onClick={handleNavClick}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          My Dashboard
        </Link>

        {/* Label Compare */}
        <Link
          href="/labelcomp"
          className={cx('hp-nav-item', resolvedActiveApp === 'labelcomp' && 'is-active')}
          aria-current={resolvedActiveApp === 'labelcomp' ? 'page' : undefined}
          onClick={handleNavClick}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path>
            <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path>
            <path d="M7 21h10"></path>
            <path d="M12 3v18"></path>
            <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"></path>
          </svg>
          Compare
        </Link>

        {/* DrugTox */}
        <Link
          href="/drugtox"
          className={cx('hp-nav-item', resolvedActiveApp === 'drugtox' && 'is-active')}
          aria-current={resolvedActiveApp === 'drugtox' ? 'page' : undefined}
          onClick={handleNavClick}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2v8"></path>
            <path d="M14 2v8"></path>
            <path d="M8.5 15c.7 0 1.3-.5 1.5-1.2l.5-2.3c.2-.7.8-1.2 1.5-1.2s1.3.5 1.5 1.2l.5 2.3c.2.7.8 1.2 1.5 1.2"></path>
            <path d="M6 18h12"></path>
            <path d="M6 22h12"></path>
            <circle cx="12" cy="13" r="10"></circle>
          </svg>
          DrugTox
        </Link>

        {/* Search Dropdown (Drug & Device) */}
        <div
          className="hp-nav-dropdown"
          onMouseEnter={() => setActiveDropdown('nav')}
          onMouseLeave={() => setActiveDropdown(null)}
        >
          <button
            className={cx('hp-nav-item', (resolvedActiveApp === 'fdalabel' || resolvedActiveApp === 'device' || resolvedActiveApp === 'localquery') && 'is-active')}
            aria-current={(resolvedActiveApp === 'fdalabel' || resolvedActiveApp === 'device' || resolvedActiveApp === 'localquery') ? 'page' : undefined}
            onClick={(e) => e.preventDefault()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            Resources <span className="dropdown-caret">▼</span>
          </button>

          <div className={cx('hp-dropdown-content', activeDropdown === 'nav' && 'visible')} style={{ minWidth: '240px' }}>
            {/* Drug Search Section */}
            <div className="dropdown-section-label" style={{ padding: '8px 12px 4px', fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
              FDALabel
            </div>

            {allowLocalQuery && (
              <Link
                href="/localquery"
                className={cx('hp-dropdown-item', resolvedActiveApp === 'localquery' && 'is-active')}
                onClick={handleNavClick}
              >
                <span className="hp-dropdown-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                  </svg>
                </span>
                <div>
                  <div className="dropdown-title" style={{ fontWeight: 800 }}>Local Database Search</div>
                  <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>Query local SPL & drug records</div>
                </div>
              </Link>
            )}

            {(fdaAccessible || cderAccessible) ? (
              <>
                {fdaAccessible && (
                  <a
                    href="https://fdalabel.fda.gov:8443/fdalabel/ui/search"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hp-dropdown-item"
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 21h18"></path>
                        <path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path>
                        <path d="M5 21V10.85"></path>
                        <path d="M19 21V10.85"></path>
                        <path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path>
                      </svg>
                    </span>
                    <div>
                      <div className="dropdown-title">FDA version</div>
                    </div>
                  </a>
                )}

                {cderAccessible && (
                  <a
                    href="https://fdalabel.fda.gov:8443/fdalabel-r/ui/search"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hp-dropdown-item"
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                    </span>
                    <div>
                      <div className="dropdown-title">CDER-CBER version</div>
                    </div>
                  </a>
                )}

                <a
                  href="https://nctr-crs.fda.gov/fdalabel/ui/search"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hp-dropdown-item"
                  onClick={handleNavClick}
                >
                  <span className="hp-dropdown-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21h18"></path>
                      <path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path>
                      <path d="M5 21V10.85"></path>
                      <path d="M19 21V10.85"></path>
                      <path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path>
                    </svg>
                  </span>
                  <div>
                    <div className="dropdown-title">Public version</div>
                  </div>
                </a>
              </>
            ) : (
              <a
                href="https://nctr-crs.fda.gov/fdalabel/ui/search"
                target="_blank"
                rel="noopener noreferrer"
                className="hp-dropdown-item"
                onClick={handleNavClick}
              >
                <span className="hp-dropdown-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18"></path>
                    <path d="M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4"></path>
                    <path d="M5 21V10.85"></path>
                    <path d="M19 21V10.85"></path>
                    <path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"></path>
                  </svg>
                </span>
                <div>
                  <div className="dropdown-title">Public version</div>
                </div>
              </a>
            )}



            {/* ELSA Support widgets */}
            <div className="dropdown-section-label" style={{ padding: '8px 12px 4px', fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
              Others
            </div>

            {/* Web-test Tool */}
            <Link
              href="/webtest"
              className={cx('hp-dropdown-item', resolvedActiveApp === 'webtest' && 'is-active')}
              onClick={handleNavClick}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
              </svg>
              <div>
                <div className="dropdown-title">Web-test Tool</div>
                <div className="dropdown-subtitle">Automated Web Testing</div>
              </div>
            </Link>

          </div>
        </div>

      </nav>

      {/* Right: User Controls */}
      <div className={cx('header-controls', mobileMenuOpen && 'open')}>
        {loading ? (
          <span className="header-muted">Loading...</span>
        ) : session?.is_authenticated ? (
          <>
            {/* Active Tasks Indicator */}
            {totalActiveTasks > 0 && (
              <div className="custom-dropdown" onClick={(e) => e.stopPropagation()}>
                <button 
                  className={cx('dropdown-trigger header-chip', activeDropdown === 'tasks' && 'active')} 
                  onClick={() => setActiveDropdown(activeDropdown === 'tasks' ? null : 'tasks')}
                  style={{ background: '#eef2ff', color: '#6366f1', border: '1px solid #e0e7ff' }}
                >
                  <span className="pulse-dot"></span>
                  <span style={{ fontWeight: 800 }}>{totalActiveTasks} Active Task{totalActiveTasks > 1 ? 's' : ''}</span>
                  <span style={{ fontSize: '0.75rem', marginLeft: '4px', opacity: 0.8 }}>{avgProgress}%</span>
                  <span className="caret">▼</span>
                </button>

                {activeDropdown === 'tasks' && (
                  <div className="dropdown-menu" style={{ width: '280px', padding: '12px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px', padding: '0 4px' }}>
                      Background Operations
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {activeTasks.map(task => (
                        <div key={task.id} style={{ padding: '8px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {getTaskLabel(task)}
                            </div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#6366f1' }}>{task.progress}%</div>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '6px' }}>{getTaskProjectLabel(task)}</div>
                          <div style={{ width: '100%', height: '4px', background: '#eef2ff', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
                            <div style={{ width: `${task.progress}%`, height: '100%', background: '#6366f1', transition: 'width 0.3s ease' }} />
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); fetchLogs(task.id); }}
                              style={{
                                background: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                fontSize: '0.65rem',
                                cursor: 'pointer',
                                fontWeight: 800,
                                flex: 1
                              }}
                            >
                              VIEW LOGS
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancelTask(task.id); }}
                              style={{
                                background: '#fef2f2',
                                color: '#ef4444',
                                border: '1px solid #fca5a5',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                fontSize: '0.65rem',
                                cursor: 'pointer',
                                fontWeight: 800,
                                flex: 1
                              }}
                            >
                              CANCEL
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Settings Dropdown */}
            <div className="custom-dropdown" onClick={(e) => e.stopPropagation()}>
              <button 
                className={cx('dropdown-trigger header-chip', activeDropdown === 'user' && 'active')} 
                onClick={() => setActiveDropdown(activeDropdown === 'user' ? null : 'user')}
              >
                <div className="avatar-circle">{session.username?.[0].toUpperCase()}</div>
                <span className="username-text" style={{ fontWeight: 800 }}>{session.username}</span>
                <span className="caret">▼</span>
              </button>

              {activeDropdown === 'user' && (
                <div className="dropdown-menu">
                  <div className="account-block">
                    <div className="account-label">ACCOUNT</div>
                    <div className="account-name">{session.username}</div>
                    <div style={{ marginTop: '8px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>
                        AI: {session.ai_provider?.toUpperCase()}
                    </div>
                  </div>

                  <div className="account-actions">
                    <Link href="/management" className="dropdown-item" style={{ color: '#6366f1', fontWeight: 800 }}>
                      {session?.is_admin ? 'System Management' : 'Settings & Preferences'}
                    </Link>
                    {session?.username === 'guest' && (
                      <button onClick={() => { openAuthModal('login'); setActiveDropdown(null); }} className="dropdown-item">
                        Log In
                      </button>
                    )}
                    {session?.username !== 'guest' && (
                      <button onClick={() => { openAuthModal('change_password'); setActiveDropdown(null); }} className="dropdown-item">
                        Change Password
                      </button>
                    )}
                    <button onClick={handleLogout} className="dropdown-item danger">
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="header-auth-buttons">
            <button onClick={() => openAuthModal('login')} className="btn-login">
              Login
            </button>
            <button onClick={() => openAuthModal('register')} className="btn-register">
              Register
            </button>
          </div>
        )}
      </div>
      <style jsx>{`
        @keyframes modalEnter {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .ai-option-card {
          width: 100%;
          padding: 1rem 1.25rem;
          border-radius: 12px;
          border: 2px solid #f1f5f9;
          background: white;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s ease;
          color: #1e293b;
        }

        .ai-option-card:hover {
          border-color: #cbd5e1;
          background: #f8fafc;
        }

        .ai-option-card.selected {
          border-color: #6366f1;
          background: #f5f3ff;
          color: #4338ca;
        }

        .pulse-dot {
          width: 8px;
          height: 8px;
          background-color: #6366f1;
          border-radius: 50%;
          display: inline-block;
          margin-right: 8px;
          box-shadow: 0 0 0 rgba(99, 102, 241, 0.4);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(99, 102, 241, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
          }
        }

        .header-chip.active {
          background-color: #e0e7ff !important;
          border-color: #6366f1 !important;
        }

        .header-updates-btn:hover, .header-updates-btn.active {
          background-color: rgba(255, 255, 255, 0.2) !important;
          color: white !important;
          border-color: rgba(255, 255, 255, 0.3) !important;
        }
      `}</style>
    </header>

      {/* Log Modal */}
      {isLogModalOpen && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => {
            setIsLogModalOpen(false);
            setSelectedTaskId(null);
          }}
        >
          <div
            style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '80%', maxWidth: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#1e293b' }}>
                Task Execution Logs {selectedTaskId ? `(ID: ${selectedTaskId})` : ''}
              </h3>
              <button
                onClick={() => {
                  setIsLogModalOpen(false);
                  setSelectedTaskId(null);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, color: '#64748b' }}
              >
                CLOSE
              </button>
            </div>
            <pre
              ref={logScrollRef}
              onScroll={handleLogScroll}
              style={{ flex: 1, overflow: 'auto', background: '#f8fafc', padding: '16px', borderRadius: '8px', fontSize: '0.85rem', color: '#334155', border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap' }}
            >
              {selectedLogs || 'No logs available.'}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
