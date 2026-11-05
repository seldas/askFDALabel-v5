'use client';

/*
 * Deep Dive tool route — pharmacologic-class peer comparison.
 *
 * This view was previously unreachable: its tab was commented out of the tab
 * array, so the component was mounted but permanently hidden. Giving it a
 * route re-enables it. It depends on labeling.epc_map, which db_05 populates.
 */

import DeepDiveView from '../deepdive';
import { TOOL_DEEPDIVE, useLabel } from '../LabelContext';

export default function DeepDiveToolPage() {
  const { setId, loading, data } = useLabel();

  if (loading || !data) return null;

  return <DeepDiveView activeTab={TOOL_DEEPDIVE} setId={setId} />;
}
