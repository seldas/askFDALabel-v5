'use client';

/*
 * Chemical Structure Search page.
 *
 * Standalone page (opens in a new tab from the Resources dropdown).
 * Accepts a SMILES or InChI string, a match mode (exact / substructure /
 * similarity) and an optional Tanimoto threshold, then shows matching drug
 * labels using the shared ResultsTable with an extra "Match" column prepended.
 *
 * Backend: POST /api/chemsearch/search
 *          GET  /api/chemsearch/validate
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Page } from '../platform/primitives';
import {
  ResultsTable,
  type LabelRow,
  type ResultView,
  type SortState,
  type ColumnDef,
} from '../querybuilder/ResultsTable';
import '../querybuilder/querybuilder.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChemLabelRow extends LabelRow {
  match_unii: string | null;
  match_score: number | null; // 0–1 Tanimoto; null for exact / substructure
  match_type: 'exact' | 'substructure' | 'similarity';
}

interface ChemResultSet {
  results: ChemLabelRow[];
  total: number;
  limit: number;
  offset: number;
  query_smiles: string;
  match: string;
  threshold: number | null;
  matched_uniis_count: number;
  warnings: string[];
}

type MatchMode = 'exact' | 'substructure' | 'similarity';

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Match column (prepended before standard columns)
// ---------------------------------------------------------------------------

function MatchCell({ row }: { row: LabelRow }) {
  const r = row as ChemLabelRow;
  const unii = r.match_unii || '';
  const score = r.match_score;

  if (r.match_type === 'similarity' && score !== null) {
    const pct = Math.round(score * 100);
    return (
      <div style={{ minWidth: 110 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>
          {pct}%
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: '#e2e8f0',
            overflow: 'hidden',
            marginBottom: 4,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background:
                pct >= 90 ? '#16a34a' : pct >= 75 ? '#2563eb' : pct >= 60 ? '#d97706' : '#94a3b8',
              borderRadius: 3,
            }}
          />
        </div>
        {unii && (
          <code style={{ fontSize: '0.65rem', color: '#64748b', display: 'block' }}>{unii}</code>
        )}
      </div>
    );
  }

  // Exact / substructure — just show a check badge and UNII
  return (
    <div>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: '#dcfce7',
          color: '#15803d',
          fontSize: '0.72rem',
          fontWeight: 700,
          padding: '2px 7px',
          borderRadius: 6,
          marginBottom: unii ? 3 : 0,
        }}
      >
        ✓ {r.match_type}
      </span>
      {unii && (
        <code style={{ fontSize: '0.65rem', color: '#64748b', display: 'block', marginTop: 2 }}>
          {unii}
        </code>
      )}
    </div>
  );
}

const MATCH_COLUMN: ColumnDef = {
  key: 'match',
  header: 'Match',
  render: (row) => <MatchCell row={row} />,
};

// ---------------------------------------------------------------------------
// Input panel
// ---------------------------------------------------------------------------

function InputPanel({
  onSearch,
  busy,
}: {
  onSearch: (smiles: string, mode: MatchMode, threshold: number) => void;
  busy: boolean;
}) {
  const [smiles, setSmiles] = useState('');
  const [mode, setMode] = useState<MatchMode>('substructure');
  const [threshold, setThreshold] = useState(0.7);
  const [validation, setValidation] = useState<{ valid: boolean; canonical?: string; error?: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline validation — debounced on input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!smiles.trim()) {
      setValidation(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setValidating(true);
      try {
        const res = await fetch(`/api/chemsearch/validate?smiles=${encodeURIComponent(smiles.trim())}`);
        const data = await res.json();
        setValidation(data);
      } catch {
        setValidation(null);
      } finally {
        setValidating(false);
      }
    }, 500);
  }, [smiles]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smiles.trim() || busy) return;
    onSearch(smiles.trim(), mode, threshold);
  };

  const isInvalid = validation !== null && !validation.valid;

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        padding: '24px 28px',
        marginBottom: 24,
        boxShadow: '0 2px 8px rgba(15,23,42,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {/* Molecule SVG icon */}
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="2" />
          <circle cx="19.5" cy="9" r="2" />
          <circle cx="19.5" cy="15" r="2" />
          <circle cx="12" cy="19" r="2" />
          <circle cx="4.5" cy="15" r="2" />
          <circle cx="4.5" cy="9" r="2" />
          <line x1="12" y1="7" x2="17.8" y2="10" />
          <line x1="19.5" y1="11" x2="19.5" y2="13" />
          <line x1="17.8" y1="14" x2="12" y2="17" />
          <line x1="12" y1="17" x2="6.2" y2="14" />
          <line x1="4.5" y1="13" x2="4.5" y2="11" />
          <line x1="6.2" y1="10" x2="12" y2="7" />
        </svg>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
          Chemical Structure Search
        </h2>
      </div>

      <form onSubmit={handleSubmit}>
        {/* SMILES / InChI input */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="smiles-input"
            style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#374151', marginBottom: 6 }}
          >
            SMILES or InChI string
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="smiles-input"
              type="text"
              value={smiles}
              onChange={(e) => setSmiles(e.target.value)}
              placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O  (aspirin)"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 14px',
                border: `1.5px solid ${isInvalid ? '#ef4444' : validation?.valid ? '#16a34a' : '#cbd5e1'}`,
                borderRadius: 8,
                fontSize: '0.9rem',
                fontFamily: 'var(--font-geist-mono), monospace',
                outline: 'none',
                transition: 'border-color 0.15s',
                background: isInvalid ? '#fef2f2' : '#ffffff',
              }}
              autoComplete="off"
              spellCheck={false}
            />
            {validating && (
              <span
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '0.72rem',
                  color: '#94a3b8',
                }}
              >
                checking…
              </span>
            )}
          </div>
          {validation && (
            <div
              style={{
                marginTop: 5,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: validation.valid ? '#15803d' : '#dc2626',
              }}
            >
              {validation.valid
                ? `✓ Valid${validation.canonical && validation.canonical !== smiles.trim() ? ` — canonical: ${validation.canonical}` : ''}`
                : `✗ ${validation.error || 'Invalid structure'}`}
            </div>
          )}
        </div>

        {/* Match mode + threshold */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Match type
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['exact', 'substructure', 'similarity'] as MatchMode[]).map((m) => (
                <label
                  key={m}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1.5px solid ${mode === m ? '#2563eb' : '#cbd5e1'}`,
                    background: mode === m ? '#eff6ff' : '#f8fafc',
                    color: mode === m ? '#1d4ed8' : '#475569',
                    fontSize: '0.82rem',
                    fontWeight: mode === m ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="match-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    style={{ display: 'none' }}
                  />
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {mode === 'similarity' && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <div
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: '#374151',
                  marginBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Tanimoto threshold</span>
                <span style={{ color: '#2563eb' }}>{Math.round(threshold * 100)}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={Math.round(threshold * 100)}
                onChange={(e) => setThreshold(Number(e.target.value) / 100)}
                style={{ width: '100%', accentColor: '#2563eb' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.68rem',
                  color: '#94a3b8',
                  marginTop: 2,
                }}
              >
                <span>50% (loose)</span>
                <span>100% (exact)</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="submit"
            disabled={!smiles.trim() || busy || isInvalid}
            style={{
              background:
                !smiles.trim() || busy || isInvalid
                  ? '#94a3b8'
                  : 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: !smiles.trim() || busy || isInvalid ? 'not-allowed' : 'pointer',
              boxShadow: !smiles.trim() || busy || isInvalid ? 'none' : '0 2px 8px rgba(37,99,235,0.3)',
              transition: 'all 0.15s',
            }}
          >
            {busy ? 'Searching…' : 'Search'}
          </button>

          {smiles && (
            <button
              type="button"
              onClick={() => {
                setSmiles('');
                setValidation(null);
              }}
              style={{
                background: 'none',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '10px 16px',
                color: '#475569',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      <div
        style={{
          marginTop: 16,
          padding: '10px 14px',
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #f1f5f9',
          fontSize: '0.75rem',
          color: '#64748b',
          lineHeight: 1.5,
        }}
      >
        <strong>Note:</strong> Structure search queries the FDA Oracle database (
        <code>DRUGLABEL.UNII_CHEM_STRUCT</code>) and requires an internal network connection.
        Substructure and similarity screening runs in Python via RDKit on the server.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ChemSearchPage() {
  const [data, setData] = useState<ChemResultSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ResultView>('basic');
  const [offset, setOffset] = useState(0);
  const [sortState, setSortState] = useState<SortState>({ sort: 'revised_date', dir: 'desc' });

  // Last-run params for paging
  const lastParams = useRef<{ smiles: string; mode: MatchMode; threshold: number } | null>(null);

  const runSearch = useCallback(
    async (smiles: string, mode: MatchMode, threshold: number, page = 0) => {
      setBusy(true);
      setError(null);
      lastParams.current = { smiles, mode, threshold };

      try {
        const res = await fetch('/api/chemsearch/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            smiles,
            match: mode,
            threshold,
            limit: PAGE_SIZE,
            offset: page,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
        setData(json as ChemResultSet);
        setOffset(page);
      } catch (err: any) {
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleSearch = (smiles: string, mode: MatchMode, threshold: number) => {
    setOffset(0);
    runSearch(smiles, mode, threshold, 0);
  };

  const onSort = useCallback((sort: string) => {
    setSortState((prev) =>
      prev.sort === sort ? { sort, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { sort, dir: 'asc' },
    );
  }, []);

  const handlePrev = () => {
    if (!lastParams.current || offset === 0) return;
    const newOffset = Math.max(0, offset - PAGE_SIZE);
    runSearch(lastParams.current.smiles, lastParams.current.mode, lastParams.current.threshold, newOffset);
  };

  const handleNext = () => {
    if (!lastParams.current || !data) return;
    if (offset + PAGE_SIZE >= data.total) return;
    const newOffset = offset + PAGE_SIZE;
    runSearch(lastParams.current.smiles, lastParams.current.mode, lastParams.current.threshold, newOffset);
  };

  const rows = (data?.results || []) as LabelRow[];
  const total = data?.total || 0;
  const to = offset + rows.length;

  return (
    <Page>
      <Header />

      <main className="fdl-shell fdl-shell--results">

        <InputPanel onSearch={handleSearch} busy={busy} />

        {/* Errors */}
        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: 12,
              padding: '16px 20px',
              color: '#991b1b',
              fontSize: '0.88rem',
              marginBottom: 20,
              fontWeight: 600,
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Warnings */}
        {data?.warnings && data.warnings.length > 0 && (
          <div
            style={{
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 12,
              padding: '12px 16px',
              color: '#92400e',
              fontSize: '0.82rem',
              marginBottom: 16,
            }}
          >
            {data.warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
          </div>
        )}

        {/* Loading spinner */}
        {busy && (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="loader" style={{ margin: '0 auto' }} />
            <p style={{ color: '#64748b', marginTop: 12 }}>Screening structures…</p>
          </div>
        )}

        {/* Results header */}
        {!busy && data && (
          <>
            <div className="fdl-resultshead">
              <h1 className="fdl-resultshead__count">
                {total === 0
                  ? 'No matching labels found'
                  : `${total.toLocaleString()} label${total === 1 ? '' : 's'} matched`}
                {data.matched_uniis_count > 0 && (
                  <span
                    style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', marginLeft: 8 }}
                  >
                    via {data.matched_uniis_count} UNII{data.matched_uniis_count === 1 ? '' : 's'}
                    {data.match === 'similarity' && data.threshold !== null
                      ? ` (≥${Math.round(data.threshold * 100)}% similarity)`
                      : ''}
                  </span>
                )}
              </h1>

              <div className="fdl-viewtoggle" role="group" aria-label="Result detail">
                <button
                  type="button"
                  className={view === 'basic' ? 'fdl-viewtoggle__on' : 'fdl-viewtoggle__off'}
                  aria-pressed={view === 'basic'}
                  onClick={() => setView('basic')}
                >
                  Basic View
                </button>
                <button
                  type="button"
                  className={view === 'expanded' ? 'fdl-viewtoggle__on' : 'fdl-viewtoggle__off'}
                  aria-pressed={view === 'expanded'}
                  onClick={() => setView('expanded')}
                >
                  Expanded View
                </button>
              </div>
            </div>

            {/* Query SMILES display */}
            {data.query_smiles && (
              <div
                style={{
                  marginBottom: 16,
                  fontSize: '0.78rem',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontWeight: 700 }}>Query:</span>
                <code
                  style={{
                    background: '#f1f5f9',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: '0.8rem',
                    color: '#1e293b',
                  }}
                >
                  {data.query_smiles}
                </code>
                <span
                  style={{
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                  }}
                >
                  {data.match}
                </span>
              </div>
            )}

            {rows.length > 0 ? (
              <>
                <ResultsTable
                  rows={rows}
                  view={view}
                  sortState={sortState}
                  onSort={onSort}
                  extraColumns={[MATCH_COLUMN]}
                />

                {/* Pagination */}
                {total > PAGE_SIZE && (
                  <div
                    className="fdl-pager"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}
                  >
                    <button
                      type="button"
                      className="fdl-btn"
                      onClick={handlePrev}
                      disabled={offset === 0}
                    >
                      ← Previous
                    </button>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      {offset + 1}–{to} of {total.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="fdl-btn"
                      onClick={handleNext}
                      disabled={to >= total}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3rem',
                  color: '#64748b',
                  background: '#f8fafc',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔬</div>
                <div style={{ fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  No drug labels found
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  No FDA-approved drug labels contain an active ingredient matching this structure.
                  Try a broader match type or a lower similarity threshold.
                </div>
              </div>
            )}
          </>
        )}

        {/* Initial state (no search run yet) */}
        {!busy && !data && !error && (
          <div
            style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: '#94a3b8',
            }}
          >
            <svg
              width={56}
              height={56}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: '0 auto 16px' }}
              aria-hidden="true"
            >
              <circle cx="12" cy="5" r="2" />
              <circle cx="19.5" cy="9" r="2" />
              <circle cx="19.5" cy="15" r="2" />
              <circle cx="12" cy="19" r="2" />
              <circle cx="4.5" cy="15" r="2" />
              <circle cx="4.5" cy="9" r="2" />
              <line x1="12" y1="7" x2="17.8" y2="10" />
              <line x1="19.5" y1="11" x2="19.5" y2="13" />
              <line x1="17.8" y1="14" x2="12" y2="17" />
              <line x1="12" y1="17" x2="6.2" y2="14" />
              <line x1="4.5" y1="13" x2="4.5" y2="11" />
              <line x1="6.2" y1="10" x2="12" y2="7" />
            </svg>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#64748b', marginBottom: 8 }}>
              Enter a SMILES string and click Search
            </div>
            <div style={{ fontSize: '0.85rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
              Find FDA-approved drug labels by chemical structure.
              Supports exact match, substructure search, and Tanimoto similarity scoring
              against the FDA{'’'}s UNII chemical structure registry.
            </div>
          </div>
        )}
      </main>

      <Footer />
    </Page>
  );
}
