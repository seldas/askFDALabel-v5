'use client';

/*
 * FDALabel's results table: a Links column, then Basic or Expanded columns.
 *
 * "View Label" is the one internal link — it opens the label in this app's own
 * workspace. Everything else in the Links cell leaves for the authoritative
 * source (DailyMed, Drugs@FDA, the Orange Book), keyed off the identifiers the
 * label already carries.
 */

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { labelRoute } from '../platform/context';

export interface LabelRow {
  set_id: string;
  spl_id: string;
  product_names: string | null;
  generic_names: string | null;
  manufacturer: string | null;
  appr_num: string | null;
  ndc_codes: string | null;
  revised_date: string | null;
  market_categories: string | null;
  doc_type: string | null;
  active_ingredients: string | null;
  dosage_forms: string | null;
  routes: string | null;
  epc: string | null;
  is_rld: number | null;
  is_rs: number | null;
  initial_approval_year: number | null;
  /** Active-ingredient UNIIs, "; "-joined. Null when the label declares none. */
  active_uniis: string | null;
}

export interface ResultSet {
  results: LabelRow[];
  /** Exact number of matching labels, however large. */
  total: number;
  /** How many of `total` can be paged through — min(total, cap). */
  browsable: number;
  cap: number;
  /** True when `total` exceeds `cap`, i.e. only the most recent are browsable. */
  capped: boolean;
  limit: number;
  offset: number;
  warnings: string[];
}

export type ResultView = 'basic' | 'expanded';

export interface SortState {
  sort: string;
  dir: 'asc' | 'desc';
}

const DAILYMED_SPL = (setId: string) =>
  `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(setId)}`;
const DAILYMED_PDF = (setId: string) =>
  `https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid=${encodeURIComponent(setId)}`;
const DRUGS_AT_FDA = (n: string) =>
  `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${n}`;
const ORANGE_BOOK = (kind: string, n: string) =>
  `https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm?Appl_Type=${kind}&Appl_No=${n}`;

