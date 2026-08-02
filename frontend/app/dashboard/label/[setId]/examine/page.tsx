'use client';

/*
 * Examine tool route. Pure React — needs none of the legacy bundles.
 */

import ExamineView from '../examine';
import { TOOL_EXAMINE, useLabel } from '../LabelContext';

export default function ExamineToolPage() {
  const { data, setId, loading } = useLabel();

  if (loading || !data) return null;

  return (
    <ExamineView
      activeTab={TOOL_EXAMINE}
      setId={setId}
      productData={data.product_data ?? []}
    />
  );
}
