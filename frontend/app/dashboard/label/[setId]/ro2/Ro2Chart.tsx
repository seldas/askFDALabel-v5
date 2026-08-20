'use client';

/*
 * The Rule-of-Two quadrant plot.
 *
 * Split from the route so the chart can be rendered against fixed data
 * independently of the label fetch and the dose extraction behind it.
 *
 * The x-axis is logarithmic by necessity, not taste: the reference doses span
 * 0.5 mg (digoxin) to 4000 mg (valproate-class), so a linear axis collapses
 * two thirds of the set onto the origin.
 */

import {
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

export interface ReferencePoint {
  drug_name: string;
  dili_concern: string | null;
  dili_severity_class?: string | null;
  max_daily_dose_mg: number;
  alogp: number;
  alogp_method?: string | null;
  dose_basis: string | null;
  dose_note: string | null;
  dose_review_status?: string | null;
}

export interface QueryPoint {
  drug_name: string;
  max_daily_dose_mg: number;
  alogp: number;
  dose_basis: string | null;
}

export interface Thresholds {
  max_daily_dose_mg: number;
  alogp: number;
}

/* DILIrank concern classes. Red reads as hazard, which is the intent. */
export const CONCERN_COLORS: Record<string, string> = {
  'vMost-DILI-concern': '#dc2626',
  'vLess-DILI-concern': '#f59e0b',
  'vNo-DILI-concern': '#16a34a',
};
export const CONCERN_LABELS: Record<string, string> = {
  'vMost-DILI-concern': 'Most DILI concern',
  'vLess-DILI-concern': 'Less DILI concern',
  'vNo-DILI-concern': 'No DILI concern',
};
const UNKNOWN_CONCERN = '#94a3b8';
const QUERY_COLOR = '#1d4ed8';

/* Fixed decade ticks: a log axis auto-ticked by recharts reads terribly. */
const TICKS = [0.1, 1, 10, 100, 1000, 10000];
const X_DOMAIN: [number, number] = [0.1, 10000];
const Y_DOMAIN: [number, number] = [-4, 10];

export default function Ro2Chart({
  reference,
  thresholds,
  query,
  alogpGuide,
  height = 520,
}: {
  reference: ReferencePoint[];
  thresholds: Thresholds;
  query?: QueryPoint | null;
  /**
   * The drug's own ALogP, drawn as a horizontal guide.
   *
   * Lands well before the dose does, so the chart shows real progress on the
   * y-axis while the LLM is still reading the label -- the drug is somewhere
   * on this line, and the dose decides where.
   */
  alogpGuide?: number | null;
  height?: number;
}) {
  const grouped: Record<string, ReferencePoint[]> = {};
  for (const point of reference) {
    const key = point.dili_concern || 'unknown';
    (grouped[key] ||= []).push(point);
  }

  return (
    <>
      <div style={{ height: `${height}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 28, bottom: 52, left: 12 }}>
            {/* The quadrant the rule identifies: high dose AND lipophilic. */}
            <ReferenceArea
              x1={thresholds.max_daily_dose_mg}
              x2={X_DOMAIN[1]}
              y1={thresholds.alogp}
              y2={Y_DOMAIN[1]}
              fill={CONCERN_COLORS['vMost-DILI-concern']}
              fillOpacity={0.07}
              ifOverflow="extendDomain"
            />
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="max_daily_dose_mg"
              scale="log"
              domain={X_DOMAIN}
              allowDataOverflow
              ticks={TICKS}
              tickFormatter={(v: number) => (v >= 1 ? String(v) : String(v))}
              stroke="#64748b"
              fontSize={12}
              label={{
                value: 'Maximum daily dose (mg, log scale)',
                position: 'insideBottom',
                offset: -14,
                fill: '#475569',
                fontSize: 13,
              }}
            />
            <YAxis
              type="number"
              dataKey="alogp"
              domain={Y_DOMAIN}
              stroke="#64748b"
              fontSize={12}
              label={{ value: 'ALogP', angle: -90, position: 'insideLeft', fill: '#475569', fontSize: 13 }}
            />
            <ZAxis range={[70, 70]} />
            <ReferenceLine
              x={thresholds.max_daily_dose_mg}
              stroke={CONCERN_COLORS['vMost-DILI-concern']}
              strokeDasharray="5 4"
            />
            <ReferenceLine
              y={thresholds.alogp}
              stroke={CONCERN_COLORS['vMost-DILI-concern']}
              strokeDasharray="5 4"
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as ReferencePoint & { isQuery?: boolean };
                return (
                  <div style={{
                    background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px',
                    padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxWidth: '280px',
                  }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                      {p.drug_name}{p.isQuery ? ' (this label)' : ''}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                      <div>{p.max_daily_dose_mg} mg/day · ALogP {p.alogp}</div>
                      {p.dili_concern && <div>{CONCERN_LABELS[p.dili_concern] ?? p.dili_concern}</div>}
                      {p.dose_basis && <div style={{ color: '#64748b' }}>Dose basis: {p.dose_basis}</div>}
                      {p.dose_note && <div style={{ color: '#64748b', fontStyle: 'italic' }}>{p.dose_note}</div>}
                    </div>
                  </div>
                );
              }}
            />

            {Object.entries(grouped).map(([concern, points]) => (
              <Scatter key={concern} name={CONCERN_LABELS[concern] ?? concern} data={points} fillOpacity={0.72}>
                {points.map((point) => (
                  <Cell key={point.drug_name} fill={CONCERN_COLORS[concern] ?? UNKNOWN_CONCERN} />
                ))}
              </Scatter>
            ))}

            {alogpGuide != null && !query && (
              <ReferenceLine
                y={alogpGuide}
                stroke={QUERY_COLOR}
                strokeDasharray="2 3"
                label={{
                  value: `this drug — ALogP ${alogpGuide}`,
                  fill: QUERY_COLOR,
                  fontSize: 11,
                  position: 'insideBottomRight',
                }}
              />
            )}

            {query && (
              <Scatter
                name={query.drug_name}
                data={[{ ...query, isQuery: true, dili_concern: null, dose_note: null }]}
                shape="star"
                fill={QUERY_COLOR}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div style={{
        display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '10px',
        fontSize: '0.82rem', color: '#475569',
      }}>
        {Object.entries(CONCERN_LABELS).map(([key, label]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: CONCERN_COLORS[key] }} />
            {label}
          </span>
        ))}
        {query && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: QUERY_COLOR, fontSize: '1rem' }}>★</span>
            {query.drug_name}
          </span>
        )}
      </div>
    </>
  );
}
