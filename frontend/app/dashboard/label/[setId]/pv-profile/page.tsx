'use client';

/*
 * PV-Profile tool route — SIDER 4.1-style Adverse Event & Safety Profile with Section Severity Heatmap.
 */

import PvProfileView from './PvProfileView';
import { useLabel } from '../LabelContext';

export default function PvProfileToolPage() {
  const { setId, splId, loading, data } = useLabel();

  if (loading || !data) return null;

  return <PvProfileView setId={setId} splId={splId} />;
}
