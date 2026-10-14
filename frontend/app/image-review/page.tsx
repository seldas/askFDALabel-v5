'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '../components/Header';
import Footer from '../components/Footer';
import RequireFeature from '../components/RequireFeature';
import ArtworkPanel from './ArtworkPanel';
import { MODES, type Decision, type Finding, type Region, type Review, type ReviewMode, type Selection, type Side } from './types';
import { downloadReviewHtml, downloadReviewJson } from './exportReview';
import './image-review.css';

const EMPTY: Selection = { descriptor: {}, file: null, url: '', ready: false };

function Workbench() {
  const params = useSearchParams();
  const [mode, setMode] = useState<ReviewMode>('consistency');
  const [left, setLeft] = useState<Selection>(EMPTY);
  const [right, setRight] = useState<Selection>(EMPTY);
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [filter, setFilter] = useState<'all' | 'safety' | 'open'>('all');
  const [sync, setSync] = useState(true);
  const [zooms, setZooms] = useState({ left: 1, right: 1 });
  const [highlights, setHighlights] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [lastTaskId, setLastTaskId] = useState<number | null>(null);
  const [progress, setProgress] = useState({ value: 0, message: '' });
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const busy = submitting || taskId !== null;

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const currentSources = useRef({ left: '', right: '' });

  const invalidate = useCallback(() => {
    setReview(null);
    setSelected(null);
    setDecisions({});
    setLastTaskId(null);
    setError('');
  }, []);

  const onLeft = useCallback((value: Selection) => {
    const key = JSON.stringify(value.descriptor) + value.url;
    if (currentSources.current.left !== key) {
      currentSources.current.left = key;
      invalidate();
    }
    setLeft(value);
  }, [invalidate]);

  const onRight = useCallback((value: Selection) => {
    const key = JSON.stringify(value.descriptor) + value.url;
    if (currentSources.current.right !== key) {
      currentSources.current.right = key;
      invalidate();
    }
    setRight(value);
  }, [invalidate]);

  useEffect(() => {
    if (taskId === null) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let errors = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/image-review/reviews/${taskId}`, { signal: controller.signal });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not check review status.');
        errors = 0;
        setError('');
        setProgress({ value: data.progress, message: data.message });
        if (data.result) {
          setReview(data.result);
          setSelected(current => current ?? data.result.findings[0]?.id ?? null);
        }
        if (data.status === 'completed') {
          setTaskId(null);
          return;
        }
        if (data.status === 'failed') {
          if (data.result?.comparison_level === 'overview') {
            setReview({ ...data.result, detail_status: 'failed' });
          }
          setError(data.error || 'Review failed.');
          setTaskId(null);
          setLastTaskId(null);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        errors++;
        if (errors >= 3) {
          setError(`${e instanceof Error ? e.message : String(e)} The queued review may still be running. Use Resume status check.`);
          setTaskId(null);
          return;
        }
      }
      if (!cancelled) timer = setTimeout(poll, 1800);
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [taskId]);

  const run = async () => {
    if (mode === 'consistency') {
      if (!left.ready || !left.descriptor.set_id || busy) return;
    } else {
      if (!left.ready || !right.ready || busy) return;
    }

    setSubmitting(true);
    setError('');
    setReview(null);
    setDecisions({});
    setSelected(null);

    try {
      const form = new FormData();
      form.set('mode', mode);
      if (mode === 'consistency') {
        form.set('left', JSON.stringify(left.descriptor));
        if (left.file) form.set('left_upload', left.file);
      } else {
        for (const [side, value] of [['left', left], ['right', right]] as [Side, Selection][]) {
          form.set(side, JSON.stringify(value.descriptor));
          if (value.file) form.set(`${side}_upload`, value.file);
        }
      }

      const response = await fetch('/api/image-review/reviews', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start visual review.');
      setProgress({ value: 0, message: 'Review queued. A running Celery worker is required.' });
      setLastTaskId(data.task_id);
      setTaskId(data.task_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const changeZoom = (side: Side, zoom: number) =>
    setZooms(current => (sync ? { left: zoom, right: zoom } : { ...current, [side]: zoom }));

  const changeDecision = (id: number, change: Partial<Decision>) =>
    setDecisions(current => ({
      ...current,
      [id]: { ...(current[id] || { status: 'unreviewed', note: '' }), ...change },
    }));

  const current = review?.findings.find(f => f.id === selected);
  const visible = (review?.findings || []).filter(f =>
    filter === 'safety'
      ? !!f.risk || f.priority === 'critical'
      : filter === 'open'
      ? !decisions[f.id] || decisions[f.id].status === 'unreviewed'
      : true
  );
  const drawn = visible.filter(f => decisions[f.id]?.status !== 'dismissed');

  const adjust = (id: number, side: Side, region: Region | null) =>
    setReview(value =>
      value
        ? {
            ...value,
            findings: value.findings.map(f => (f.id === id ? { ...f, regions: { ...f.regions, [side]: region } } : f)),
          }
        : value
    );

  const canRun =
    !busy &&
    (mode === 'consistency'
      ? left.ready && !!left.descriptor.set_id
      : left.ready && right.ready);

  return (
    <div className="ivr-page">
      <Header />
      <main className="ivr-main">
        <header className="ivr-page-heading">
          <div>
            <span className="ivr-eyebrow">ARTWORK & SAFETY AUDIT</span>
            <h1>Labeling Visual Review</h1>
            <p>
              {mode === 'consistency'
                ? 'Audit package artwork against official FDA SPL drug labeling text.'
                : 'Compare artwork versions or identify look-alike product confusion risks.'}
            </p>
          </div>
          <button className="ivr-button ivr-primary" disabled={!canRun} onClick={() => void run()}>
            {busy
              ? 'Audit in progress…'
              : review
              ? 'Run audit again'
              : mode === 'consistency'
              ? 'Check Labeling Consistency'
              : 'Run visual review'}
          </button>
        </header>

        <nav className="ivr-tabs" aria-label="Review mode">
          {MODES.map(value => (
            <button
              key={value.id}
              aria-pressed={mode === value.id}
              disabled={busy}
              onClick={() => {
                if (mode !== value.id) {
                  setMode(value.id);
                  invalidate();
                }
              }}
            >
              {value.label}
            </button>
          ))}
        </nav>

        <div className="ivr-workspace-tools">
          <p>{MODES.find(value => value.id === mode)?.description}</p>
          <div>
            {mode !== 'consistency' && (
              <label>
                <input
                  type="checkbox"
                  checked={sync}
                  onChange={e => {
                    setSync(e.target.checked);
                    if (e.target.checked) setZooms({ left: zooms.left, right: zooms.left });
                  }}
                />
                Sync zoom
              </label>
            )}
            <label>
              <input type="checkbox" checked={highlights} onChange={e => setHighlights(e.target.checked)} />
              Show highlights
            </label>
          </div>
        </div>

        {error && (
          <div className="ivr-error ivr-status" role="alert">
            {error}
            {lastTaskId && (!review || review.detail_status === 'pending') && !busy && (
              <button className="ivr-button" onClick={() => setTaskId(lastTaskId)}>
                Resume status check
              </button>
            )}
          </div>
        )}

        {busy && (
          <div className="ivr-status" role="status">
            <progress max="100" value={progress.value} />
            <span>
              {progress.message || 'Analyzing artwork…'} · {elapsed}s elapsed
              {elapsed >= 15 && progress.value === 0
                ? ' · Waiting for the review worker to pick up this task.'
                : ''}
            </span>
          </div>
        )}

        <div className={`ivr-workspace ${mode === 'consistency' ? 'is-consistency' : ''}`}>
          {mode === 'consistency' ? (
            <div className="ivr-single-artwork">
              <ArtworkPanel
                side="left"
                mode="consistency"
                labelTitle="Packaging Artwork & Official Labeling Reference"
                initialSetId={params.getAll('set_ids')[0] || ''}
                initialSplId={params.getAll('spl_ids')[0] || ''}
                busy={busy}
                findings={drawn}
                selected={selected}
                highlights={highlights}
                zoom={zooms.left}
                onZoom={zoom => changeZoom('left', zoom)}
                onSelect={setSelected}
                onChange={onLeft}
              />
            </div>
          ) : (
            <div className="ivr-pair">
              <ArtworkPanel
                side="left"
                mode={mode}
                initialSetId={params.getAll('set_ids')[0] || ''}
                initialSplId={params.getAll('spl_ids')[0] || ''}
                busy={busy}
                findings={drawn}
                selected={selected}
                highlights={highlights}
                zoom={zooms.left}
                onZoom={zoom => changeZoom('left', zoom)}
                onSelect={setSelected}
                onChange={onLeft}
              />
              <ArtworkPanel
                side="right"
                mode={mode}
                initialSetId={params.getAll('set_ids')[1] || ''}
                initialSplId={params.getAll('spl_ids')[1] || ''}
                busy={busy}
                findings={drawn}
                selected={selected}
                highlights={highlights}
                zoom={zooms.right}
                onZoom={zoom => changeZoom('right', zoom)}
                onSelect={setSelected}
                onChange={onRight}
              />
            </div>
          )}

          <aside className={`ivr-findings ${mode === 'consistency' ? 'is-consistency' : ''}`}>
            <header>
              <h2>{mode === 'consistency' ? 'Consistency Audit Findings' : 'Review Findings'}</h2>
              {review && (
                <span>
                  {review.findings.length}{' '}
                  {mode === 'consistency' ? 'discrepancies detected' : 'findings'} ·{' '}
                  {review.cached ? 'Saved analysis' : 'AI analysis'}
                </span>
              )}
            </header>

            {!review ? (
              <div className="ivr-findings-empty">
                {mode === 'consistency' ? (
                  <>
                    <strong>Packaging & Labeling Consistency Audit</strong>
                    <p>Load a drug labeling from your dashboard tasks / projects and select or upload its artwork.</p>
                    <ul>
                      <li>Product name & active ingredient quantitative alignment</li>
                      <li>Strength, concentration, and container volume consistency</li>
                      <li>Dosage form & route of administration match</li>
                      <li>Required container warnings & storage conditions (e.g. refrigeration, light protection)</li>
                      <li>Reconstitution, dilution, and administration instructions</li>
                    </ul>
                    <p>Uses official FDA SPL Prescribing Information as the single source of truth.</p>
                  </>
                ) : (
                  <>
                    <strong>Evidence first</strong>
                    <p>Choose an image on each side, select a review mode, then run the analysis.</p>
                    <ul>
                      <li>Localized content and design differences</li>
                      <li>Potential medication-error mechanisms</li>
                      <li>Look-alike product distinctions</li>
                      <li>Verifiable labeling references</li>
                    </ul>
                    <p>Exact-version local artwork or explicit uploads. A vision-capable model is required.</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <p className="ivr-summary">{review.summary}</p>

                {review.findings.length === 0 && (
                  <div className="ivr-clean-banner" role="status">
                    <strong>✓ Fully Consistent with Labeling</strong>
                    <p>No discrepancies, contradictions, or critical omissions were detected between this package artwork and the reviewed official labeling sections.</p>
                  </div>
                )}

                {review.comparison_level === 'overview' && (
                  <div className="ivr-overview" role="status">
                    <strong>
                      {review.detail_status === 'unavailable'
                        ? 'These two images are too different; a detailed point-to-point comparison is not available.'
                        : review.detail_status === 'pending'
                        ? 'Quick overview ready. Detailed comparison is still running.'
                        : 'Quick overview retained. Detailed comparison could not be completed.'}
                    </strong>
                    <p>Showing key observations without detailed highlight regions. Labeling consistency is not assessed in this overview.</p>
                  </div>
                )}

                {review.findings.length > 0 && (
                  <>
                    <label className="ivr-filter">
                      Show
                      <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
                        <option value="all">All findings ({review.findings.length})</option>
                        <option value="safety">Safety & critical signals</option>
                        <option value="open">Unreviewed</option>
                      </select>
                    </label>

                    <div className="ivr-finding-list">
                      {visible.map(f => (
                        <button
                          key={f.id}
                          className={`ivr-finding ${selected === f.id ? 'is-selected' : ''} ${
                            f.category === 'color' ? 'is-color' : ''
                          }`}
                          onClick={() => setSelected(f.id)}
                          aria-pressed={selected === f.id}
                        >
                          <span className="ivr-number">{f.id}</span>
                          <div>
                            <strong>{f.title}</strong>
                            <p>{f.observation}</p>
                            <span className="ivr-tag">{f.kind}</span>
                            <span className="ivr-tag ivr-priority-tag" data-priority={f.priority}>
                              {f.priority}
                            </span>
                            <span className="ivr-tag">{decisions[f.id]?.status || 'unreviewed'}</span>
                          </div>
                        </button>
                      ))}
                      {!visible.length && (
                        <p className="ivr-source-note">No findings match this filter. This does not establish absence of risk.</p>
                      )}
                    </div>
                  </>
                )}

                {current && (
                  <fieldset className="ivr-review-editors" disabled={busy}>
                    <FindingDetails
                      mode={mode}
                      finding={current}
                      decision={decisions[current.id] || { status: 'unreviewed', note: '' }}
                      onDecision={value => changeDecision(current.id, value)}
                      onRegion={(side, region) => adjust(current.id, side, region)}
                    />
                  </fieldset>
                )}

                <details className="ivr-limitations">
                  <summary>Sources & limitations</summary>
                  <p>Model: {review.model}</p>
                  {mode === 'consistency' ? (
                    <p>
                      Artwork: {review.sources.left?.source || 'Uploaded image'} · {review.sources.left?.filename || 'artwork.png'}
                      <br />
                      SPL Reference: {review.sources.left?.spl_id || review.sources.left?.set_id || 'Version unverified'}
                    </p>
                  ) : (
                    (['left', 'right'] as Side[]).map(side => (
                      <p key={side}>
                        {side === 'left' ? 'A' : 'B'}: {review.sources[side]?.source} · {review.sources[side]?.filename}
                        <br />
                        SPL: {review.sources[side]?.spl_id || 'No reference'}
                        <br />
                        {review.sources[side]?.version_verified
                          ? 'Local version-linked artwork'
                          : 'Uploaded artwork; association unverified'}
                      </p>
                    ))
                  )}
                  {review.limitations.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                </details>

                <footer className="ivr-export">
                  <button className="ivr-button" onClick={() => downloadReviewJson(review, decisions, lastTaskId)}>
                    Export JSON
                  </button>
                  <button
                    className="ivr-button ivr-primary"
                    disabled={exporting}
                    onClick={async () => {
                      setExporting(true);
                      try {
                        await downloadReviewHtml(review, decisions, { left: left.url, right: right.url });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >
                    {exporting ? 'Exporting…' : 'Export annotated report'}
                  </button>
                  <p>Decisions and adjusted regions stay in this session. Export to preserve them.</p>
                </footer>
              </>
            )}
          </aside>
        </div>
        <p className="ivr-footnote">
          Review signals require human confirmation. Highlight locations are AI estimates; missing information does not guarantee absence of conflict.
        </p>
      </main>
      <Footer />
    </div>
  );
}

function FindingDetails({
  mode,
  finding,
  decision,
  onDecision,
  onRegion,
}: {
  mode: ReviewMode;
  finding: Finding;
  decision: Decision;
  onDecision: (value: Partial<Decision>) => void;
  onRegion: (side: Side, region: Region | null) => void;
}) {
  const isConsistency = mode === 'consistency';

  return (
    <section className="ivr-details">
      <header className="ivr-details-header">
        <h3>Finding {finding.id} · {finding.title}</h3>
        <span className="ivr-confidence">Confidence: {finding.confidence}</span>
      </header>

      {finding.risk && (
        <div className="ivr-risk">
          <strong>⚠️ Potential Medication Error / Risk Mechanism</strong>
          <p>{finding.risk}</p>
        </div>
      )}

      {isConsistency ? (
        <div className="ivr-consistency-comparison">
          <div className="ivr-evidence-card">
            <span className="ivr-evidence-label">📦 Artwork Visible Text</span>
            <div className="ivr-evidence-text">
              {finding.left_text || finding.observation || 'No transcribed artwork text supplied.'}
            </div>
          </div>

          <div className="ivr-evidence-card is-labeling">
            <span className="ivr-evidence-label">📜 Official SPL Labeling Reference</span>
            <div className="ivr-evidence-text">
              {finding.label_evidence && finding.label_evidence.length > 0 ? (
                finding.label_evidence.map((e, idx) => (
                  <blockquote key={idx} className="ivr-quote">
                    "{e.quote}"
                  </blockquote>
                ))
              ) : (
                <span className="ivr-muted-note">No direct quote extracted from reference text.</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {(['left', 'right'] as Side[]).map(side => (
            <p key={side}>
              <strong>{side === 'left' ? 'Product A' : 'Product B'}:</strong>{' '}
              {finding[`${side}_text`] || 'No transcribed evidence supplied.'}
            </p>
          ))}
          {finding.label_evidence.map((e, i) => (
            <blockquote key={i}>
              <strong>{e.side} labeling reference</strong>
              <p>{e.quote}</p>
            </blockquote>
          ))}
        </>
      )}

      <div className="ivr-decision">
        <button
          className="ivr-button"
          aria-pressed={decision.status === 'confirmed'}
          onClick={() => onDecision({ status: decision.status === 'confirmed' ? 'unreviewed' : 'confirmed' })}
        >
          ✓ Confirm Finding
        </button>
        <button
          className="ivr-button"
          aria-pressed={decision.status === 'dismissed'}
          onClick={() => onDecision({ status: decision.status === 'dismissed' ? 'unreviewed' : 'dismissed' })}
        >
          ✕ Dismiss
        </button>
      </div>

      <label>
        Reviewer note
        <textarea
          rows={2}
          placeholder="Add comments or clinical verification notes…"
          value={decision.note}
          onChange={e => onDecision({ note: e.target.value })}
        />
      </label>

      <details>
        <summary>Adjust highlight region coordinates</summary>
        <p>Coordinates are normalized (0–100%) on the package artwork.</p>
        {(isConsistency ? (['left'] as Side[]) : (['left', 'right'] as Side[])).map(side => {
          const region = finding.regions[side];
          const label = isConsistency ? 'Artwork Highlight' : side === 'left' ? 'Product A' : 'Product B';
          return (
            <div className="ivr-region-editor" key={side}>
              <strong>{label}</strong>
              {region ? (
                <>
                  <div>
                    {(['x', 'y', 'w', 'h'] as const).map(key => (
                      <label key={key}>
                        {key.toUpperCase()} %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={Math.round(region[key] * 1000) / 10}
                          onChange={e => {
                            const next = { ...region, [key]: Math.max(0, Math.min(1, Number(e.target.value) / 100)) };
                            next.x = Math.min(0.99, next.x);
                            next.y = Math.min(0.99, next.y);
                            next.w = Math.max(0.001, Math.min(1 - next.x, next.w));
                            next.h = Math.max(0.001, Math.min(1 - next.y, next.h));
                            onRegion(side, next);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <button className="ivr-button" onClick={() => onRegion(side, null)}>
                    Remove region
                  </button>
                </>
              ) : (
                <button className="ivr-button" onClick={() => onRegion(side, { x: 0.1, y: 0.1, w: 0.2, h: 0.1 })}>
                  Add highlight region
                </button>
              )}
            </div>
          );
        })}
      </details>
    </section>
  );
}

export default function ImageReviewPage() {
  return (
    <RequireFeature feature="Labeling Visual Review" featureKey="tool_image_review">
      <Suspense fallback={<p>Loading visual review…</p>}>
        <Workbench />
      </Suspense>
    </RequireFeature>
  );
}
