'use client';

/*
 * Result set for an executed criteria query.
 *
 * Rows link into the existing label workspace via labelRoute(), so a hit here
 * lands in the same viewer the rest of the platform uses rather than a
 * one-off detail page.
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
  routes: string | null;
  epc: string | null;
  is_rld: number | null;
  is_rs: number | null;
}

export interface ResultSet {
  results: LabelRow[];
  total: number;
  capped: boolean;
  limit: number;
  offset: number;
  warnings: string[];
}

function firstOf(value: string | null | undefined) {
  if (!value) return '';
  return value.split(';')[0].trim();
}

export function ResultsTable({
  data,
  busy,
  onPage,
}: {
  data: ResultSet;
  busy: boolean;
  onPage: (offset: number) => void;
}) {
  const { results, total, capped, limit, offset } = data;
  const from = results.length ? offset + 1 : 0;
  const to = offset + results.length;

  return (
    <section className="fdl-results" aria-label="Search results" aria-busy={busy}>
      <div className="fdl-results__bar">
        <span className="fdl-results__count">
          {total === 0
            ? 'No labels matched'
            : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}${capped ? '+' : ''} labels`}
        </span>
        <span className="fdl-results__pager">
          <button
            type="button"
            className="fdl-btn fdl-btn--quiet"
            disabled={busy || offset === 0}
            onClick={() => onPage(Math.max(0, offset - limit))}
          >
            ‹ Previous
          </button>
          <button
            type="button"
            className="fdl-btn fdl-btn--quiet"
            disabled={busy || to >= total}
            onClick={() => onPage(offset + limit)}
          >
            Next ›
          </button>
        </span>
      </div>

      {data.warnings?.length ? (
        <ul className="fdl-results__warnings">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {results.length > 0 ? (
        <div className="fdl-tablewrap">
          <table className="fdl-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Generic / active ingredient</th>
                <th scope="col">Labeler</th>
                <th scope="col">Application</th>
                <th scope="col">Type</th>
                <th scope="col">Revised</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.spl_id}>
                  <td>
                    <Link className="fdl-link" href={labelRoute(row.set_id)}>
                      {firstOf(row.product_names) || row.set_id}
                    </Link>
                    <div className="fdl-table__sub">
                      {row.is_rld ? <span className="fdl-tag">RLD</span> : null}
                      {row.is_rs ? <span className="fdl-tag">RS</span> : null}
                      {firstOf(row.routes) ? (
                        <span className="fdl-table__dim">{firstOf(row.routes)}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{firstOf(row.generic_names)}</td>
                  <td>{row.manufacturer || ''}</td>
                  <td>
                    {firstOf(row.appr_num)}
                    <div className="fdl-table__dim">{firstOf(row.market_categories)}</div>
                  </td>
                  <td className="fdl-table__dim">{row.doc_type || ''}</td>
                  <td>{row.revised_date || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
