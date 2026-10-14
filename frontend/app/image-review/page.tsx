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
  const [mode, setMode] = useState<ReviewMode>('artwork');
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
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const currentSources = useRef({ left: '', right: '' });

  const invalidate = useCallback(() => { setReview(null); setSelected(null); setDecisions({}); setLastTaskId(null); setError(''); }, []);
  const onLeft = useCallback((value: Selection) => { const key = JSON.stringify(value.descriptor) + value.url; if (currentSources.current.left !== key) { currentSources.current.left = key; invalidate(); } setLeft(value); }, [invalidate]);
  const onRight = useCallback((value: Selection) => { const key = JSON.stringify(value.descriptor) + value.url; if (currentSources.current.right !== key) { currentSources.current.right = key; invalidate(); } setRight(value); }, [invalidate]);

  useEffect(() => {
    if (taskId === null) return;
    const controller = new AbortController();
    let cancelled = false, timer: ReturnType<typeof setTimeout>, errors = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/image-review/reviews/${taskId}`, { signal: controller.signal });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not check review status.');
        errors = 0; setError(''); setProgress({ value: data.progress, message: data.message });
        if (data.result) { setReview(data.result); setSelected(current => current ?? data.result.findings[0]?.id ?? null); }
        if (data.status === 'completed') { setTaskId(null); return; }
        if (data.status === 'failed') { if (data.result?.comparison_level === 'overview') setReview({ ...data.result, detail_status: 'failed' }); setError(data.error || 'Review failed.'); setTaskId(null); setLastTaskId(null); return; }
      } catch (e) {
        if (cancelled) return;
        errors++;
        if (errors >= 3) { setError(`${e instanceof Error ? e.message : String(e)} The queued review may still be running. Use Resume status check.`); setTaskId(null); return; }
      }
      if (!cancelled) timer = setTimeout(poll, 1800);
    };
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [taskId]);

  const run = async () => {
    if (!left.ready || !right.ready || busy) return;
    setSubmitting(true); setError(''); setReview(null); setDecisions({}); setSelected(null);
    try {
      const form = new FormData(); form.set('mode', mode);
      for (const [side, value] of [['left', left], ['right', right]] as [Side, Selection][]) {
        form.set(side, JSON.stringify(value.descriptor)); if (value.file) form.set(`${side}_upload`, value.file);
      }
      const response = await fetch('/api/image-review/reviews', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start visual review.');
      setProgress({ value: 0, message: 'Review queued. A running Celery worker is required.' });
      setLastTaskId(data.task_id); setTaskId(data.task_id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  };
  const changeZoom = (side: Side, zoom: number) => setZooms(current => sync ? { left: zoom, right: zoom } : { ...current, [side]: zoom });
  const changeDecision = (id: number, change: Partial<Decision>) => setDecisions(current => ({ ...current, [id]: { ...(current[id] || { status: 'unreviewed', note: '' }), ...change } }));
  const current = review?.findings.find(f => f.id === selected);
  const visible = (review?.findings || []).filter(f => filter === 'safety' ? !!f.risk || f.priority === 'critical' : filter === 'open' ? !decisions[f.id] || decisions[f.id].status === 'unreviewed' : true);
  const drawn = visible.filter(f => decisions[f.id]?.status !== 'dismissed');
  const adjust = (id: number, side: Side, region: Region | null) => setReview(value => value ? { ...value, findings: value.findings.map(f => f.id === id ? { ...f, regions: { ...f.regions, [side]: region } } : f) } : value);

  return <div className="ivr-page"><Header /><main className="ivr-main">
    <header className="ivr-page-heading"><div><span className="ivr-eyebrow">ARTWORK & SAFETY REVIEW</span><h1>Labeling Visual Review</h1><p>Compare artwork. Review safety signals.</p></div><button className="ivr-button ivr-primary" disabled={busy || !left.ready || !right.ready || (mode === 'consistency' && !left.descriptor.set_id && !right.descriptor.set_id)} onClick={() => void run()}>{busy ? 'Review in progress…' : review ? 'Run review again' : 'Run visual review'}</button></header>
    <nav className="ivr-tabs" aria-label="Review mode">{MODES.map(value => <button key={value.id} aria-pressed={mode === value.id} disabled={busy} onClick={() => { if (mode !== value.id) { setMode(value.id); invalidate(); } }}>{value.label}</button>)}</nav>
    <div className="ivr-workspace-tools"><p>{MODES.find(value => value.id === mode)?.description}</p><div><label><input type="checkbox" checked={sync} onChange={e => { setSync(e.target.checked); if (e.target.checked) setZooms({ left: zooms.left, right: zooms.left }); }} /> Sync zoom</label><label><input type="checkbox" checked={highlights} onChange={e => setHighlights(e.target.checked)} /> Show highlights</label></div></div>
    {error && <div className="ivr-error ivr-status" role="alert">{error}{lastTaskId && (!review || review.detail_status === 'pending') && !busy && <button className="ivr-button" onClick={() => setTaskId(lastTaskId)}>Resume status check</button>}</div>}
    {busy && <div className="ivr-status" role="status"><progress max="100" value={progress.value} /><span>{progress.message || 'Preparing images…'} · {elapsed}s elapsed{elapsed >= 15 && progress.value === 0 ? ' · Waiting for the review worker to pick up this task.' : ''}</span></div>}
    <div className="ivr-workspace">
      <div className="ivr-pair">
        <ArtworkPanel side="left" initialSetId={params.getAll('set_ids')[0] || ''} initialSplId={params.getAll('spl_ids')[0] || ''} busy={busy} findings={drawn} selected={selected} highlights={highlights} zoom={zooms.left} onZoom={zoom => changeZoom('left', zoom)} onSelect={setSelected} onChange={onLeft} />
        <ArtworkPanel side="right" initialSetId={params.getAll('set_ids')[1] || ''} initialSplId={params.getAll('spl_ids')[1] || ''} busy={busy} findings={drawn} selected={selected} highlights={highlights} zoom={zooms.right} onZoom={zoom => changeZoom('right', zoom)} onSelect={setSelected} onChange={onRight} />
      </div>
      <aside className="ivr-findings"><header><h2>Review Findings</h2>{review && <span>{review.findings.length} findings · {review.cached ? 'Saved analysis' : 'AI analysis'}</span>}</header>
        {!review ? <div className="ivr-findings-empty"><strong>Evidence first</strong><p>Choose an image on each side, select a review mode, then run the analysis.</p><ul><li>Localized content and design differences</li><li>Potential medication-error mechanisms</li><li>Look-alike product distinctions</li><li>Verifiable labeling references</li></ul><p>Exact-version local artwork or explicit uploads. A vision-capable model is required.</p></div> : <>
          <p className="ivr-summary">{review.summary}</p>
          {review.comparison_level === 'overview' && <div className="ivr-overview" role="status"><strong>{review.detail_status === 'unavailable' ? 'These two images are too different; a detailed point-to-point comparison is not available.' : review.detail_status === 'pending' ? 'Quick overview ready. Detailed comparison is still running.' : 'Quick overview retained. Detailed comparison could not be completed.'}</strong><p>Showing key observations without detailed highlight regions. Labeling consistency is not assessed in this overview.</p></div>}
          <label className="ivr-filter">Show<select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="all">All findings</option><option value="safety">Safety signals</option><option value="open">Unreviewed</option></select></label>
          <div className="ivr-finding-list">{visible.map(f => <button key={f.id} className={`ivr-finding ${selected === f.id ? 'is-selected' : ''} ${f.category === 'color' ? 'is-color' : ''}`} onClick={() => setSelected(f.id)} aria-pressed={selected === f.id}><span className="ivr-number">{f.id}</span><div><strong>{f.title}</strong><p>{f.observation}</p><span className="ivr-tag">{f.kind}</span><span className="ivr-tag">{f.priority}</span><span className="ivr-tag">{decisions[f.id]?.status || 'unreviewed'}</span></div></button>)}{!visible.length && <p className="ivr-source-note">No findings in this view. This does not establish absence of risk.</p>}</div>
          {current && <fieldset className="ivr-review-editors" disabled={busy}><FindingDetails finding={current} decision={decisions[current.id] || { status: 'unreviewed', note: '' }} onDecision={value => changeDecision(current.id, value)} onRegion={(side, region) => adjust(current.id, side, region)} /></fieldset>}
          <details className="ivr-limitations"><summary>Sources & limitations</summary><p>Model: {review.model}</p>{(['left', 'right'] as Side[]).map(side => <p key={side}>{side === 'left' ? 'A' : 'B'}: {review.sources[side].source} · {review.sources[side].filename}<br />SPL: {review.sources[side].spl_id || 'No reference'}<br />{review.sources[side].version_verified ? 'Local version-linked artwork' : 'Uploaded artwork; association unverified'}</p>)}{review.limitations.map((text, i) => <p key={i}>{text}</p>)}</details>
          <footer className="ivr-export"><button className="ivr-button" onClick={() => downloadReviewJson(review, decisions, lastTaskId)}>Export JSON</button><button className="ivr-button ivr-primary" disabled={exporting} onClick={async () => { setExporting(true); try { await downloadReviewHtml(review, decisions, { left: left.url, right: right.url }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setExporting(false); } }}>{exporting ? 'Exporting…' : 'Export annotated report'}</button><p>Decisions and adjusted regions stay in this session. Export to preserve them.</p></footer>
        </>}
      </aside>
    </div>
    <p className="ivr-footnote">Review signals require human confirmation. Highlight locations are AI estimates; unreadable or missing evidence is not a confirmed difference.</p>
  </main><Footer /></div>;
}

function FindingDetails({ finding, decision, onDecision, onRegion }: { finding: Finding; decision: Decision; onDecision: (value: Partial<Decision>) => void; onRegion: (side: Side, region: Region | null) => void }) {
  return <section className="ivr-details"><h3>Finding {finding.id} · Evidence</h3><p>Evidence confidence: {finding.confidence}</p>{finding.risk && <div className="ivr-risk"><strong>Potential error mechanism</strong><p>{finding.risk}</p></div>}
    {(['left', 'right'] as Side[]).map(side => <p key={side}><strong>{side === 'left' ? 'A' : 'B'}:</strong> {finding[`${side}_text`] || 'No transcribed evidence supplied.'}</p>)}
    {finding.label_evidence.map((e, i) => <blockquote key={i}><strong>{e.side} labeling reference</strong><p>{e.quote}</p></blockquote>)}
    <div className="ivr-decision"><button className="ivr-button" aria-pressed={decision.status === 'confirmed'} onClick={() => onDecision({ status: decision.status === 'confirmed' ? 'unreviewed' : 'confirmed' })}>Confirm</button><button className="ivr-button" aria-pressed={decision.status === 'dismissed'} onClick={() => onDecision({ status: decision.status === 'dismissed' ? 'unreviewed' : 'dismissed' })}>Dismiss</button></div>
    <label>Reviewer note<textarea rows={2} value={decision.note} onChange={e => onDecision({ note: e.target.value })} /></label>
    <details><summary>Adjust highlight regions</summary><p>Percentages relative to each full image. AI coordinates may need correction.</p>{(['left', 'right'] as Side[]).map(side => {
      const region = finding.regions[side];
      return <div className="ivr-region-editor" key={side}><strong>{side === 'left' ? 'A' : 'B'}</strong>{region ? <><div>{(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}>{key.toUpperCase()} %<input type="number" min="0" max="100" step="0.1" value={Math.round(region[key] * 1000) / 10} onChange={e => {
        const next = { ...region, [key]: Math.max(0, Math.min(1, Number(e.target.value) / 100)) };
        next.x = Math.min(.99, next.x); next.y = Math.min(.99, next.y);
        next.w = Math.max(.001, Math.min(1 - next.x, next.w)); next.h = Math.max(.001, Math.min(1 - next.y, next.h));
        onRegion(side, next);
      }} /></label>)}</div><button className="ivr-button" onClick={() => onRegion(side, null)}>Remove region</button></> : <button className="ivr-button" onClick={() => onRegion(side, { x: .1, y: .1, w: .2, h: .1 })}>Add region</button>}</div>;
    })}</details>
  </section>;
}

export default function ImageReviewPage() {
  return <RequireFeature feature="Labeling Visual Review" featureKey="tool_image_review"><Suspense fallback={<p>Loading visual review…</p>}><Workbench /></Suspense></RequireFeature>;
}
