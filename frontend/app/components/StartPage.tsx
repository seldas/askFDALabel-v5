'use client';

import { useEffect, useState } from 'react';
import { withAppBase } from '../utils/appPaths';
import styles from './StartPage.module.css';

interface StartPageProps {
  onLogin?: () => void;
  onGuest?: () => void;
  ssoEnabled: boolean;
  requireRapidConfirm?: boolean;
  rapidRedirectUrl?: string;
}

type RapidStatus = 'checking' | 'available' | 'unavailable';

export default function StartPage({
  ssoEnabled,
  requireRapidConfirm = false,
  rapidRedirectUrl = '',
}: StartPageProps) {
  const [confirmedDevAccess, setConfirmedDevAccess] = useState(false);
  const [rapidStatus, setRapidStatus] = useState<RapidStatus>(
    requireRapidConfirm ? 'checking' : 'available',
  );
  const [resolvedRapidUrl, setResolvedRapidUrl] = useState(rapidRedirectUrl);

  useEffect(() => {
    if (!requireRapidConfirm) return;
    let cancelled = false;
    setRapidStatus('checking');

    (async () => {
      try {
        const res = await fetch('/api/check-rapid');
        if (!res.ok) throw new Error('check-rapid failed');
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.url === 'string' && data.url) {
          setResolvedRapidUrl(data.url);
        }
        setRapidStatus(data.available ? 'available' : 'unavailable');
      } catch {
        if (!cancelled) setRapidStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requireRapidConfirm]);

  const showRapidGate = requireRapidConfirm && !confirmedDevAccess;
  const targetRapidUrl = resolvedRapidUrl || rapidRedirectUrl;

  return (
    <main className={styles.page}>
      <section className={`${styles.card} ${showRapidGate ? styles.cardRapid : ''}`} aria-labelledby="welcome-title">
        <header className={styles.header}>
          <img src={withAppBase('/askFDALabel_hero.png')} alt="AskFDALabel" className={styles.logo} />
          <h1 id="welcome-title">Welcome to AskFDALabel</h1>
          <p>
            {showRapidGate
              ? 'You have reached the non-RAPID development server. Please use the RAPID production portal for standard access.'
              : 'Sign in with your institutional account to explore FDA labeling and your workspace.'}
          </p>
        </header>

        {showRapidGate ? (
          <>
            <aside className={`${styles.notice} ${styles.noticeRapid}`} aria-labelledby="rapid-notice-title">
              <div className={styles.noticeHeader}>
                <span className={`${styles.noticeLabel} ${styles.noticeLabelRapid}`}>PRODUCTION REDIRECT</span>
                {rapidStatus === 'checking' && (
                  <span className={styles.checkingBadge}>Checking RAPID availability…</span>
                )}
                {rapidStatus === 'unavailable' && (
                  <span className={styles.notAvailableBadge} role="status">
                    Not available Now
                  </span>
                )}
              </div>
              <h2 id="rapid-notice-title">Please Visit the RAPID Server</h2>
              <p>
                This host is a non-RAPID development server running in production mode. For regular
                institutional use, please continue to the RAPID deployment.
              </p>
            </aside>

            <div className={styles.primary}>
              {rapidStatus === 'available' && targetRapidUrl ? (
                <>
                  <a href={targetRapidUrl} className={`${styles.ssoButton} ${styles.rapidButton}`}>
                    Go to RAPID Server
                    <span aria-hidden="true">→</span>
                  </a>
                  <p className={styles.primaryHint}>{targetRapidUrl}</p>
                </>
              ) : (
                <>
                  <button type="button" disabled className={styles.ssoButtonDisabled}>
                    {rapidStatus === 'checking' ? 'Checking RAPID Server…' : 'Go to RAPID Server'}
                  </button>
                  <p className={styles.primaryHint}>
                    {rapidStatus === 'checking'
                      ? 'Verifying RAPID server availability…'
                      : targetRapidUrl
                        ? `RAPID server (${targetRapidUrl}) is currently unreachable.`
                        : 'RAPID redirect URL is not configured (RAPID_REDIRECT_URL).'}
                  </p>
                </>
              )}
            </div>

            <div className={styles.alternatives}>
              <p className={styles.alternativesLabel}>
                Need to test or maintain this non-RAPID development server?
              </p>
              <div className={styles.alternativeLinks}>
                <button type="button" onClick={() => setConfirmedDevAccess(true)}>
                  I confirm I want to access the non-RAPID development server (SSO) →
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <aside className={styles.notice} aria-labelledby="sso-notice-title">
              <span className={styles.noticeLabel}>SINGLE SIGN-ON (SSO)</span>
              <h2 id="sso-notice-title">Single Sign-On Authentication</h2>
              <p>
                AskFDALabel now uses Single Sign-On (SSO) as the primary authentication method.
                Please sign in below using your institutional credentials. Guest access and self-registration
                are disabled. If you require access or assistance, please contact your system administrator.
              </p>
            </aside>

            <div className={styles.primary}>
              {ssoEnabled ? (
                <>
                  <a href="/api/dashboard/auth/saml/login" className={styles.ssoButton}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
                      <path d="m8.5 12 2.5 2.5 4.5-5" />
                    </svg>
                    Sign in with SSO
                    <span aria-hidden="true">→</span>
                  </a>
                  <p className={styles.primaryHint}>Sign in with your institutional credentials</p>
                </>
              ) : (
                <p className={styles.unavailable}>Single Sign-On is not configured on this deployment. Please contact an administrator.</p>
              )}
            </div>

            {requireRapidConfirm && (
              <div className={styles.alternatives}>
                <div className={styles.alternativeLinks}>
                  <button type="button" onClick={() => setConfirmedDevAccess(false)}>
                    ← Back to RAPID redirect notice
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <p className={styles.disclaimer}>
          <strong>FDA internal system · Authorized use only.</strong>{' '}
          Content may be subject to internal FDA policies. This tool is under development and subject to change.
        </p>
      </section>

      <footer className={styles.footer}>
        <p>AskFDALabel &copy; 2026 · FDA/NCTR. An ongoing research effort, not yet for official use.</p>
        <p>For more information, contact <a href="mailto:Leihong.wu@fda.hhs.gov">Leihong.wu@fda.hhs.gov</a>.</p>
      </footer>
    </main>
  );
}
