'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '../context/UserContext';
import { useCapabilities } from '../platform/capabilities';
import { cx } from '../platform/primitives';
import { ToolIcon } from '../platform/icons';
import { getTool } from '../platform/registry';
import { isToolAvailable } from '../platform/ToolLauncher';
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

// Empty launch context: every tool in this nav declares the 'global' context
// kind, so {} is enough for isToolAvailable to evaluate capability gating.
const GLOBAL_CTX = {};

/** Primary nav bar items, in display order, mapped to their ActiveApp key. */
const PRIMARY_NAV: { toolId: string; activeApp: ActiveApp }[] = [];

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

  const { capabilities } = useCapabilities();

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

    const threshold = 50;
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
        window.location.href = process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/fdalabel-v3';
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
        <a href={process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/fdalabel-v3'} className="header-logo-link" onClick={handleNavClick} aria-label="AskFDALabel Home">
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

        <h1 className="header-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <a
            href={process.env.NEXT_PUBLIC_DASHBOARD_BASE || '/fdalabel-v3'}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            FDALabel - V3.0
          </a>
          <span style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            color: '#f87171',
            padding: '2px 8px',
            borderRadius: '12px',
            lineHeight: '1.2',
            letterSpacing: '0.05em'
          }}>
            alpha
          </span>
        </h1>
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

      {/* Right Controls: 1. Resources, 2. User Panel, 3. About */}
      <div className={cx('header-controls', mobileMenuOpen && 'open')}>

        {/* 1. Resources Dropdown */}
        <div
          className="custom-dropdown"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={cx('dropdown-trigger header-chip', activeDropdown === 'nav' && 'active')}
            onClick={() => setActiveDropdown(activeDropdown === 'nav' ? null : 'nav')}
          >
            <span style={{ fontWeight: 800 }}>Resources</span>
            <span className="caret">▼</span>
          </button>

          {activeDropdown === 'nav' && (
            <div className="dropdown-menu" style={{ minWidth: '250px', right: 0, left: 'auto' }}>
              <div className="dropdown-section-label" style={{ padding: '8px 12px 4px', fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
                FDALabel
              </div>

              {(() => {
                const localquery = getTool('localquery')!;
                return isToolAvailable(localquery, GLOBAL_CTX, capabilities) ? (
                  <Link
                    href={localquery.href(GLOBAL_CTX)}
                    className={cx('hp-dropdown-item', resolvedActiveApp === 'localquery' && 'is-active')}
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <ToolIcon id={localquery.iconId} size={18} />
                    </span>
                    <div>
                      <div className="dropdown-title" style={{ fontWeight: 800 }}>{localquery.name}</div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>{localquery.blurb}</div>
                    </div>
                  </Link>
                ) : null;
              })()}

              {(['fdalabel-fda', 'fdalabel-cder', 'fdalabel-public'] as const).map((toolId) => {
                const tool = getTool(toolId)!;
                const available = isToolAvailable(tool, GLOBAL_CTX, capabilities);
                if (!available) {
                  return (
                    <div
                      key={toolId}
                      className="hp-dropdown-item is-disabled"
                      style={{
                        opacity: 0.45,
                        cursor: 'not-allowed',
                        userSelect: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                      }}
                      title="Disabled — Available on internal FDA network only"
                    >
                      <span className="hp-dropdown-icon" style={{ filter: 'grayscale(1)' }}>
                        <ToolIcon id={tool.iconId} size={18} />
                      </span>
                      <div>
                        <div className="dropdown-title" style={{ color: '#94a3b8', textDecoration: 'line-through' }}>
                          {tool.name.replace('FDALabel (', '').replace(')', '')} version
                        </div>
                        <div style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 600 }}>
                          (Disabled - Internal Only)
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <a
                    key={toolId}
                    href={tool.href(GLOBAL_CTX)}
                    target={tool.target ?? '_blank'}
                    rel="noopener noreferrer"
                    className="hp-dropdown-item"
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <ToolIcon id={tool.iconId} size={18} />
                    </span>
                    <div>
                      <div className="dropdown-title">{tool.name.replace('FDALabel (', '').replace(')', '')} version</div>
                    </div>
                  </a>
                );
              })}

              <div className="dropdown-section-label" style={{ padding: '8px 12px 4px', fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
                Others
              </div>

              {(() => {
                const searchTool = getTool('search');
                if (!searchTool || !isToolAvailable(searchTool, GLOBAL_CTX, capabilities)) return null;
                return (
                  <a
                    href={searchTool.href(GLOBAL_CTX)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cx('hp-dropdown-item', resolvedActiveApp === 'afl' && 'is-active')}
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <ToolIcon id={searchTool.iconId} size={18} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="dropdown-title" style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>LabelChat</span>
                        <span style={{
                          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                          color: '#ffffff',
                          fontSize: '0.6rem',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          letterSpacing: '0.05em',
                          lineHeight: 1.2,
                          display: 'inline-block'
                        }}>BETA</span>
                      </div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>{searchTool.blurb}</div>
                    </div>
                  </a>
                );
              })()}

              {(() => {
                const drugtox = getTool('drugtox');
                if (!drugtox || !isToolAvailable(drugtox, GLOBAL_CTX, capabilities)) return null;
                return (
                  <a
                    href={drugtox.href(GLOBAL_CTX)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cx('hp-dropdown-item', resolvedActiveApp === 'drugtox' && 'is-active')}
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <ToolIcon id={drugtox.iconId} size={18} />
                    </span>
                    <div>
                      <div className="dropdown-title" style={{ fontWeight: 800 }}>askDrugTox</div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>{drugtox.blurb}</div>
                    </div>
                  </a>
                );
              })()}

              {(() => {
                const webtest = getTool('webtest')!;
                return (
                  <a
                    href={webtest.href(GLOBAL_CTX)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cx('hp-dropdown-item', resolvedActiveApp === 'webtest' && 'is-active')}
                    onClick={handleNavClick}
                  >
                    <ToolIcon id={webtest.iconId} size={16} />
                    <div>
                      <div className="dropdown-title">{webtest.name}</div>
                      <div className="dropdown-subtitle">{webtest.blurb}</div>
                    </div>
                  </a>
                );
              })()}
            </div>
          )}
        </div>

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

            {/* 2. User Panel Dropdown */}
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
                <div className="dropdown-menu" style={{ right: 0, left: 'auto' }}>
                  <div className="account-block">
                    <div className="account-label">ACCOUNT</div>
                    <div className="account-name">{session.username}</div>
                    <div style={{ marginTop: '8px', padding: '4px 8px', background: '#f1f5f9', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>
                        AI: {session.ai_provider?.toUpperCase()}
                    </div>
                  </div>

                  <div className="account-actions">
                    <Link href="/dashboard" className="dropdown-item" onClick={() => setActiveDropdown(null)} style={{ color: '#2563eb', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                      My Dashboard
                    </Link>
                    <Link href="/dashboard/query_history" className="dropdown-item" onClick={() => setActiveDropdown(null)} style={{ color: '#4f46e5', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                      Search & Query History
                    </Link>
                    <Link href="/management" className="dropdown-item" style={{ color: '#6366f1', fontWeight: 700 }}>
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

        {/* Disclaimer Link in Header */}
        <Link 
          href="/disclaimer"
          className="header-chip"
          title="FDALabel Disclaimer"
          style={{ textDecoration: 'none', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Disclaimer</span>
        </Link>

        {/* 3. About Dropdown */}
        <div className="custom-dropdown" onClick={(e) => e.stopPropagation()}>
          <button 
            className={cx('dropdown-trigger header-chip', activeDropdown === 'updates' && 'active')}
            onClick={() => setActiveDropdown(activeDropdown === 'updates' ? null : 'updates')}
            aria-label="About"
            title="About FDALabel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span style={{ fontWeight: 800 }}>About</span>
          </button>

          {activeDropdown === 'updates' && (
            <div className="dropdown-menu" style={{ 
              width: '340px', 
              right: 0, 
              left: 'auto',
              padding: '1.5rem',
              backgroundColor: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span>FDALabel - V3.0</span>
                <span style={{ 
                  fontSize: '0.65rem', 
                  fontWeight: 700, 
                  textTransform: 'uppercase', 
                  backgroundColor: '#fee2e2', 
                  color: '#dc2626', 
                  padding: '2px 8px', 
                  borderRadius: '12px',
                  lineHeight: '1.2',
                  letterSpacing: '0.05em'
                }}>
                  alpha
                </span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.6, marginBottom: '14px' }}>
                FDALabel web application for search, customization, and analysis of drug labeling metadata.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', marginBottom: '16px', textAlign: 'left', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <a
                  href="https://www.fda.gov/ScienceResearch/BioinformaticsTools/ucm289739.htm"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <span>FDA Bioinformatics Tools ↗</span>
                </a>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.78rem', marginTop: '2px' }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Report Technical Problems:</span>
                  <a
                    href="mailto:NCTRBioinformaticsSupport@fda.hhs.gov"
                    style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'underline', wordBreak: 'break-all' }}
                  >
                    NCTRBioinformaticsSupport@fda.hhs.gov
                  </a>
                </div>
                <Link
                  href="/disclaimer"
                  onClick={() => setActiveDropdown(null)}
                  style={{ color: '#475569', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>FDALabel Disclaimer</span>
                </Link>
              </div>

              <div style={{ fontSize: '0.75rem', color: '#94a3b8', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                &copy; {new Date().getFullYear()} FDA/NCTR
              </div>
            </div>
          )}
        </div>

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

        .header-controls {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
        }

        .custom-dropdown {
          position: relative !important;
          display: inline-flex !important;
          align-items: center !important;
          vertical-align: middle !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        .header-chip {
          height: 36px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 0 14px !important;
          border-radius: 10px !important;
          border: 1px solid rgba(255, 255, 255, 0.25) !important;
          background: rgba(255, 255, 255, 0.08) !important;
          color: #ffffff !important;
          font-size: 0.88rem !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          box-sizing: border-box !important;
          line-height: 1 !important;
          margin: 0 !important;
          vertical-align: middle !important;
        }

        .header-chip:hover {
          background-color: rgba(255, 255, 255, 0.2) !important;
          border-color: rgba(255, 255, 255, 0.4) !important;
          color: #ffffff !important;
        }

        .header-chip.active {
          background-color: #ffffff !important;
          color: #0f172a !important;
          border-color: #ffffff !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
        }

        .header-chip.active span,
        .header-chip.active .caret,
        .header-chip.active svg {
          color: #0f172a !important;
          stroke: #0f172a !important;
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
