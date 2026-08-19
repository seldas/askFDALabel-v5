'use client';

/*
 * Gate for the developer-only modules: LabelChat, Web-test and Local Database
 * Search.
 *
 * The tool registry already hides these from the navigation for a plain user
 * (see registry.ts `developerOnly`), and the blueprints behind them return 403
 * independently — this is what someone gets if they reach the page by URL, so
 * they see an explanation rather than an app shell that fails every request.
 */

import Header from './Header';
import Footer from './Footer';
import AccessRestricted from './AccessRestricted';
import { useUser } from '../context/UserContext';
import type { ActiveApp } from './Header';

const DEVELOPER_ONLY_BODY =
  'This tool is available to developer and admin accounts. Ask an administrator ' +
  'to grant your account developer access if you need it.';

export default function RequireDeveloper({
  feature,
  activeApp,
  children,
}: {
  /** Tool name, used in the refusal heading. */
  feature: string;
  activeApp?: ActiveApp;
  children: React.ReactNode;
}) {
  const { session, loading } = useUser();

  // Render nothing decisive until the session resolves, or an authorized user
  // sees the refusal flash before their access is known.
  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Verifying access...</div>;
  }

  if (!session?.has_developer_access) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Header activeApp={activeApp} />
        <AccessRestricted
          feature={feature}
          title={`${feature} requires developer access`}
          body={DEVELOPER_ONLY_BODY}
        />
        <Footer />
      </div>
    );
  }

  return <>{children}</>;
}
