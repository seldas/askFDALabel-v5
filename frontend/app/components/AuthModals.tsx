'use client';

import { useState } from 'react';
import { useUser } from '../context/UserContext';
import Modal from './Modal';

export default function AuthModals() {
  const { authModal, openAuthModal, refreshSession } = useUser();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleClose = () => {
    openAuthModal(null);
    setAuthError(null);
    setShowPassword(false);
    setUsername('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    let endpoint = '/api/dashboard/auth/login';
    let body: any = { username, password };

    if (authModal === 'register') {
      endpoint = '/api/dashboard/auth/register';
    } else if (authModal === 'change_password') {
      endpoint = '/api/dashboard/auth/change_password';
      body = { password };
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        await refreshSession();
        handleClose();
      } else {
        setAuthError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setAuthError('An unexpected error occurred');
    } finally {
      setAuthLoading(false);
    }
  };

  if (!authModal) return null;

  return (
    <>
      {/* Sign In Modal */}
      <Modal 
        isOpen={authModal === 'login'} 
        onClose={handleClose}
        title="Sign In"
      >
        <form onSubmit={handleAuthAction} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {authError && <div style={{ color: '#ef4444', background: '#fef2f2', padding: '14px', borderRadius: '12px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #fee2e2' }}>{authError}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#475569', marginLeft: '4px' }}>Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ padding: '14px 18px', borderRadius: '14px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', transition: 'all 0.2s', background: '#f8fafc' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = 'white'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
              placeholder="Enter your username"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#475569', marginLeft: '4px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '14px 52px 14px 18px', borderRadius: '14px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', transition: 'all 0.2s', background: '#f8fafc' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = 'white'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
                placeholder="••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', padding: '4px' }}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          <button 
            type="submit" 
            disabled={authLoading}
            style={{ 
              marginTop: '12px',
              padding: '16px', 
              borderRadius: '16px', 
              border: 'none', 
              backgroundColor: '#002e5d', 
              color: 'white', 
              fontWeight: 800, 
              fontSize: '1rem',
              cursor: authLoading ? 'not-allowed' : 'pointer',
              opacity: authLoading ? 0.7 : 1,
              boxShadow: '0 8px 20px -4px rgba(0, 46, 93, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            {authLoading ? 'Signing in...' : 'Sign In'}
          </button>
          <div style={{ textAlign: 'center', fontSize: '0.875rem', color: '#64748b' }}>
            Don't have an account? <button type="button" onClick={() => { openAuthModal('register'); setAuthError(null); setShowPassword(false); }} style={{ color: '#3b82f6', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>Create one</button>
          </div>
        </form>
      </Modal>

      {/* Create Account Modal */}
      <Modal 
        isOpen={authModal === 'register'} 
        onClose={handleClose}
        title="Create Account"
      >
        <form onSubmit={handleAuthAction} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {authError && <div style={{ color: '#ef4444', background: '#fef2f2', padding: '14px', borderRadius: '12px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #fee2e2' }}>{authError}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#475569', marginLeft: '4px' }}>Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ padding: '14px 18px', borderRadius: '14px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', transition: 'all 0.2s', background: '#f8fafc' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = 'white'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
              placeholder="Choose a username"
            />
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '4px' }}>Use letters, numbers, and . @ _ - +</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#475569', marginLeft: '4px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '14px 52px 14px 18px', borderRadius: '14px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', transition: 'all 0.2s', background: '#f8fafc' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = 'white'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
                placeholder="••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', padding: '4px' }}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          
          <div style={{
            backgroundColor: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '12px',
            padding: '12px 16px',
            marginTop: '4px',
            fontSize: '0.8rem',
            color: '#0369a1',
            lineHeight: 1.5
          }}>
            <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li><strong>Registration is free and encouraged.</strong></li>
              <li>We may switch to Single Sign-On (SSO) in the future.</li>
              <li>This tool is under development, and personal data may not be saved and transferred to the prod version.</li>
            </ul>
          </div>

          <button 
            type="submit" 
            disabled={authLoading}
            style={{ 
              marginTop: '12px',
              padding: '16px', 
              borderRadius: '16px', 
              border: 'none', 
              backgroundColor: '#002e5d', 
              color: 'white', 
              fontWeight: 800, 
              fontSize: '1rem',
              cursor: authLoading ? 'not-allowed' : 'pointer',
              opacity: authLoading ? 0.7 : 1,
              boxShadow: '0 8px 20px -4px rgba(0, 46, 93, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            {authLoading ? 'Creating account...' : 'Create Account'}
          </button>
          <div style={{ textAlign: 'center', fontSize: '0.875rem', color: '#64748b' }}>
            Already have an account? <button type="button" onClick={() => { openAuthModal('login'); setAuthError(null); setShowPassword(false); }} style={{ color: '#3b82f6', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>Sign in</button>
          </div>
        </form>
      </Modal>

      {/* Update Password Modal */}
      <Modal 
        isOpen={authModal === 'change_password'} 
        onClose={handleClose}
        title="Update Password"
      >
        <form onSubmit={handleAuthAction} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {authError && <div style={{ color: '#ef4444', background: '#fef2f2', padding: '14px', borderRadius: '12px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #fee2e2' }}>{authError}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#475569', marginLeft: '4px' }}>New Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '14px 52px 14px 18px', borderRadius: '14px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', transition: 'all 0.2s', background: '#f8fafc' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = 'white'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
                placeholder="••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', padding: '4px' }}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#475569', marginLeft: '4px' }}>Confirm New Password</label>
            <input 
              type={showPassword ? "text" : "password"} 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{ padding: '14px 18px', borderRadius: '14px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', transition: 'all 0.2s', background: '#f8fafc' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = 'white'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
              placeholder="••••••••"
            />
          </div>
          <button 
            type="submit" 
            disabled={authLoading || (password !== confirmPassword && password !== '')}
            style={{ 
              marginTop: '12px',
              padding: '16px', 
              borderRadius: '16px', 
              border: 'none', 
              backgroundColor: '#002e5d', 
              color: 'white', 
              fontWeight: 800, 
              fontSize: '1rem',
              cursor: (authLoading || (password !== confirmPassword && password !== '')) ? 'not-allowed' : 'pointer',
              opacity: (authLoading || (password !== confirmPassword && password !== '')) ? 0.7 : 1,
              boxShadow: '0 8px 20px -4px rgba(0, 46, 93, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            {authLoading ? 'Updating...' : 'Update Password'}
          </button>
          {password !== confirmPassword && confirmPassword !== '' && (
            <div style={{ color: '#ef4444', fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Passwords do not match</div>
          )}
        </form>
      </Modal>
    </>
  );
}
