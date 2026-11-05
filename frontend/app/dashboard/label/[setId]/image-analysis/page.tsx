'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLabel } from '../LabelContext';
import { withAppBase } from '../../../../utils/appPaths';
import { imageReviewRoute } from '../../../../platform/context';

/** Preserve bookmarks while all image tasks move into Visual Analysis. */
export default function LegacyImageAnalysisPage() {
  const { setId, splId } = useLabel();
  const params = useSearchParams();
  const image = params.get('image') || undefined;
  useEffect(() => {
    const target = imageReviewRoute({ setIds: [setId], splIds: [splId || ''] }, { mode: 'read', image });
    // Direct location changes do not go through FetchPrefix's navigation patch.
    window.location.replace(withAppBase(target));
  }, [setId, splId, image]);
  return <p>Opening Visual Analysis…</p>;
}
