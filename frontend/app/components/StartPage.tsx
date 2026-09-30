'use client';

import { withAppBase } from '../utils/appPaths';
import styles from './StartPage.module.css';

interface StartPageProps {
  onLogin: () => void;
  onSignUp: () => void;
  onGuest: () => void;
  ssoEnabled: boolean;
}

export default function StartPage({ onLogin, onSignUp, onGuest, ssoEnabled }: StartPageProps) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="welcome-title">
        <header className={styles.header}>
          <img src={withAppBase('/askFDALabel_hero.png')} alt="AskFDALabel" className={styles.logo} />
          <h1 id="welcome-title">Welcome to AskFDALabel</h1>
          <p>Sign in to explore FDA labeling and your workspace.</p>
        </header>

        <aside className={styles.notice} aria-labelledby="sso-notice-title">
          <span className={styles.noticeLabel}>LOGIN UPDATE</span>
          <h2 id="sso-notice-title">We’re moving to Single Sign-On</h2>
          <p>
            We are implementing Single Sign-On (SSO). Please use SSO as your primary
            login method. Account password login and guest access will be disabled
            in the future.
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
              <p className={styles.primaryHint}>Recommended login method</p>
            </>
          ) : (
            <p className={styles.unavailable}>SSO is not available on this deployment yet. Use an option below to sign in.</p>
          )}
        </div>

        <div className={styles.alternatives}>
          <p className={styles.alternativesLabel}>Other ways to access AskFDALabel</p>
          <div className={styles.alternativeLinks}>
            <button type="button" onClick={onLogin}>Account login</button>
            <button type="button" onClick={onGuest}>Continue as guest</button>
            <button type="button" onClick={onSignUp}>Sign up</button>
          </div>
        </div>

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
