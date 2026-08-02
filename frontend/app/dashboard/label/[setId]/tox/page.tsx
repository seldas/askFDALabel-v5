'use client';

/*
 * DrugTox tool route.
 *
 * There has never been an in-page DrugTox view — the old tab simply did a
 * window.location.href to /drugtox/[setId], which is a standalone page with its
 * own duplicated shell. This route preserves that destination while making the
 * tool addressable under the label workspace like every other one.
 *
 * Folding that page's body into this route (so it renders inside the shell
 * instead of navigating away) is a separate extraction, tracked as follow-up.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLabel } from '../LabelContext';

export default function ToxToolPage() {
  const { setId } = useLabel();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/drugtox/${setId}`);
  }, [router, setId]);

  return (
    <p style={{ color: 'var(--afl-text-secondary)', fontSize: 'var(--afl-text-sm)' }}>
      Opening askDrugTox…
    </p>
  );
}