/** "; "-joined storage -> a readable cell. */
function joined(value: string | null | undefined) {
  if (!value) return '';
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Splits "NDA 021436; ANDA 077844" into the parts the external registries need.
 * Both take a bare number, and the Orange Book additionally wants N or A.
 */
function applications(apprNum: string | null | undefined) {
  if (!apprNum) return [];
  const seen = new Set<string>();
  const out: Array<{ kind: string; number: string; obType: string | null }> = [];
  for (const part of apprNum.split(';')) {
    const m = part.trim().match(/^(ANADA|ANDA|NADA|BLA|NDA)\s*([0-9]+)$/i);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const number = m[2];
    if (seen.has(number)) continue;
    seen.add(number);
    // The Orange Book covers only NDA (N) and ANDA (A); biologics and animal
    // drugs are not in it, so they get no Orange Book link.
    const obType = kind === 'NDA' ? 'N' : kind === 'ANDA' ? 'A' : null;
    out.push({ kind, number, obType });
  }
  return out;
}

function LinksCell({ row }: { row: LabelRow }) {
  const apps = applications(row.appr_num);
  return (
    <div className="fdl-links">
      <Link className="fdl-link" href={labelRoute(row.set_id)}>
        View Label
      </Link>
      <span className="fdl-links__row">
        DailyMed (
        <a className="fdl-link" href={DAILYMED_SPL(row.set_id)} target="_blank" rel="noreferrer">
          SPL
        </a>
        {' | '}
        <a className="fdl-link" href={DAILYMED_PDF(row.set_id)} target="_blank" rel="noreferrer">
          PDF
        </a>
        )
      </span>
      {apps.length > 0 ? (
        <span className="fdl-links__row">
          Drugs@FDA{' '}
          {apps.map((a) => (
            <a
              key={`daf-${a.number}`}
              className="fdl-link fdl-links__num"
              href={DRUGS_AT_FDA(a.number)}
              target="_blank"
              rel="noreferrer"
            >
              {a.number};
            </a>
          ))}
        </span>
      ) : null}
      {apps.some((a) => a.obType) ? (
        <span className="fdl-links__row">
          Orange Book{' '}
          {apps
            .filter((a) => a.obType)
            .map((a) => (
              <a
                key={`ob-${a.number}`}
                className="fdl-link fdl-links__num"
                href={ORANGE_BOOK(a.obType as string, a.number)}
                target="_blank"
                rel="noreferrer"
              >
                {a.number};
              </a>
            ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A horizontal scrollbar that rides the bottom of the viewport.
 *
 * The Expanded View is far wider than the screen, and a 50-row page is far
 * taller — so the table's own scrollbar, pinned to its bottom edge, is off
 * screen exactly when you need it. This proxies it: the native one is hidden
 * (see .fdl-tablewrap in querybuilder.css) and this bar, `position: sticky;
 * bottom: 0`, stays in reach the whole way down, settling into place when the
 * end of the table finally scrolls into view.
 *
 * CSS handles the sticking; the only work here is mirroring scrollLeft in both
 * directions and keeping the spacer the width of the real content.
 */
function StickyXScrollbar({
  targetRef,
  signature,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  /** Changes whenever the table's layout could have changed, forcing a re-measure. */
  signature: string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);
  // Guards the two onScroll handlers against echoing each other into a loop.
  const syncing = useRef(false);

  const measure = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    setContentWidth(target.scrollWidth);
    setOverflows(target.scrollWidth > target.clientWidth + 1);
  }, [targetRef]);

  /*
   * Measured from `signature` rather than only from a ResizeObserver. RO is the
   * obvious tool here, but making it the sole trigger means the bar silently
   * never appears anywhere RO is stubbed, throttled or absent — which is exactly
   * what happens in some embedded webviews. The signature covers every case the
   * app actually causes (view toggle, new page of rows), and RO below is left in
   * as an enhancement for the ones it does not (font loading, column reflow).
   */
  useLayoutEffect(measure, [measure, signature]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(target);
      const table = target.firstElementChild;
      if (table) observer.observe(table);
    }

    const onTargetScroll = () => {
      if (syncing.current) return;
      syncing.current = true;
      if (barRef.current) barRef.current.scrollLeft = target.scrollLeft;
      syncing.current = false;
    };
    target.addEventListener('scroll', onTargetScroll, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      target.removeEventListener('scroll', onTargetScroll);
      window.removeEventListener('resize', measure);
    };
  }, [measure, targetRef]);

  const onBarScroll = () => {
    if (syncing.current) return;
    syncing.current = true;
    const target = targetRef.current;
    if (target && barRef.current) target.scrollLeft = barRef.current.scrollLeft;
    syncing.current = false;
  };

  if (!overflows) return null;

  return (
    <div
      className="fdl-xbar"
      ref={barRef}
      onScroll={onBarScroll}
      // It duplicates a control the table already has, so it is decorative to
      // assistive tech — keyboard and screen-reader users scroll the region
      // itself, which stays focusable and announced.
      aria-hidden="true"
    >
      <div className="fdl-xbar__spacer" style={{ width: contentWidth }} />
    </div>
  );
}

interface ColumnDef {
  key: string;
  header: string;
  /** Sort token accepted by /api/labelquery/execute; omit to disable sorting. */
  sort?: string;
  render: (row: LabelRow) => React.ReactNode;
  strong?: boolean;
  accent?: boolean;
}

const LINKS_COLUMN: ColumnDef = {
  key: 'links',
  header: 'Links',
  render: (row) => <LinksCell row={row} />,
};

const TRADE_NAME: ColumnDef = {
  key: 'trade',
  header: 'Trade Name',
  sort: 'product',
  strong: true,
  render: (row) => joined(row.product_names),
};

const GENERIC_NAME: ColumnDef = {
  key: 'generic',
  header: 'Generic/Proper Name(s)',
  sort: 'generic',
  accent: true,
  render: (row) => joined(row.generic_names),
};

const SPL_DATE: ColumnDef = {
  key: 'revised',
  header: 'Most Recent SPL Date (YYYY/MM/DD)',
  sort: 'revised_date',
  render: (row) => (row.revised_date || '').replace(/-/g, '/'),
};

const BASIC_COLUMNS: ColumnDef[] = [
  LINKS_COLUMN,
  {
    key: 'market',
    header: 'Marketing Category',
    sort: 'market_category',
    render: (row) => joined(row.market_categories),
  },
  {
    key: 'dosage',
    header: 'Dosage Form(s)',
    sort: 'dosage_form',
    render: (row) => joined(row.dosage_forms),
  },
  {
    key: 'route',
    header: 'Route(s) of Administration',
    sort: 'route',
    render: (row) => joined(row.routes),
  },
  TRADE_NAME,
  GENERIC_NAME,
  SPL_DATE,
];

const EXPANDED_COLUMNS: ColumnDef[] = [
  LINKS_COLUMN,
  { key: 'type', header: 'Labeling Type', sort: 'doc_type', render: (row) => row.doc_type || '' },
  {
    key: 'dosage',
    header: 'Dosage Form(s)',
    sort: 'dosage_form',
    render: (row) => joined(row.dosage_forms),
  },
  {
    key: 'route',
    header: 'Route(s) of Administration',
    sort: 'route',
    render: (row) => joined(row.routes),
  },
  {
    key: 'market',
    header: 'Marketing Category',
    sort: 'market_category',
    render: (row) => joined(row.market_categories),
  },
  {
    key: 'appl',
    header: 'Application Number(s)',
    sort: 'appr_num',
    render: (row) => joined(row.appr_num),
  },
  TRADE_NAME,
  GENERIC_NAME,
  {
    key: 'unii',
    header: 'Active Ingredient UNII(s)',
    // Codes are opaque and fixed-width, so they read better monospaced and one
    // per line than run together in a sentence.
    render: (row) =>
      row.active_uniis ? (
        <span className="fdl-unii">
          {row.active_uniis.split(';').map((u) => (
            <code key={u.trim()}>{u.trim()}</code>
          ))}
        </span>
      ) : (
        ''
      ),
  },
  { key: 'labeler', header: 'Labeler', sort: 'manufacturer', render: (row) => row.manufacturer || '' },
  {
    key: 'epc',
    header: 'Pharmacologic Class(es)',
    render: (row) => joined(row.epc),
  },
  SPL_DATE,
  {
    key: 'approval',
    header: 'Initial Approval Year',
    sort: 'approval_year',
    render: (row) => row.initial_approval_year || '',
  },
];

export function ResultsTable({
  rows,
  view,
  sortState,
  onSort,
}: {
  rows: LabelRow[];
  view: ResultView;
  sortState: SortState;
  onSort: (sort: string) => void;
}) {
  const columns = view === 'expanded' ? EXPANDED_COLUMNS : BASIC_COLUMNS;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="fdl-tablescroll">
      <div className="fdl-tablewrap" ref={scrollRef}>
        <table className="fdl-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const active = column.sort && column.sort === sortState.sort;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {column.sort ? (
                      <button
                        type="button"
                        className="fdl-th"
                        onClick={() => onSort(column.sort as string)}
                      >
                        <span className="fdl-th__caret">
                          {active ? (sortState.dir === 'asc' ? '▲' : '▼') : ''}
                        </span>
                        {column.header}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.spl_id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={
                      column.accent
                        ? 'fdl-td--accent'
                        : column.strong
                          ? 'fdl-td--strong'
                          : undefined
                    }
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StickyXScrollbar targetRef={scrollRef} signature={`${view}:${columns.length}:${rows.length}`} />
    </div>
  );
}
