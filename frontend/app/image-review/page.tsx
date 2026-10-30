'use client';
import { ServiceWarning } from '../platform/ServiceWarning';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '../components/Header';
import Footer from '../components/Footer';
import RequireFeature from '../components/RequireFeature';
import ArtworkPanel from './ArtworkPanel';
import CartonConfirmation from './CartonConfirmation';
import { CARTON_FIELDS, VISUAL_TASKS, type VisualTask, type CartonField, type CartonInputs, type Decision, type Finding, type Region, type Review, type ReviewComment, type ReviewMode, type Selection, type Side } from './types';
import { downloadReviewHtml, downloadReviewJson } from './exportReview';
import { labelcompRoute, imageReviewRoute } from '../platform/context';
import { useUser } from '../context/UserContext';
import './image-review.css';
import ReviewHistory from './ReviewHistory';
import ReadResult, { type ImageReading } from './ReadResult';

const EMPTY: Selection = { descriptor: {}, file: null, url: '', ready: false };

type ReviewDraft = { review: Review | null; selected: number | null; decisions: Record<number, Decision>;
  comments: ReviewComment[]; taskId: number | null; stage: 'prepare' | 'results' };

function Workbench() {
  const { session } = useUser();
  const canComment = session?.can_comment !== false && !session?.is_guest;
  const params = useSearchParams();
  const initialSources = useRef({ setIds: params.getAll('set_ids'), splIds: params.getAll('spl_ids'), imageIds: params.getAll('image_ids'), image: params.get('image') }).current;
  const canUseVisual = Boolean(session?.permissions?.tool_visual_analysis);
  const availableTasks = canUseVisual ? VISUAL_TASKS : [];
  const [mode, setMode] = useState<VisualTask>(() => {
    const requested = params.get('mode') || (initialSources.setIds.filter(Boolean).length > 1 ? 'artwork' : 'read');
    return availableTasks.find(task => task.id === requested)?.id || availableTasks[0]?.id || 'read';
  });
  const [taskPickerOpen, setTaskPickerOpen] = useState(!params.get('mode') && !params.has('set_ids'));
  const taskPickerVisible = taskPickerOpen && availableTasks.length > 1;
  const [stage, setStage] = useState<'prepare' | 'results'>('prepare');
  const [reading, setReading] = useState<ImageReading | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);
  const readingRevision = useRef(0);
  const drafts = useRef<Partial<Record<ReviewMode, ReviewDraft>>>({});
  const singleImage = mode === 'read' || mode === 'consistency';
  const activeTask = VISUAL_TASKS.find(task => task.id === mode)!;
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const busy = comparisonBusy || extracting || readingBusy || savingComment !== null;

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
    setStage('prepare');
  }, []);

  const onCartonChange = useCallback((value: CartonInputs | null) => {
    if (JSON.stringify(cartonInputsRef.current) === JSON.stringify(value)) return;
    cartonInputsRef.current = value;
    setCartonInputs(value);
    if (mode === 'confusion') invalidate();
    delete drafts.current.confusion;
  }, [invalidate, mode]);

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

  const paramTaskId = useRef(params.get('task_id')).current;
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
      drafts.current = {};
      setReading(null);
      invalidate();
    }
    setLeft(value);
  }, [invalidate]);

  const onRight = useCallback((value: Selection) => {
    const key = JSON.stringify(value.descriptor) + value.url;
    if (currentSources.current.right !== key) {
      currentSources.current.right = key;
      delete drafts.current.artwork;
      delete drafts.current.confusion;
      if (mode === 'artwork' || mode === 'confusion') invalidate();
    }
    setRight(value);
  }, [invalidate, mode]);

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
          setStage('results');
          setSelected(current => data.result.findings.some((finding: Finding) => finding.id === current) ? current : null);
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

  const readImage = async () => {
    if (!canUseVisual || !left.ready || busy) return;
    readingRevision.current++;
    setReadingBusy(true); setError('');
    try {
      let response: Response;
      if (left.file) {
        const form = new FormData(); form.set('image', left.file);
        form.set('force', reading ? 'true' : 'false');
        response = await fetch('/api/image-analysis/read', { method: 'POST', body: form });
      } else {
        response = await fetch(`/api/image-analysis/${encodeURIComponent(left.descriptor.set_id!)}/process`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_id: left.descriptor.image_id, spl_id: left.descriptor.spl_id, force: !!reading }),
        });
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not read this image.');
      setReading(body); setStage('results'); updateWorkspaceUrl('read');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setReadingBusy(false); }
  };

  // Reuse existing saved readings without starting an AI call.
  useEffect(() => {
    if (!canUseVisual || left.file || !left.descriptor.set_id || !left.descriptor.image_id) return;
    const controller = new AbortController();
    const revision = readingRevision.current;
    const query = new URLSearchParams();
    if (left.descriptor.spl_id) query.set('spl_id', left.descriptor.spl_id);
    fetch(`/api/image-analysis/${encodeURIComponent(left.descriptor.set_id)}/process/${encodeURIComponent(left.descriptor.image_id)}?${query}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted && revision === readingRevision.current && body?.cached && body.result) setReading(body); })
      .catch(() => { /* Saved readings are optional. */ });
    return () => controller.abort();
  }, [canUseVisual, left.file, left.descriptor.set_id, left.descriptor.spl_id, left.descriptor.image_id]);

  const updateWorkspaceUrl = (nextMode: VisualTask, nextTaskId?: number) => {
    const selections = right.file || right.descriptor.set_id || right.descriptor.image_id ? [left, right] : [left];
    const route = imageReviewRoute({
      setIds: selections.map(value => value.descriptor.set_id || ''),
      splIds: selections.map(value => value.descriptor.spl_id || ''),
    }, { mode: nextMode, imageIds: selections.map(value => value.file ? '' : value.descriptor.image_id || ''), taskId: nextTaskId });
    const url = new URL(window.location.href);
    url.search = route.split('?')[1] || '';
    window.history.replaceState(null, '', url);
  };

  const chooseTask = (next: VisualTask) => {
    if (busy || !availableTasks.some(task => task.id === next)) return;
    if (mode !== 'read') drafts.current[mode] = {
      review, selected, decisions, comments: allComments, taskId: lastTaskId, stage,
    };
    const draft = next === 'read' ? undefined : drafts.current[next];
    setMode(next); setTaskPickerOpen(false); setError('');
    setReview(draft?.review || null); setSelected(draft?.selected ?? null);
    setDecisions(draft?.decisions || {}); setAllComments(draft?.comments || []);
    setLastTaskId(draft?.taskId || null);
    setStage(next === 'read' ? (reading ? 'results' : 'prepare') : draft?.stage || 'prepare');
    updateWorkspaceUrl(next, draft?.taskId || undefined);
  };

  const run = async () => {
    if (mode === 'read') { await readImage(); return; }
    if (!canUseVisual) return;
    if (mode === 'confusion' && !cartonInputs) return;
    if (mode === 'consistency') {
      if (!left.ready || !left.descriptor.set_id || busy) return;
    } else {
      if (!left.ready || !right.ready || busy) return;
    }

    setSubmitting(true);
    setError('');
    setProgress({ value: 0, message: session?.is_guest ? 'Analyzing your images…' : 'Preparing your analysis…' });
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
      if (data.synchronous && data.result) {
        setReview(data.result); setSelected(null); setLastTaskId(null); setAllComments([]);
        setStage('results'); updateWorkspaceUrl(mode);
        return;
      }
      setProgress({ value: 0, message: 'Your analysis is queued.' });
      setStage('results');
      setLastTaskId(data.task_id);
      setTaskId(data.task_id);
      updateWorkspaceUrl(mode, data.task_id);
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
    if (!singleImage && right.descriptor?.set_id) {
      list.push(right.descriptor.set_id);
    }
    if (list.length === 0) {
      return params.getAll('set_ids');
    }
    return list;
  }, [left.descriptor?.set_id, right.descriptor?.set_id, singleImage, params]);

  const activeSplIds = useMemo(() => {
    const list: string[] = [];
    if (left.descriptor?.spl_id) {
      list.push(left.descriptor.spl_id);
    }
    if (!singleImage && right.descriptor?.spl_id) {
      list.push(right.descriptor.spl_id);
    }
    if (list.length === 0) {
      return params.getAll('spl_ids');
    }
    return list;
  }, [left.descriptor?.spl_id, right.descriptor?.spl_id, singleImage, params]);

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

  const canRun = !busy && (mode === 'read' ? canUseVisual && left.ready
    : canUseVisual && (mode !== 'confusion' || cartonInputs !== null)
      && (mode === 'consistency' ? left.ready && !!left.descriptor.set_id : left.ready && right.ready));
  const hasResult = mode === 'read' ? !!reading : !!review;
  const runLabel = mode === 'read' ? (reading ? 'Read image again' : 'Read image')
    : mode === 'consistency' ? 'Check labeling consistency'
      : mode === 'confusion' ? 'Compare confusion factors' : 'Compare artwork';
  const nextStep = mode === 'read' ? 'Choose one image to read.'
    : mode === 'consistency' ? (!left.descriptor.set_id ? 'Choose the official labeling to use as the reference.' : 'Select or upload the image to check.')
      : !left.ready || !right.ready ? 'Choose image A and image B.'
        : mode === 'confusion' && !cartonInputs ? 'Identify and confirm both products below.' : 'Your images are ready.';

  return (
    <div className="ivr-page">
      <Header />
      <main className="ivr-main">
        <header className="ivr-page-heading">
          <div><span className="ivr-eyebrow">IMAGE WORKSPACE</span><h1>Visual Analysis</h1>
            <p>Start with an image. Choose what you want to learn.</p></div>
          <div className="ivr-heading-actions">
            <ServiceWarning toolId="label-image-review" compact />
            {canUseVisual && !session?.is_guest && <button type="button" className="ivr-button" disabled={busy} onClick={() => setHistoryOpen(value => !value)}>
              {historyOpen ? 'Back to workspace' : 'History'}
            </button>}
          </div>
        </header>
        {historyOpen && <ReviewHistory onClose={() => setHistoryOpen(false)} />}
        <div hidden={historyOpen} className="va-workbench">
        <section className="va-task-section" aria-label="Analysis task">
          <div className="va-task-current"><div><span className="va-step-number">1</span><strong>{activeTask.label}</strong><span className="va-task-needs">{activeTask.needs}</span></div>
            {availableTasks.length > 1 && <button className="ivr-button" disabled={busy} onClick={() => setTaskPickerOpen(value => !value)} aria-expanded={taskPickerVisible} aria-controls="va-task-picker">
              {taskPickerVisible ? 'Close task chooser' : 'Change task'}
            </button>}</div>
          <div id="va-task-picker" className="va-task-picker" hidden={!taskPickerVisible}>
            {availableTasks.map(task => <button key={task.id} className={`va-task-card ${mode === task.id ? 'is-active' : ''}`}
              aria-pressed={mode === task.id} disabled={busy} onClick={() => chooseTask(task.id)}>
              <span>{task.needs}</span><strong>{task.label}</strong><p>{task.description}</p>
            </button>)}
          </div>
          {!taskPickerVisible && <p className="va-task-description">{activeTask.description}</p>}
        </section>
        <div className="va-stage-bar">
          <nav aria-label="Workspace step"><button aria-current={stage === 'prepare' ? 'step' : undefined} onClick={() => setStage('prepare')}><span className="va-step-number">2</span>Prepare images</button>
            <button aria-current={stage === 'results' ? 'step' : undefined} disabled={!hasResult && !comparisonBusy} onClick={() => setStage('results')}><span className="va-step-number">3</span>Results</button></nav>
          <div className="va-stage-actions"><details className="va-view-options"><summary>View options</summary><div>
            {!singleImage && <label><input type="checkbox" checked={sync} onChange={e => { setSync(e.target.checked); if (e.target.checked) setZooms({ left: zooms.left, right: zooms.left }); }} /> Sync zoom</label>}
            {mode !== 'read' && <label><input type="checkbox" checked={highlights} onChange={e => setHighlights(e.target.checked)} /> Show finding markers</label>}
            <button className="ivr-button" onClick={handleOpenLabelcomp}>Open Label Comparison ↗</button>
          </div></details>
            <button className="ivr-button ivr-primary" disabled={!canRun} onClick={() => void run()}>{busy ? 'Analyzing…' : runLabel}</button>
          </div>
        </div>
        {stage === 'prepare' && <p className="va-next-step" role="status">{busy ? 'Analysis in progress. Your images remain available.' : canRun ? 'Your images are ready.' : nextStep}</p>}

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



        {comparisonBusy && (
          <div className="ivr-status" role="status">
            {mode === 'confusion' ? <progress aria-label="Comparing packaging images" /> : <progress max="100" value={progress.value} />}
            <span>
              {progress.message || 'Analyzing artwork…'} · {elapsed}s elapsed
              {elapsed >= 15 && progress.value === 0 && !session?.is_guest
                ? ' · Waiting for the review worker to pick up this task.'
                : ''}
            </span>
          </div>
        )}

        <div className={`ivr-workspace va-workspace ${singleImage ? 'va-single' : 'va-double'} ${stage === 'results' ? 'va-has-results' : 'va-preparing'}`}>
          <div className={`va-images ${singleImage ? 'va-single' : 'va-double'}`}>
            <ArtworkPanel side="left" mode={mode}
              initialSetId={initialSources.setIds[0] || ''} initialSplId={initialSources.splIds[0] || ''}
              initialImage={initialSources.image || undefined} initialImageId={initialSources.imageIds[0]}
              busy={busy} findings={mode === 'read' ? [] : drawn} selected={selected} highlights={highlights}
              zoom={zooms.left} onZoom={zoom => changeZoom('left', zoom)} onSelect={handleSelectFinding} onChange={onLeft} />
            <div hidden={singleImage} className="va-second-image">
              <ArtworkPanel side="right" mode={mode}
                initialSetId={initialSources.setIds[1] || ''} initialSplId={initialSources.splIds[1] || ''} initialImageId={initialSources.imageIds[1]}
                busy={busy} findings={drawn} selected={selected} highlights={highlights}
                zoom={zooms.right} onZoom={zoom => changeZoom('right', zoom)} onSelect={handleSelectFinding} onChange={onRight} />
            </div>
          </div>
          <aside className="ivr-findings va-results" hidden={stage !== 'results'} aria-label="Analysis results" aria-live="polite">
          {mode === 'read' ? (reading && <ReadResult reading={reading} />) : <>

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
              <div className="ivr-findings-empty"><strong>{comparisonBusy ? 'Your analysis is in progress' : 'No results yet'}</strong>
                <p>{comparisonBusy ? 'You can inspect the images while the results are prepared.' : 'Prepare your images and run the selected analysis.'}</p></div>
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
                    <strong>{mode === 'consistency' ? 'No discrepancies identified' : 'No differences identified'}</strong>
                    <p>{mode === 'consistency' ? 'No supported discrepancies were identified in the reviewed image and labeling reference.' : 'No supported differences were identified in these images.'}</p>
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

                    <p className="ivr-source-note">Select a finding to review its evidence.</p>
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

                            <span className="ivr-tag ivr-priority-tag" data-priority={f.priority}>
                              {f.priority}
                            </span>
                            {decisions[f.id]?.status && decisions[f.id]?.status !== 'unreviewed' && <span className="ivr-tag">{decisions[f.id].status}</span>}
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
                      key={current.id}
                      mode={mode as ReviewMode}
                      finding={current}
                      decision={decisions[current.id] || { status: 'unreviewed', note: '', is_public: false }}
                      teamComments={allComments.filter(c => c.finding_id === current.id && !c.is_mine && c.is_public)}
                      lastTaskId={lastTaskId}
                      saving={savingComment === current.id}
                      canComment={canComment}
                      guest={Boolean(session?.is_guest)}
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

                <details className="va-export"><summary>Export results</summary><footer className="ivr-export">
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
                  <p>{session?.is_guest ? 'This analysis stays in this window. Export a report to keep a copy.' : 'Export a report with your findings and saved decisions.'}</p>
                </footer></details>
              </>
            )}
          </>}
          </aside>
        </div>
        {canUseVisual && <div hidden={mode !== 'confusion' || !left.ready || !right.ready} className="va-confirmation">
          <CartonConfirmation left={left} right={right} disabled={comparisonBusy}
            comparing={comparisonBusy} hasResult={mode === 'confusion' && !!review}
            onChange={onCartonChange} onBusy={setExtracting} />
        </div>}
        <p className="ivr-footnote">
          Review signals require human confirmation. Highlight locations are AI estimates; missing information does not guarantee absence of conflict.
        </p>
        </div>
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
  guest = false,
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
  guest?: boolean;
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

      {!canComment && !guest && (
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

      {!guest && <details className="va-review-actions"><summary>Review decision & comment</summary>
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

      <p className="ivr-comment-visibility-hint">🔒 This review and its comments are private to your account.</p>

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

      </details>}
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
    <RequireFeature feature="Visual Analysis" featureKey="tool_visual_analysis">
      <Suspense fallback={<p>Loading Visual Analysis…</p>}>
        <Workbench />
      </Suspense>
    </RequireFeature>
  );
}
