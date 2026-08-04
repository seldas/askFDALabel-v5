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
}

export interface ResultSet {
  results: LabelRow[];
  total: number;
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

  return (
    <div className="fdl-tablewrap">
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
  );
}
