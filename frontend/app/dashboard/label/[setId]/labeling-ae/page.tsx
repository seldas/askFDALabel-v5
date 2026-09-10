'use client';

/*
 * LabelingAE (beta) tool route — Server-based safety annotation visualization.
 */

import LabelingAeView from './LabelingAeView';
import { useLabel } from '../LabelContext';

export default function LabelingAeToolPage() {
  const { setId, splId, loading, data } = useLabel();

  if (loading || !data) return null;

  return <LabelingAeView setId={setId} splId={splId} labelMeta={data} />;
}
