'use client';

/*
 * Rule-of-Two (DILI) tool route.
 *
 * Plots the drug on the dose/lipophilicity quadrant from Chen 2013 against a
 * fixed set of well-characterised reference drugs.
 *
 * Loaded in three parallel requests rather than one, because the stages differ
 * in cost by orders of magnitude: the reference cloud is a DB read, the
 * structure is one PubChem round trip, and the dose is an LLM reading the
 * label. As a single request nothing could paint until the slowest part
 * finished, which read as a hung page. Each stage now lands on its own and the
 * progress strip names whichever one is still running.
 *
 * Two things this view is deliberately loud about:
 *
 *  - The dose is read out of the label by an LLM. It is shown with the
 *    sentence it came from and is editable, because 100 mg/day is a hard
 *    boundary: a misread does not nudge the point, it moves it across the line.
 *  - The reference cloud's own doses are hand-curated and pending SME review
 *    (see backend/database/seed/README.md), so the x-axis is provisional on
 *    both sides. Saying so beats presenting the quadrants as settled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ro2Chart, { type ReferencePoint } from './Ro2Chart';
import { useLabel } from '../LabelContext';

interface Thresholds { max_daily_dose_mg: number; alogp: number }

interface ReferenceStage {
  reference: ReferencePoint[];
  reference_provenance: {
    total_rows: number;
    plotted: number;
    doses_needing_sme_review: number;
    dose_provenance: string;
    citation: string;
  };
  thresholds: Thresholds;
}

interface StructureStage {
  substance_name: string | null;
  unii: string | null;
  smiles: string | null;
  smiles_source: string | null;
  pubchem_cid: string | null;
  alogp: number | null;
  alogp_method: string | null;
  /** True when the label named a salt and logP was computed on the free base. */
  parent_resolved: boolean;
  salt_cid: string | null;
  /** True when a mixture had to be split locally — lower confidence. */
  fragment_taken: boolean;
  route: string | null;
  ingredients: { substance_name: string; unii: string | null }[];
  reasons: string[];
  warnings: string[];
}

interface DoseStage {
  max_daily_dose_mg: number | null;
  dose_basis: string | null;
  dosing_interval: string | null;
  dose_quote: string | null;
  dose_note: string | null;
  dose_confidence: string | null;
  dose_source: string | null;
  dosage_section_present: boolean;
  reasons: string[];
}

type Status = 'pending' | 'done' | 'error';

const CARD: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '16px',
  padding: '20px 24px',
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
  marginBottom: '20px',
};

function Pill({ tone, children }: { tone: 'danger' | 'ok' | 'muted'; children: React.ReactNode }) {
  const tones = {
    danger: { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' },
    ok: { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' },
    muted: { bg: '#f8fafc', fg: '#475569', bd: '#e2e8f0' },
  }[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: '999px',
      background: tones.bg, color: tones.fg, border: `1px solid ${tones.bd}`,
      fontSize: '0.78rem', fontWeight: 700,
    }}>
      {children}
    </span>
  );
}

/*
 * One row of the progress strip. A stage still running names itself and shows
 * elapsed seconds, so a slow LLM looks slow rather than broken.
 */
function StageRow({
  status, label, detail, seconds,
}: { status: Status; label: string; detail?: string; seconds?: number }) {
  const icon = status === 'done' ? '✓' : status === 'error' ? '✕' : '⋯';
  const color = status === 'done' ? '#15803d' : status === 'error' ? '#b91c1c' : '#0284c7';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', fontSize: '0.86rem', padding: '3px 0' }}>
      <span style={{ color, fontWeight: 800, width: '16px', display: 'inline-block', textAlign: 'center' }}>
        {icon}
      </span>
      <span style={{
        color: status === 'pending' ? '#0f172a' : '#475569',
        fontWeight: status === 'pending' ? 700 : 500,
      }}>
        {label}
      </span>
      {detail && <span style={{ color: '#64748b' }}>{detail}</span>}
      {status === 'pending' && seconds != null && seconds >= 2 && (
        <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{seconds}s</span>
      )}
    </div>
  );
}

