'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '../context/UserContext';
import { useCapabilities } from '../platform/capabilities';
import { cx } from '../platform/primitives';
import { ToolIcon } from '../platform/icons';
import { getTool } from '../platform/registry';
import { isToolAvailable, useToolAccess } from '../platform/ToolLauncher';
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

  /* The shared anonymous account. Prefer the server's flag; fall back to the
     username so a cached session from before the flag existed still hides the
     right things. */
  const isGuest = session?.is_guest ?? (session?.username?.toLowerCase() === 'guest');

  const pathname = usePathname();
  const resolvedActiveApp = useMemo(
    () => activeApp ?? inferActiveApp(pathname || ''),
    [activeApp, pathname]
  );

  const { capabilities } = useCapabilities();
  const toolAccess = useToolAccess();

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
            AskFDALabel -V3.0
          </a>
          <span style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            backgroundColor: '#dcecf8',
            color: '#0759a5',
            padding: '2px 8px',
            borderRadius: '2px',
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
                return isToolAvailable(localquery, GLOBAL_CTX, capabilities, toolAccess) ? (
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

              {(() => {
                const chemsearch = getTool('chemsearch')!;
                return isToolAvailable(chemsearch, GLOBAL_CTX, capabilities, toolAccess) ? (
                  <a
                    href={chemsearch.href(GLOBAL_CTX)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hp-dropdown-item"
                    onClick={handleNavClick}
                  >
                    <span className="hp-dropdown-icon">
                      <ToolIcon id={chemsearch.iconId} size={18} />
                    </span>
                    <div>
                      <div className="dropdown-title" style={{ fontWeight: 800 }}>{chemsearch.name}</div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 500 }}>{chemsearch.blurb}</div>
                    </div>
                  </a>
                ) : null;
              })()}

              {(['fdalabel-fda', 'fdalabel-cder', 'fdalabel-public'] as const).map((toolId) => {
                const tool = getTool(toolId)!;
                const available = isToolAvailable(tool, GLOBAL_CTX, capabilities, toolAccess);
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
                if (!searchTool || !isToolAvailable(searchTool, GLOBAL_CTX, capabilities, toolAccess)) return null;
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
                          background: '#dcecf8',
                          color: '#0759a5',
                          fontSize: '0.6rem',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: '2px',
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
                if (!drugtox || !isToolAvailable(drugtox, GLOBAL_CTX, capabilities, toolAccess)) return null;
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
                return isToolAvailable(webtest, GLOBAL_CTX, capabilities, toolAccess) ? (
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
                ) : null;
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
                  style={{ background: '#edf4fa', color: '#0759a5', border: '1px solid #b8c8d7' }}
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
                            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#0759a5' }}>{task.progress}%</div>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '6px' }}>{getTaskProjectLabel(task)}</div>
                          <div style={{ width: '100%', height: '4px', background: '#dcecf8', borderRadius: '0', overflow: 'hidden', marginBottom: '8px' }}>
                            <div style={{ width: `${task.progress}%`, height: '100%', background: '#0071bc', transition: 'width 0.3s ease' }} />
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
                className={cx('dropdown-trigger header-chip header-chip--account', activeDropdown === 'user' && 'active')}
                onClick={() => setActiveDropdown(activeDropdown === 'user' ? null : 'user')}
              >
                <div className="avatar-circle">{session.username?.[0].toUpperCase()}</div>
                <span className="username-text">{session.username}</span>
                <span className="caret">▼</span>
              </button>

              {activeDropdown === 'user' && (
                <div className="dropdown-menu account-dropdown-menu" style={{ right: 0, left: 'auto' }}>
                  <div className="account-block">
                    <div className="account-label">ACCOUNT</div>
                    <div className="account-identity">
                      <div className="account-avatar" aria-hidden="true">{session.username?.[0].toUpperCase()}</div>
                      <div>
                        <div className="account-name">{session.username}</div>
                        <div className="account-role">{session?.is_admin ? 'Administrator' : 'Account'}</div>
                      </div>
                    </div>
                    <div className="account-ai-status" title={!session?.is_admin ? "This model is selected by the administrator" : undefined}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>
                      <span>AI model</span>
                      <strong>{session.ai_provider?.toUpperCase()}</strong>
                    </div>
                    {session?.is_admin && !isGuest ? (
                      <Link
                        href="/management?tab=ai#ai-settings"
                        className="account-ai-config"
                        onClick={() => setActiveDropdown(null)}
                      >
                        Manage AI model
                        <span aria-hidden="true">→</span>
                      </Link>
                    ) : null}
                  </div>

                  <div className="account-actions">
                    <div className="dropdown-section-label">WORKSPACE</div>
                    <Link href="/dashboard" className="dropdown-item dropdown-item--secondary-action" onClick={() => setActiveDropdown(null)}>
                      My Dashboard
                    </Link>
                    {/* Query history and preferences are per-user state on a
                        row every anonymous visitor shares, so both are closed
                        to the guest account. The routes behind them return 403
                        for a guest too -- this only removes the entry points. */}
                    {!isGuest && (
                      <Link href="/dashboard/query_history" className="dropdown-item dropdown-item--secondary-action" onClick={() => setActiveDropdown(null)}>
                        Search & Query History
                      </Link>
                    )}
                    {!isGuest && <div className="dropdown-section-label dropdown-section-label--separated">ACCOUNT</div>}
                    {!isGuest && (
                      <Link href="/management" className="dropdown-item dropdown-item--secondary-action" onClick={() => setActiveDropdown(null)}>
                        {session?.is_admin ? 'System Management' : 'Settings & Preferences'}
                      </Link>
                    )}
                    {isGuest && (
                      <button onClick={() => { openAuthModal('login'); setActiveDropdown(null); }} className="dropdown-item">
                        Log In
                      </button>
                    )}
                    {!isGuest && (
                      <button onClick={() => { openAuthModal('change_password'); setActiveDropdown(null); }} className="dropdown-item dropdown-item--secondary-action">
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
            <div className="dropdown-menu about-dropdown-menu" style={{ right: 0, left: 'auto' }}>
              <div className="about-product">
                <div className="about-product-heading">
                  <span>AskFDALabel V3</span>
                  <span className="about-badge">Alpha</span>
                </div>
                <p>Search, review, and analyze FDA drug-label metadata.</p>
              </div>
              <div className="about-links">
                <Link href="/wiki" target="_blank" rel="noopener noreferrer" onClick={() => setActiveDropdown(null)} className="about-link about-link--primary">
                  <span className="about-link-icon" aria-hidden="true">?</span>
                  <span><strong>User Guide &amp; Wiki</strong><small>FAQs, guidance, and workflows</small></span>
                  <span aria-hidden="true">↗</span>
                </Link>
                <a
                  href="https://www.fda.gov/ScienceResearch/BioinformaticsTools/ucm289739.htm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-link"
                >
                  FDA Bioinformatics Tools <span aria-hidden="true">↗</span>
                </a>
                <a href="mailto:NCTRBioinformaticsSupport@fda.hhs.gov" className="about-link about-link--support">
                  Technical support <span>NCTRBioinformaticsSupport@fda.hhs.gov</span>
                </a>
                <Link href="/disclaimer" onClick={() => setActiveDropdown(null)} className="about-link">
                  FDALabel Disclaimer <span aria-hidden="true">→</span>
                </Link>
              </div>
              <div className="about-footer">
                &copy; {new Date().getFullYear()} FDA/NCTR
              </div>
            </div>
          )}
        </div>

      </div>
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
