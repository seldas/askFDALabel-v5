'use client';

import { useState } from 'react';
import { useUser } from '../context/UserContext';
import Modal from './Modal';

export default function AuthModals() {
  const { session, authModal, openAuthModal, refreshSession } = useUser();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Form states (for change_password)
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleClose = () => {
    openAuthModal(null);
    setAuthError(null);
    setShowPassword(false);
    setPassword('');
    setConfirmPassword('');
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      const res = await fetch('/api/dashboard/auth/change_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        await refreshSession();
        handleClose();
      } else {
        setAuthError(data.error || 'Password update failed');
      }
    } catch {
      setAuthError('An unexpected error occurred');
    } finally {
      setAuthLoading(false);
    }
  };

  if (!authModal) return null;

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px',
    borderRadius: 'var(--fdl-radius-sm, 2px)',
    border: '1px solid var(--fdl-line, #b8c8d7)',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'border-color 0.15s',
    background: 'var(--fdl-paper, #ffffff)',
    color: 'var(--fdl-ink, #132332)',
  };

  const primaryBtnStyle: React.CSSProperties = {
    marginTop: '6px',
    padding: '10px 16px',
    borderRadius: 'var(--fdl-radius-sm, 2px)',
    border: '1px solid var(--fdl-blue-800, #004d80)',
    backgroundColor: 'var(--fdl-blue-700, #0759a5)',
    color: 'white',
    fontWeight: 700,
    fontSize: '0.9rem',
    cursor: authLoading ? 'not-allowed' : 'pointer',
    opacity: authLoading ? 0.7 : 1,
    boxShadow: 'none',
    transition: 'background-color 0.15s',
  };

  return (
    <>
      {/* Sign In Modal (Single Sign-On Prompt) */}
      <Modal 
        isOpen={authModal === 'login'} 
        onClose={handleClose}
        title="Sign In"
      >
        <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
          <p style={{ color: 'var(--fdl-muted, #5e6e7c)', fontSize: '0.875rem', lineHeight: 1.5, margin: '0 0 20px' }}>
            AskFDALabel uses Single Sign-On (SSO). Please sign in with your institutional credentials.
          </p>
          {session?.sso_enabled ? (
            <a 
              href={'/api/dashboard/auth/saml/login?next=' + encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '8px', 
                padding: '12px 20px', 
                borderRadius: 'var(--fdl-radius-sm, 2px)', 
                background: 'var(--fdl-blue-700, #0759a5)', 
                color: 'white', 
                fontWeight: 700, 
                fontSize: '0.95rem', 
                textDecoration: 'none', 
                border: '1px solid var(--fdl-blue-800, #004d80)',
                transition: 'background-color 0.15s ease'
              }}
            >
              Sign in with {session.sso_label || 'SSO'} →
            </a>
          ) : (
            <div style={{ color: '#991b1b', background: '#fef2f2', padding: '12px 16px', borderRadius: 'var(--fdl-radius-sm, 2px)', fontSize: '0.85rem', fontWeight: 600, border: '1px solid #fecaca' }}>
              Single Sign-On is not configured on this deployment. Please contact an administrator.
            </div>
          )}
        </div>
      </Modal>

      {/* Update Password Modal */}
      <Modal 
        isOpen={authModal === 'change_password'} 
        onClose={handleClose}
        title="Update Password"
      >
        <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {authError && (
            <div style={{ color: '#991b1b', background: '#fef2f2', padding: '10px 14px', borderRadius: 'var(--fdl-radius-sm, 2px)', fontSize: '0.85rem', fontWeight: 600, border: '1px solid #fecaca' }}>
              {authError}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--fdl-ink-soft, #273843)' }}>New Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ ...inputStyle, width: '100%', paddingRight: '44px' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--fdl-blue-700, #0759a5)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--fdl-line, #b8c8d7)'; }}
                placeholder="••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fdl-muted, #5e6e7c)', display: 'flex', alignItems: 'center', padding: '4px' }}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--fdl-ink-soft, #273843)' }}>Confirm New Password</label>
            <input 
              type={showPassword ? "text" : "password"} 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--fdl-blue-700, #0759a5)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--fdl-line, #b8c8d7)'; }}
              placeholder="••••••••"
            />
          </div>
          <button 
            type="submit" 
            disabled={authLoading || (password !== confirmPassword && password !== '')}
            style={primaryBtnStyle}
          >
            {authLoading ? 'Updating...' : 'Update Password'}
          </button>
          {password !== confirmPassword && confirmPassword !== '' && (
            <div style={{ color: '#b91c1c', fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Passwords do not match</div>
          )}
        </form>
      </Modal>
    </>
  );
}
