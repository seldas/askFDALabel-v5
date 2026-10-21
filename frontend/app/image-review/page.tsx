'use client';
import { ServiceWarning } from '../platform/ServiceWarning';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '../components/Header';
import Footer from '../components/Footer';
import RequireFeature from '../components/RequireFeature';
import ArtworkPanel from './ArtworkPanel';
import CartonConfirmation from './CartonConfirmation';
import { CARTON_FIELDS, MODES, type CartonField, type CartonInputs, type Decision, type Finding, type Region, type Review, type ReviewComment, type ReviewMode, type Selection, type Side } from './types';
import { downloadReviewHtml, downloadReviewJson } from './exportReview';
import { labelcompRoute } from '../platform/context';
import { useUser } from '../context/UserContext';
import './image-review.css';

const EMPTY: Selection = { descriptor: {}, file: null, url: '', ready: false };

function Workbench() {
  const { session } = useUser();
  const canComment = session?.can_comment !== false;
  const params = useSearchParams();
  const [mode, setMode] = useState<ReviewMode>('consistency');
  const [left, setLeft] = useState<Selection>(EMPTY);
  const [right, setRight] = useState<Selection>(EMPTY);
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [allComments, setAllComments] = useState<ReviewComment[]>([]);
  const [savingComment, setSavingComment] = useState<number | null>(null);
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
  const [extracting, setExtracting] = useState(false);
  const [cartonInputs, setCartonInputs] = useState<CartonInputs | null>(null);
  const cartonInputsRef = useRef<CartonInputs | null>(null);

  const comparisonBusy = submitting || taskId !== null;
  const busy = comparisonBusy || extracting;

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
    setAllComments([]);
    setLastTaskId(null);
    setError('');
  }, []);

  const onCartonChange = useCallback((value: CartonInputs | null) => {
    if (JSON.stringify(cartonInputsRef.current) === JSON.stringify(value)) return;
    cartonInputsRef.current = value;
    setCartonInputs(value);
    invalidate();
  }, [invalidate]);

  const fetchComments = useCallback(async (tid: number) => {
    try {
      const response = await fetch(`/api/image-review/reviews/${tid}/comments`);
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.comments)) {
        setAllComments(data.comments);
        const myDecisions: Record<number, Decision> = {};
        for (const c of data.comments) {
          if (c.is_mine) {
            myDecisions[c.finding_id] = {
              status: c.decision,
              note: c.comment,
              is_public: c.is_public,
              saved: true,
            };
          }
        }
        setDecisions(current => {
          const next = { ...current };
          for (const [idStr, dec] of Object.entries(myDecisions)) {
            const fid = Number(idStr);
            if (!next[fid] || (next[fid].status === 'unreviewed' && !next[fid].note)) {
              next[fid] = dec;
            } else {
              next[fid] = { ...dec, ...next[fid], saved: true };
            }
          }
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to load review comments:', err);
    }
  }, []);

  const paramTaskId = params.get('task_id');
  useEffect(() => {
    if (paramTaskId) {
      const tid = parseInt(paramTaskId, 10);
      if (!isNaN(tid)) {
        setLastTaskId(tid);
        setTaskId(tid);
      }
    }
  }, [paramTaskId]);

  useEffect(() => {
    if (lastTaskId && !taskId) {
      void fetchComments(lastTaskId);
    }
  }, [lastTaskId, taskId, fetchComments]);

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
        if (data.result && Array.isArray(data.result.findings)) {
          if (data.result.mode) setMode(data.result.mode);
          setReview(data.result);
          setSelected(current => current ?? data.result.findings[0]?.id ?? null);
          void fetchComments(taskId);
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
  }, [taskId, fetchComments]);

  const run = async () => {
    if (mode === 'confusion' && !cartonInputs) return;
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
      if (mode === 'confusion') form.set('carton_inputs', JSON.stringify(cartonInputs));
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
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href);
        u.searchParams.set('task_id', String(data.task_id));
        window.history.replaceState(null, '', u.toString());
      }
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
      [id]: { ...(current[id] || { status: 'unreviewed', note: '', is_public: false }), ...change },
    }));

  const saveDecisionToDb = useCallback(
    async (findingId: number, customDecision?: Partial<Decision>) => {
      if (!lastTaskId) return;
      if (!canComment) {
        alert('Commenting has been disabled for your account by an administrator.');
        return;
      }
      const base = decisions[findingId] || { status: 'unreviewed', note: '', is_public: false };
      const current = customDecision ? { ...base, ...customDecision } : base;

      setSavingComment(findingId);
      try {
        const response = await fetch(`/api/image-review/reviews/${lastTaskId}/comments/${findingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            finding_id: findingId,
            decision: current.status,
            comment: current.note,
            is_public: current.is_public ?? false,
            set_id: left.descriptor?.set_id || null,
          }),
        });
        if (response.ok) {
          setDecisions(prev => ({
            ...prev,
            [findingId]: { ...current, saved: true },
          }));
          await fetchComments(lastTaskId);
        } else {
          const data = await response.json().catch(() => ({}));
          if (data.error) alert(data.error);
        }
      } catch (e) {
        console.error('Failed to save comment to database:', e);
      } finally {
        setSavingComment(null);
      }
    },
    [lastTaskId, canComment, decisions, left.descriptor?.set_id, fetchComments]
  );

  const deleteCommentFromDb = useCallback(
    async (findingId: number) => {
      if (!lastTaskId) return;
      if (!canComment) {
        alert('Commenting has been disabled for your account by an administrator.');
        return;
      }
      setSavingComment(findingId);
      try {
        const response = await fetch(`/api/image-review/reviews/${lastTaskId}/comments/${findingId}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          setDecisions(prev => ({
            ...prev,
            [findingId]: { status: 'unreviewed', note: '', is_public: false, saved: false },
          }));
          await fetchComments(lastTaskId);
        } else {
          const data = await response.json().catch(() => ({}));
          if (data.error) alert(data.error);
        }
      } catch (e) {
        console.error('Failed to delete comment from database:', e);
      } finally {
        setSavingComment(null);
      }
    },
    [lastTaskId, canComment, fetchComments]
  );

  const handleSelectFinding = useCallback((id: number) => {
    setSelected(current => (current === id ? null : id));
  }, []);

  useEffect(() => {
    if (selected === null) return;
    const item = document.querySelector(`[data-finding-row="${selected}"]`);
    if (item) {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selected]);

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

  // Set window name on mount so labelcomp can reuse/focus this window
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.name = 'fdalabel_image_review';
    }
  }, []);

  const activeSetIds = useMemo(() => {
    const list: string[] = [];
    if (left.descriptor?.set_id) {
      list.push(left.descriptor.set_id);
    }
    if (mode !== 'consistency' && right.descriptor?.set_id) {
      list.push(right.descriptor.set_id);
    }
    if (list.length === 0) {
      return params.getAll('set_ids');
    }
    return list;
  }, [left.descriptor?.set_id, right.descriptor?.set_id, mode, params]);

  const activeSplIds = useMemo(() => {
    const list: string[] = [];
    if (left.descriptor?.spl_id) {
      list.push(left.descriptor.spl_id);
    }
    if (mode !== 'consistency' && right.descriptor?.spl_id) {
      list.push(right.descriptor.spl_id);
    }
    if (list.length === 0) {
      return params.getAll('spl_ids');
    }
    return list;
  }, [left.descriptor?.spl_id, right.descriptor?.spl_id, mode, params]);

  const handleOpenLabelcomp = () => {
    const url = labelcompRoute({
      setIds: activeSetIds.slice(0, 4),
      splIds: activeSplIds.slice(0, 4),
    });
    const target = window.open(url, 'fdalabel_labelcomp');
    if (target) {
      target.focus();
    }
  };

  const canRun =
    !busy &&
    (mode !== 'confusion' || cartonInputs !== null) &&
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
          <div className="ivr-heading-actions">
            <ServiceWarning toolId="label-image-review" compact />
            <button
              type="button"
              className="ivr-button"
              onClick={handleOpenLabelcomp}
              title={
                activeSetIds.length > 0
                  ? `Compare ${activeSetIds.length === 1 ? 'this label' : 'these 2 labels'} in LabelComp`
                  : 'Open Label Comparison (LabelComp)'
              }
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                <path d="M16 3h5v5" />
                <path d="M4 20L21 3" />
                <path d="M21 16v5h-5" />
                <path d="M15 15l6 6" />
                <path d="M4 4l5 5" />
              </svg>
              Compare in LabelComp
            </button>
            <button className="ivr-button ivr-primary" disabled={!canRun} onClick={() => void run()}>
              {busy
                ? 'Audit in progress…'
                : mode === 'confusion'
                ? 'Confirm and compare'
                : review
                ? 'Run audit again'
                : mode === 'consistency'
                ? 'Check Labeling Consistency'
                : 'Run visual review'}
            </button>
          </div>
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
                  setCartonInputs(null);
                  cartonInputsRef.current = null;
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

        {mode === 'confusion' && <CartonConfirmation left={left} right={right} disabled={comparisonBusy}
          comparing={comparisonBusy} hasResult={!!review} canCompare={canRun} onCompare={() => void run()}
          onChange={onCartonChange} onBusy={setExtracting} />}

        {comparisonBusy && (
          <div className="ivr-status" role="status">
            {mode === 'confusion' ? <progress aria-label="Comparing packaging images" /> : <progress max="100" value={progress.value} />}
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
                onSelect={handleSelectFinding}
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
                onSelect={handleSelectFinding}
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
                onSelect={handleSelectFinding}
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
                ) : mode === 'confusion' ? (
                  <>
                    <strong>Packaging product confusion review</strong>
                    <p>Select matching packaging image types, identify A and B, and confirm the extracted information above. The comparison will explain visual similarities, overlooked distinctions and protective design factors.</p>
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

                {review.mode === 'confusion' && <>
                  {review.assessment && <p className="ivr-overview"><strong>{({ clear_factors: 'Clear confusion factors identified', some_factors: 'Some confusion factors identified', no_obvious_factors: 'No obvious confusion factors in the selected images', insufficient_information: 'Insufficient information' } as Record<string, string>)[review.assessment] || review.assessment}</strong></p>}
                  {!!review.distinguishing_factors?.length && <section><h3>Distinguishing factors</h3><ul>{review.distinguishing_factors.map((text, i) => <li key={i}>{text}</li>)}</ul></section>}
                  {review.carton_inputs && <details className="ivr-limitations"><summary>Confirmed product information</summary>
                    <table className="ivr-carton-table"><thead><tr><th>Field</th><th>Product A</th><th>Product B</th></tr></thead><tbody>
                      {(Object.keys(CARTON_FIELDS) as CartonField[]).map(key => <tr key={key}><th>{CARTON_FIELDS[key]}</th>{(['left', 'right'] as Side[]).map(side => {
                        const field = review.carton_inputs![side].confirmed_fields[key];
                        return <td key={side}>{field.value || 'Unknown'}{field.source === 'user_provided' && <small> User provided</small>}</td>;
                      })}</tr>)}
                    </tbody></table>
                  </details>}
                </>}

                {review.findings.length === 0 && review.mode !== 'confusion' && (
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
                          data-finding-row={f.id}
                          className={`ivr-finding ${selected === f.id ? 'is-selected' : ''} ${
                            f.category === 'color' ? 'is-color' : ''
                          }`}
                          onClick={() => handleSelectFinding(f.id)}
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
                      decision={decisions[current.id] || { status: 'unreviewed', note: '', is_public: false }}
                      teamComments={allComments.filter(c => c.finding_id === current.id && !c.is_mine && c.is_public)}
                      lastTaskId={lastTaskId}
                      saving={savingComment === current.id}
                      canComment={canComment}
                      onDecision={value => changeDecision(current.id, value)}
                      onSaveToDb={change => saveDecisionToDb(current.id, change)}
                      onDeleteFromDb={() => deleteCommentFromDb(current.id)}
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
                  <p>Decisions and comments are saved to the database. Export anytime to download full audit reports.</p>
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
  teamComments,
  lastTaskId,
  saving,
  canComment = true,
  onDecision,
  onSaveToDb,
  onDeleteFromDb,
  onRegion,
}: {
  mode: ReviewMode;
  finding: Finding;
  decision: Decision;
  teamComments: ReviewComment[];
  lastTaskId: number | null;
  saving: boolean;
  canComment?: boolean;
  onDecision: (value: Partial<Decision>) => void;
  onSaveToDb: (change?: Partial<Decision>) => Promise<void>;
  onDeleteFromDb: () => Promise<void>;
  onRegion: (side: Side, region: Region | null) => void;
}) {
  const isConsistency = mode === 'consistency';
  const [showAllComments, setShowAllComments] = useState(false);

  useEffect(() => {
    setShowAllComments(false);
  }, [finding.id]);

  const displayedComments = showAllComments ? teamComments : teamComments.slice(0, 1);

  return (
    <section className="ivr-details">
      <header className="ivr-details-header">
        <h3>Finding {finding.id} · {finding.title}</h3>
        <span className="ivr-confidence">Confidence: {finding.confidence}</span>
      </header>

      {!canComment && (
        <div className="ivr-comment-disabled-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Commenting and clinical justifications have been disabled for your account by an administrator.</span>
        </div>
      )}

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
          type="button"
          className="ivr-button"
          disabled={!canComment}
          title={!canComment ? 'Commenting and decisions disabled for your account' : undefined}
          aria-pressed={decision.status === 'confirmed'}
          onClick={() => {
            if (!canComment) return;
            const nextStatus = decision.status === 'confirmed' ? 'unreviewed' : 'confirmed';
            onDecision({ status: nextStatus, saved: false });
            if (lastTaskId) {
              void onSaveToDb({ status: nextStatus });
            }
          }}
        >
          ✓ Confirm Finding
        </button>
        <button
          type="button"
          className="ivr-button"
          disabled={!canComment}
          title={!canComment ? 'Commenting and decisions disabled for your account' : undefined}
          aria-pressed={decision.status === 'dismissed'}
          onClick={() => {
            if (!canComment) return;
            const nextStatus = decision.status === 'dismissed' ? 'unreviewed' : 'dismissed';
            onDecision({ status: nextStatus, saved: false });
            if (lastTaskId) {
              void onSaveToDb({ status: nextStatus });
            }
          }}
        >
          ✕ Dismiss
        </button>
      </div>

      <div className="ivr-comment-visibility">
        <label className="ivr-visibility-option" title="Private comments are visible only to your personal account">
          <input
            type="radio"
            name={`visibility-${finding.id}`}
            checked={!decision.is_public}
            disabled={!canComment}
            onChange={() => {
              if (!canComment) return;
              onDecision({ is_public: false, saved: false });
              if (lastTaskId) {
                void onSaveToDb({ is_public: false });
              }
            }}
          />
          <span>🔒 Private (Only me)</span>
        </label>
        <label className="ivr-visibility-option" title="Public comments are visible to all users, showing your name">
          <input
            type="radio"
            name={`visibility-${finding.id}`}
            checked={!!decision.is_public}
            disabled={!canComment}
            onChange={() => {
              if (!canComment) return;
              onDecision({ is_public: true, saved: false });
              if (lastTaskId) {
                void onSaveToDb({ is_public: true });
              }
            }}
          />
          <span>🌐 Public (Visible to all)</span>
        </label>
      </div>
      <p className="ivr-comment-visibility-hint">
        {decision.is_public
          ? '🌐 Public: Visible to all reviewers and colleagues with your name.'
          : '🔒 Private (Default): Saved to database, visible only to your personal account.'}
      </p>

      <label>
        Reviewer comment / justification note
        <textarea
          rows={3}
          placeholder={!canComment ? 'Commenting has been disabled for your account.' : 'Add comments or clinical verification notes…'}
          value={decision.note || ''}
          disabled={!canComment}
          onChange={e => onDecision({ note: e.target.value, saved: false })}
          onBlur={() => {
            if (!canComment) return;
            if (lastTaskId && !decision.saved && decision.note?.trim()) {
              void onSaveToDb();
            }
          }}
        />
      </label>

      <div className="ivr-comment-actions">
        <button
          type="button"
          className={`ivr-button ivr-save-comment-btn ${decision.saved ? 'is-saved' : 'ivr-primary'}`}
          disabled={!canComment || saving || !lastTaskId}
          onClick={() => void onSaveToDb()}
          title={!canComment ? 'Commenting is disabled for your account' : !lastTaskId ? 'Run visual review to save to database' : 'Save comment and decision to database'}
        >
          {saving ? 'Saving…' : decision.saved ? '✓ Saved to DB' : 'Save Comment & Decision'}
        </button>
        {decision.saved && (
          <button
            type="button"
            className="ivr-button ivr-delete-comment-btn"
            disabled={!canComment || saving}
            onClick={() => void onDeleteFromDb()}
            title={!canComment ? 'Commenting is disabled for your account' : 'Delete your saved comment and reset decision'}
          >
            Clear / Delete
          </button>
        )}
      </div>

      {teamComments.length > 0 && (
        <div className="ivr-team-comments">
          <div className="ivr-team-comments-header">
            <h4>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Team Reviews & Public Comments ({teamComments.length})
            </h4>
            {teamComments.length > 1 && (
              <button
                type="button"
                className="ivr-more-comments-btn"
                onClick={() => setShowAllComments(prev => !prev)}
                title={showAllComments ? 'Collapse to 1 comment' : 'Show all comments'}
              >
                {showAllComments ? 'Less' : `More (${teamComments.length - 1})`}
              </button>
            )}
          </div>
          <div className="ivr-team-comments-list">
            {displayedComments.map(c => (
              <div key={c.id} className="ivr-team-comment-item">
                <div className="ivr-team-comment-header">
                  <span className="ivr-comment-author">
                    <strong>@{c.display_name || c.username}</strong>
                    <span className="ivr-badge-public">Public</span>
                  </span>
                  <span className={`ivr-comment-decision is-${c.decision}`}>
                    {c.decision === 'confirmed' ? '✓ Confirmed' : c.decision === 'dismissed' ? '✕ Dismissed' : 'Unreviewed'}
                  </span>
                  {c.updated_at && (
                    <span className="ivr-comment-time">
                      {new Date(c.updated_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
                {c.comment && <p className="ivr-comment-body">{c.comment}</p>}
              </div>
            ))}
          </div>
          {teamComments.length > 1 && !showAllComments && (
            <button
              type="button"
              className="ivr-more-comments-link"
              onClick={() => setShowAllComments(true)}
            >
              + {teamComments.length - 1} more…
            </button>
          )}
        </div>
      )}

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
