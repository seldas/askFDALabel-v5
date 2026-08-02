'use client';

/*
 * FAERS tool route. The shell (../layout.tsx) supplies the label; this only
 * mounts the view and the scripts FAERS actually needs — previously every tool
 * loaded all nine legacy bundles because they were all mounted at once.
 */

import FaersView from '../faers';
import LegacyBridge from '../LegacyBridge';
import { TOOL_FAERS, useLabel } from '../LabelContext';

export default function FaersToolPage() {
  const { data, setId, loading } = useLabel();

  if (loading || !data) return null;

  return (
    <>
      <LegacyBridge
        resetKey={setId}
        scripts={['chart', 'marked', 'utils', 'faers']}
        globals={{
          currentSetId: data.set_id,
          currentDrugName: data.faers_drug_name,
          currentGenericName: data.generic_name,
          currentManufacturer: data.manufacturer_name,
          currentEffectiveTime: data.effective_time,
        }}
        init={['initFaers']}
        onReady={() => {
          const win = window as any;
          if (win.loadFaersData) win.loadFaersData();
        }}
      />
      <FaersView
        activeTab={TOOL_FAERS}
        drugName={data.faers_drug_name ?? data.generic_name ?? undefined}
        setId={setId}
      />
    </>
  );
}
