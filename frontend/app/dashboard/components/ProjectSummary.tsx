'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import styles from './ProjectSummary.module.css';
import { useCumulativeChart } from './useCumulativeChart';

export type DocumentTypeBuckets = {
  human_rx: number;
  human_otc: number;
  vaccine: number;
  animal_rx: number;
  animal_otc: number;
  other: number;
  unknown: number;
};

export type CumulativePoint = {
  date: string; // "YYYY-MM-DD"
  cumulative_count: number;
};

export type IngredientBreakdown = {
  query: string;
  active_count: number;
  inactive_count: number;
  both_count: number;
  not_found_count: number;
  note?: string;
};

export type ProjectStats = {
  success?: boolean;
  project_id: number;
  total_labels: number;
  unique_manufacturers: number;
  unique_brands: number;
  date_min?: string | null;
  date_max?: string | null;

  document_type?: {
    raw?: Record<string, number>;
    buckets?: Partial<DocumentTypeBuckets>;
    note?: string;
  };

  cumulative_by_effective_time?: CumulativePoint[];

  top_manufacturers?: Array<{ name: string; count: number }>;
  top_ingredients?: IngredientBreakdown[];
};

type Props = {
  open: boolean;
  onClose: () => void;

  projectTitle: string;
  projectRole: string;

  loading: boolean;
  error: string | null;
  stats: ProjectStats | null;

  // pass your existing formatter (same one used in table)
  formatEffectiveTime: (s?: string) => string;

  // where your chart.js is hosted (default assumes Next public/)
  chartSrc?: string;
};

function safeISOToMs(s?: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export default function ProjectSummary({
  open,
  onClose,
  projectTitle,
  projectRole,
  loading,
  error,
  stats,
  formatEffectiveTime,
  chartSrc = '/dashboard/js/chart.js',
}: Props) {
  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const buckets = useMemo<DocumentTypeBuckets>(() => {
    const b = stats?.document_type?.buckets || {};
    return {
      human_rx: b.human_rx ?? 0,
      human_otc: b.human_otc ?? 0,
      vaccine: b.vaccine ?? 0,
      animal_rx: b.animal_rx ?? 0,
      animal_otc: b.animal_otc ?? 0,
      other: b.other ?? 0,
      unknown: b.unknown ?? 0,
    };
  }, [stats]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task summary"
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon} aria-hidden>
              📑
            </div>

            <div className={styles.headerText}>
              <div className={styles.title} title={projectTitle}>
                Task Summary Report — {projectTitle}
              </div>
              <div className={styles.subtitle}>
                Task • {projectRole}
                <span className={styles.dot}>•</span>
                Generated from curated label set
              </div>
            </div>
          </div>

          <button className={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loadingRow}>
              <div className="loader" />
              <div className={styles.loadingText}>Computing task statistics…</div>
            </div>
          ) : error ? (
            <div className={styles.errorBox}>{error}</div>
          ) : (
            <>
              {/* Summary label */}
              <div className={styles.sectionIntro}>
                <div className={styles.sectionKicker}>Summary</div>
                <div className={styles.sectionHeadline}>Cohort characteristics and label-type distribution</div>
              </div>

              {/* KPI row */}
              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Total labels (N)</div>
                  <div className={styles.kpiValue}>{stats?.total_labels ?? '—'}</div>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Unique manufacturers</div>
                  <div className={styles.kpiValue}>{stats?.unique_manufacturers ?? '—'}</div>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Unique brands</div>
                  <div className={styles.kpiValue}>{stats?.unique_brands ?? '—'}</div>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Effective time window</div>
                  <div className={styles.kpiSubValue}>
                    {stats?.date_min ? formatEffectiveTime(stats.date_min) : '—'}
                    <span className={styles.to}>to</span>
                    {stats?.date_max ? formatEffectiveTime(stats.date_max) : '—'}
                  </div>
                </div>
              </div>

              {/* Document type buckets */}
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <div className={styles.panelKicker}>Label type distribution</div>
                    <div className={styles.panelTitle}>Market census by regulatory category</div>
                  </div>

                  {stats?.document_type?.note ? (
                    <div className={styles.limitedBadge} title={stats.document_type.note}>
                      Limited
                    </div>
                  ) : null}
                </div>

                <div className={styles.panelBody}>
                  <div className={styles.bucketGrid}>
                    {[
                      ['Human Rx', buckets.human_rx],
                      ['Human OTC', buckets.human_otc],
                      ['Vaccine', buckets.vaccine],
                      ['Animal Rx', buckets.animal_rx],
                      ['Animal OTC', buckets.animal_otc],
                      ['Others', buckets.other + buckets.unknown],
                    ].map(([label, val]) => (
                      <div key={String(label)} className={styles.bucketCard}>
                        <div className={styles.bucketLabel}>{String(label)}</div>
                        <div className={styles.bucketValue}>{String(val ?? 0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top manufacturers */}
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <div className={styles.panelKicker}>Industry concentration</div>
                    <div className={styles.panelTitle}>Top manufacturers in task</div>
                  </div>
                </div>

                <div className={styles.panelBody}>
                  {stats?.top_manufacturers && stats.top_manufacturers.length > 0 ? (
                    (() => {
                      const top = stats.top_manufacturers.slice(0, 10);
                      const top3 = top.slice(0, 3);
                      const rest = top.slice(3);

                      const getInitials = (name: string) => {
                        const s = (name || '').trim();
                        if (!s) return '—';
                        const tokens = s.split(/\s+/).filter(Boolean);
                        // Prefer letters from first 2 tokens; fallback to first 2 chars
                        const initials =
                          tokens.length >= 2
                            ? (tokens[0][0] + tokens[1][0])
                            : tokens[0].slice(0, 2);
                        return initials.toUpperCase();
                      };

                      return (
                        <>
                          {/* Top 3 detailed */}
                          <div className={styles.rankList}>
                            {top3.map((m, idx) => (
                              <div key={`${m.name}-${idx}`} className={styles.rankRow}>
                                <div className={styles.rankLeft}>
                                  <div className={styles.rankBadge}>{idx + 1}</div>
                                  <div className={styles.rankName} title={m.name}>
                                    {m.name}
                                  </div>
                                </div>
                                <div className={styles.rankCount}>{m.count}</div>
                              </div>
                            ))}
                          </div>

                          {/* Remaining top 10 as compact badges */}
                          {rest.length > 0 && (
                            <div className={styles.badgeBlock}>
                              <div className={styles.badgeLines}>
                                {rest.map((m, j) => {
                                  const rank = j + 4;
                                  const initials = getInitials(m.name);
                                  const tip = `#${rank} — ${m.name} (${m.count})`;

                                  return (
                                    <span
                                      key={`${m.name}-badge-${rank}`}
                                      className={styles.miniBadge}
                                      title={tip}
                                      aria-label={tip}
                                    >
                                      <span className={styles.miniBadgeRank}>#{rank}</span>
                                      <span className={styles.miniBadgeInitials}>{initials}</span>
                                    </span>
                                  );
                                })}
                              </div>

                              <div className={styles.badgeHint}>
                                Hover badges to view full manufacturer name and count.
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <div className={styles.emptyState}>No manufacturer ranking available.</div>
                  )}
                </div>
              </div>

              <div className={styles.footerHint}>Tip: click outside this window (or press ESC) to close.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
