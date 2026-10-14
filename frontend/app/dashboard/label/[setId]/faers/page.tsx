'use client';

/*
 * FAERS tool route. Directly mounts the modern React/Recharts FaersView component.
 */

import FaersView from '../faers';
import { TOOL_FAERS, useLabel } from '../LabelContext';

export default function FaersToolPage() {
  const { data, setId, loading } = useLabel();

  if (loading || !data) return null;

  return (
    <FaersView
      activeTab={TOOL_FAERS}
      drugName={data.faers_drug_name ?? data.generic_name ?? undefined}
      setId={setId}
    />
  );
}
