'use client';

/*
 * Page-level gate for a feature-gated module.
 *
 * The tool registry already hides these from navigation for an account that
 * lacks the feature, and the blueprint behind each one returns 403
 * independently — this is what someone gets if they reach the page by URL, so
 * they see an explanation rather than an app shell that fails every request.
 *
 * The verdict comes from the session's `permissions` map, which an admin can
 * change at runtime from the management panel. UserContext re-fetches the
 * session on focus and on an interval, so a page open at the moment of a
 * change corrects itself without a reload.
 */

import Header from './Header';
import Footer from './Footer';
import AccessRestricted from './AccessRestricted';
import { useUser } from '../context/UserContext';
import type { ActiveApp } from './Header';

export default function RequireFeature({
  feature,
  featureKey,
  activeApp,
  children,
}: {
  /** Tool name, used in the refusal heading. */
  feature: string;
  /** Feature-gate key, matching the backend catalog. */
  featureKey: string;
  activeApp?: ActiveApp;
  children: React.ReactNode;
}) {
  const { session, loading } = useUser();

  // Render nothing decisive until the session resolves, or an authorized user
  // sees the refusal flash before their access is known.
  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Verifying access...</div>;
  }

  if (!session?.permissions?.[featureKey]) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Header activeApp={activeApp} />
        <AccessRestricted
          feature={feature}
          title={`${feature} is not available for your account`}
          body={
            `Your account does not currently have access to ${feature.toLowerCase()}. ` +
            'An administrator can grant it from the Function Control panel.'
          }
        />
        <Footer />
      </div>
    );
  }

  return <>{children}</>;
}