export default function Ro2ToolPage() {
  const { setId, data, loading: labelLoading } = useLabel();

  const [refStage, setRefStage] = useState<ReferenceStage | null>(null);
  const [refStatus, setRefStatus] = useState<Status>('pending');
  const [structure, setStructure] = useState<StructureStage | null>(null);
  const [structureStatus, setStructureStatus] = useState<Status>('pending');
  const [dose, setDose] = useState<DoseStage | null>(null);
  const [doseStatus, setDoseStatus] = useState<Status>('pending');
  const [errors, setErrors] = useState<string[]>([]);

  /* Manual override. Null means "use whatever the extraction returned". */
  const [doseOverride, setDoseOverride] = useState<number | null>(null);
  const [doseDraft, setDoseDraft] = useState('');

  /* Drives the elapsed-seconds readout on whichever stage is still running. */
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    setRefStage(null); setRefStatus('pending');
    setStructure(null); setStructureStatus('pending');
    setDose(null); setDoseStatus('pending');
    setErrors([]); setDoseOverride(null); setDoseDraft('');
    startedAt.current = Date.now();
    setElapsed(0);

    const get = async (url: string) => {
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      return body;
    };

    const fail = (what: string, err: unknown) => {
      if (cancelled) return;
      setErrors((prev) => [...prev, `${what}: ${err instanceof Error ? err.message : String(err)}`]);
    };

    const base = `/api/dashboard/ro2/${encodeURIComponent(setId)}`;

    /*
     * All three in flight at once. The dose does not depend on the structure --
     * they read different parts of the label -- so serialising them would add
     * the PubChem latency to the slowest path for no benefit.
     */
    get('/api/dashboard/ro2/reference')
      .then((body) => { if (!cancelled) { setRefStage(body); setRefStatus('done'); } })
      .catch((err) => { fail('Reference set', err); if (!cancelled) setRefStatus('error'); });

    get(`${base}/structure`)
      .then((body) => { if (!cancelled) { setStructure(body); setStructureStatus('done'); } })
      .catch((err) => { fail('Structure', err); if (!cancelled) setStructureStatus('error'); });

    get(`${base}/dose`)
      .then((body: DoseStage) => {
        if (cancelled) return;
        setDose(body);
        setDoseStatus('done');
        if (body.max_daily_dose_mg != null) setDoseDraft(String(body.max_daily_dose_mg));
      })
      .catch((err) => { fail('Dose extraction', err); if (!cancelled) setDoseStatus('error'); });

    return () => { cancelled = true; };
  }, [setId]);

  const anyPending =
    refStatus === 'pending' || structureStatus === 'pending' || doseStatus === 'pending';

  /* Tick only while something is outstanding. */
  useEffect(() => {
    if (!anyPending) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [anyPending]);

  const thresholds = refStage?.thresholds;
  const effectiveDose = doseOverride ?? dose?.max_daily_dose_mg ?? null;
  const alogp = structure?.alogp ?? null;

  /*
   * Re-scored client-side while typing, against the thresholds the server
   * exported — the same numbers ro2_service.score() applies, so the live
   * verdict and a re-fetched one cannot disagree.
   */
  const verdict = useMemo(() => {
    if (effectiveDose == null || alogp == null || !thresholds) return null;
    const highDose = effectiveDose >= thresholds.max_daily_dose_mg;
    const lipophilic = alogp >= thresholds.alogp;
    return { highDose, lipophilic, fires: highDose && lipophilic };
  }, [effectiveDose, alogp, thresholds]);

  const applyDose = useCallback(() => {
    const parsed = Number(doseDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setDoseOverride(parsed);
  }, [doseDraft]);

  const resetDose = useCallback(() => {
    setDoseOverride(null);
    setDoseDraft(dose?.max_daily_dose_mg != null ? String(dose.max_daily_dose_mg) : '');
  }, [dose]);

  const reasons = useMemo(
    () => [...(structure?.reasons ?? []), ...(dose?.reasons ?? [])],
    [structure, dose],
  );
  const warnings = structure?.warnings ?? [];

  if (labelLoading || !data) return null;

  const brand = data.brand_name || data.drug_name || structure?.substance_name || 'this product';

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={CARD}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
          Rule of Two — DILI risk quadrant
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>
          An oral drug taken at <strong>≥ {thresholds?.max_daily_dose_mg ?? 100} mg/day</strong> whose{' '}
          <strong>ALogP ≥ {thresholds?.alogp ?? 3}</strong> carries significantly elevated risk of
          drug-induced liver injury. Both conditions must hold. <strong>{brand}</strong> is plotted
          against the reference set below.
        </p>
      </div>

      {anyPending && (
        <div style={{ ...CARD, paddingTop: '16px', paddingBottom: '16px' }}>
          <StageRow
            status={refStatus}
            label="Reference drugs"
            detail={refStage ? `${refStage.reference_provenance.plotted} plotted` : undefined}
            seconds={elapsed}
          />
          <StageRow
            status={structureStatus}
            label="Structure and lipophilicity"
            detail={
              structure?.alogp != null
                ? `ALogP ${structure.alogp}`
                : structureStatus === 'pending' ? 'looking up PubChem…' : undefined
            }
            seconds={elapsed}
          />
          <StageRow
            status={doseStatus}
            label="Maximum daily dose"
            detail={
              dose?.max_daily_dose_mg != null
                ? `${dose.max_daily_dose_mg} mg/day`
                : doseStatus === 'pending' ? 'reading the label with AI — usually 5–20s' : undefined
            }
            seconds={elapsed}
          />
        </div>
      )}

      {errors.map((message) => (
        <div key={message} style={{ ...CARD, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}>
          {message}
        </div>
      ))}

      {!anyPending && reasons.length > 0 && (
        <div style={{ ...CARD, background: '#fffbeb', borderColor: '#fde68a' }}>
          <div style={{ fontWeight: 800, color: '#92400e', marginBottom: '8px' }}>Not scored</div>
          <ul style={{ margin: 0, paddingLeft: '20px', color: '#78350f', fontSize: '0.9rem', lineHeight: 1.6 }}>
            {reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p style={{ margin: '10px 0 0 0', color: '#78350f', fontSize: '0.84rem' }}>
            The reference cloud is still shown below. If you have a defensible maximum daily
            dose, enter it and the point will be plotted.
          </p>
        </div>
      )}

      {warnings.map((warning) => (
        <div key={warning} style={{ ...CARD, background: '#f8fafc', color: '#475569', fontSize: '0.88rem' }}>
          {warning}
        </div>
      ))}

      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>
            {structure?.substance_name || brand}
          </span>
          {verdict && (
            verdict.fires
              ? <Pill tone="danger">Rule of Two: positive</Pill>
              : <Pill tone="ok">Rule of Two: negative</Pill>
          )}
          {verdict && thresholds && (
            <>
              <Pill tone={verdict.highDose ? 'danger' : 'muted'}>
                {effectiveDose} mg/day {verdict.highDose ? '≥' : '<'} {thresholds.max_daily_dose_mg}
              </Pill>
              <Pill tone={verdict.lipophilic ? 'danger' : 'muted'}>
                ALogP {alogp} {verdict.lipophilic ? '≥' : '<'} {thresholds.alogp}
              </Pill>
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              MAXIMUM DAILY DOSE
            </div>
            {doseStatus === 'pending' && (
              <div style={{ color: '#64748b', fontSize: '0.86rem', marginBottom: '4px' }}>
                Reading the label with AI — you can type a dose now rather than wait.
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0' }}>
              <input
                type="number"
                min="0"
                step="any"
                value={doseDraft}
                onChange={(e) => setDoseDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyDose(); }}
                style={{
                  width: '120px', padding: '7px 10px', borderRadius: '8px',
                  border: '1px solid #cbd5e1', fontSize: '0.92rem',
                }}
                aria-label="Maximum daily dose in milligrams"
              />
              <span style={{ color: '#64748b', fontSize: '0.88rem' }}>mg/day</span>
              <button
                type="button"
                onClick={applyDose}
                style={{
                  padding: '7px 14px', borderRadius: '8px', border: '1px solid #2563eb',
                  background: '#2563eb', color: '#ffffff', fontWeight: 700,
                  fontSize: '0.86rem', cursor: 'pointer',
                }}
              >
                Apply
              </button>
              {doseOverride != null && (
                <button
                  type="button"
                  onClick={resetDose}
                  style={{
                    padding: '7px 12px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    background: '#ffffff', color: '#475569', fontWeight: 600,
                    fontSize: '0.86rem', cursor: 'pointer',
                  }}
                >
                  Reset
                </button>
              )}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.55 }}>
              {doseOverride != null ? (
                <span style={{ color: '#0f172a', fontWeight: 600 }}>Entered by you.</span>
              ) : dose?.max_daily_dose_mg != null ? (
                <>
                  Read from the label by AI
                  {dose.dose_basis ? ` (${dose.dose_basis})` : ''}
                  {dose.dose_confidence ? `, ${dose.dose_confidence} confidence` : ''}.
                  {' '}Check it against the quote below.
                </>
              ) : doseStatus === 'done' ? (
                <>No dose could be read from the label. Enter one to plot the point.</>
              ) : null}
              {dose?.dose_note && <div style={{ marginTop: '4px' }}>{dose.dose_note}</div>}
            </div>
            {dose?.dose_quote && (
              <blockquote style={{
                margin: '10px 0 0 0', padding: '8px 12px', borderLeft: '3px solid #cbd5e1',
                background: '#f8fafc', color: '#334155', fontSize: '0.84rem',
                fontStyle: 'italic', lineHeight: 1.5,
              }}>
                “{dose.dose_quote}”
              </blockquote>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
              LIPOPHILICITY
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              {structureStatus === 'pending' ? '…' : alogp ?? '—'}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.55 }}>
              {structure?.alogp_method
                ? <>Computed by <code>{structure.alogp_method}</code>.</>
                : structureStatus === 'done' ? <>Not computed.</> : null}
              {structure?.smiles_source && (
                <> Structure from {structure.smiles_source
                  .replace('pubchem-name-desalted', 'PubChem, matched by name without the salt former')
                  .replace('pubchem-unii+desalted-name', 'PubChem, matched by UNII then the desalted name')
                  .replace('pubchem-name+desalted-name', 'PubChem, matched by name then the desalted name')
                  .replace('pubchem-unii', 'PubChem, matched by UNII')
                  .replace('pubchem-name', 'PubChem, matched by name')}.</>
              )}
              {structure?.unii && <> UNII {structure.unii}.</>}
            </div>
            {structure?.parent_resolved && (
              /*
               * The label names a salt; the reference rows are free bases. Say
               * which structure was actually scored rather than letting the
               * reader assume it was the salt on the label.
               */
              <div style={{
                marginTop: '8px', fontSize: '0.8rem', color: '#0f172a',
                background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: '8px', padding: '7px 10px', lineHeight: 1.5,
              }}>
                The label names a salt. ALogP is computed on the free base
                {structure.pubchem_cid ? <> (PubChem CID {structure.pubchem_cid}</> : null}
                {structure.salt_cid ? <>, from salt CID {structure.salt_cid}</> : null}
                {structure.pubchem_cid ? <>)</> : null}, matching how the reference
                drugs were prepared.
              </div>
            )}
            {structure?.fragment_taken && (
              <div style={{
                marginTop: '8px', fontSize: '0.8rem', color: '#78350f',
                background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: '8px', padding: '7px 10px', lineHeight: 1.5,
              }}>
                PubChem had no free-base record for this salt, so the largest
                component of the mixture was used. Worth checking the structure
                below before relying on this point.
              </div>
            )}
            {structure?.smiles && (
              <div style={{
                marginTop: '8px', fontSize: '0.74rem', color: '#64748b',
                wordBreak: 'break-all', fontFamily: 'monospace',
              }}>
                {structure.smiles}
              </div>
            )}
          </div>
        </div>
      </div>

      {refStage && thresholds ? (
        <div style={CARD}>
          <Ro2Chart
            reference={refStage.reference}
            thresholds={thresholds}
            alogpGuide={alogp}
            query={effectiveDose != null && alogp != null ? {
              drug_name: brand,
              max_daily_dose_mg: effectiveDose,
              alogp,
              dose_basis: doseOverride != null ? 'entered by you' : dose?.dose_basis ?? null,
            } : null}
          />
        </div>
      ) : (
        <div style={{ ...CARD, height: '560px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
          Loading the reference set…
        </div>
      )}

      {refStage && (
        <div style={{ ...CARD, background: '#f8fafc' }}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '8px', fontSize: '0.92rem' }}>
            About this data
          </div>
          <p style={{ margin: '0 0 8px 0', color: '#475569', fontSize: '0.84rem', lineHeight: 1.6 }}>
            DILI classes come from FDA DILIrank 2.0 and structures from PubChem, both
            authoritative. The reference doses are the exception:{' '}
            <strong>{refStage.reference_provenance.doses_needing_sme_review} of{' '}
            {refStage.reference_provenance.total_rows}</strong> are hand-curated from labeling and
            pending SME review, so the horizontal axis is provisional on both sides of the plot.
          </p>
          <p style={{ margin: '0 0 8px 0', color: '#475569', fontSize: '0.84rem', lineHeight: 1.6 }}>
            The reference set is enriched with known hepatotoxicants and is{' '}
            <strong>not a validation set</strong> — do not quote performance statistics from it.
          </p>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem', lineHeight: 1.6 }}>
            {refStage.reference_provenance.citation}
          </p>
        </div>
      )}
    </div>
  );
}
