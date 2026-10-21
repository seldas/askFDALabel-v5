'use client';

/*
 * LabelingAE (beta) tool route — Server-based safety annotation visualization.
 */

import LabelingAeView from './LabelingAeView';
import { useLabel } from '../LabelContext';
import { useCapabilities } from '../../../../platform/capabilities';
import { ServiceWarning } from '../../../../platform/ServiceWarning';

export default function LabelingAeToolPage() {
  const { setId, splId, loading, data } = useLabel();
  const { capabilities, ready } = useCapabilities();

  if (!ready) return <p>Checking deployment availability…</p>;
  if (capabilities.isRapid) return <ServiceWarning toolId="label-labeling-ae" />;

  if (loading || !data) return null;

  return <LabelingAeView setId={setId} splId={splId} labelMeta={data} />;
}
