'use client';

/*
 * The tool directory.
 *
 * Rendered entirely from the registry — adding a tool, or flipping one from
 * embedded to external, needs no change here.
 *
 * This is secondary navigation. The primary way into the platform is
 * context-first: pick a label or task, then launch a tool against it.
 */

import { useMemo } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Page, PageBody, SectionHeader } from '../platform/primitives';
import { ToolLauncher } from '../platform/ToolLauncher';
import type { LaunchContext } from '../platform/context';

export default function ToolsPage() {
  // No label or project selected — tools requiring context are filtered out.
  const context = useMemo<LaunchContext>(() => ({}), []);

  return (
    <Page>
      <Header />
      <PageBody>
        <SectionHeader
          as="h1"
          title="Tools"
          description="Every labeling-analysis tool available in this deployment. Tools that need a specific label appear once you open one."
        />
        <ToolLauncher context={context} grouped aria-label="All tools" />
      </PageBody>
      <Footer />
    </Page>
  );
}
