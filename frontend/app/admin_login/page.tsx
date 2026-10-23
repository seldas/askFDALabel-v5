'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '../context/UserContext';
import { withAppBase } from '../utils/appPaths';
import styles from './admin_login.module.css';

export default function AdminLoginPage() {
  const router = useRouter();
  const { session, refreshSession } = useUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/dashboard/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        await refreshSession();
        router.push('/');
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/dashboard/auth/logout');
      await refreshSession();
    } catch (err) {
      console.error('Logout error', err);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="admin-login-title">
        <header className={styles.header}>
          <img
            src={withAppBase('/askFDALabel_hero.png')}
            alt="AskFDALabel"
            className={styles.logo}
          />
          <span className={styles.badge}>ADMINISTRATIVE ACCESS</span>
          <h1 id="admin-login-title" className={styles.title}>Account Sign In</h1>
          <p className={styles.subtitle}>Direct credentials login for administrative and maintenance use.</p>
        </header>

        {session?.is_authenticated ? (
          <div className={styles.statusCard}>
            <p>
              You are currently signed in as <strong>{session.display_name || session.username}</strong>
              {session.is_admin ? ' (Administrator)' : ''}.
            </p>
            <div className={styles.statusActions}>
              <button
                type="button"
                className={styles.submitBtn}
                onClick={() => router.push('/')}
              >
                Go to Workspace
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.notice}>
              This entry is reserved for direct account access and system maintenance. Standard users should authenticate via Single Sign-On (SSO).
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              {error && (
                <div className={styles.errorBox} role="alert">
                  {error}
                </div>
              )}

              <div className={styles.field}>
                <label htmlFor="admin-username" className={styles.label}>Username</label>
                <input
                  id="admin-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  className={styles.input}
                  placeholder="Enter account username"
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="admin-password" className={styles.label}>Password</label>
                <div className={styles.inputWrapper}>
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className={styles.input}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={styles.toggleBtn}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={styles.submitBtn}
              >
                {loading ? 'Signing in...' : 'Sign In with Account'}
              </button>
            </form>
          </>
        )}

        <div className={styles.footerNav}>
          <Link href="/" className={styles.backLink}>
            ← Return to Single Sign-On (SSO) Sign In
          </Link>
        </div>
      </section>
    </main>
  );
}
