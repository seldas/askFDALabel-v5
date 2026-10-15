'use client';

import { useEffect, useRef, useState } from 'react';
import { CARTON_FIELDS, type CartonExtraction, type CartonField, type CartonInputs, type Selection, type Side } from './types';

type Identified = { key: string; task_id: number; extraction?: CartonExtraction; error?: string; fields: Record<CartonField, string>; acknowledged: boolean };
const SIDES: Side[] = ['left', 'right'];
const keys = Object.keys(CARTON_FIELDS) as CartonField[];
const sourceKey = (value: Selection) => JSON.stringify(value.descriptor) + value.url;

export default function CartonConfirmation({ left, right, disabled, comparing, hasResult, canCompare, onCompare, onChange, onBusy }: {
  left: Selection; right: Selection; disabled: boolean; comparing: boolean; hasResult: boolean;
  canCompare: boolean; onCompare: () => void;
  onChange: (value: CartonInputs | null) => void; onBusy: (value: boolean) => void;
}) {
  const [records, setRecords] = useState<Partial<Record<Side, Identified>>>({});
  const [task, setTask] = useState<{ id: number; sides: Side[]; keys: Partial<Record<Side, string>> } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const selections = { left, right };
  const leftKey = sourceKey(left), rightKey = sourceKey(right);
  const callbacks = useRef({ onBusy, onChange });
  callbacks.current = { onBusy, onChange };
  const active = submitting || (task !== null && !paused);

  useEffect(() => {
    callbacks.current.onBusy(active);
    if (!active) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => () => callbacks.current.onBusy(false), []);

  useEffect(() => {
    setRecords(prev => {
      const next = { ...prev };
      if (next.left?.key !== leftKey) delete next.left;
      if (next.right?.key !== rightKey) delete next.right;
      return next;
    });
  }, [leftKey, rightKey]);

  useEffect(() => {
    const a = records.left, b = records.right;
    const ready = a?.key === leftKey && b?.key === rightKey && a?.extraction && b?.extraction
      && a.extraction.suitability !== 'unsupported' && b.extraction.suitability !== 'unsupported'
      && a.acknowledged && b.acknowledged && left.ready && right.ready && !task;
    callbacks.current.onChange(ready ? {
      left: { task_id: a.task_id, fields: a.fields, acknowledged: true },
      right: { task_id: b.task_id, fields: b.fields, acknowledged: true },
    } : null);
  }, [records, leftKey, rightKey, left.ready, right.ready, task]);

  useEffect(() => {
    if (!task || paused) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let errors = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/image-review/reviews/${task.id}`, { signal: controller.signal });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not check carton identification.');
        errors = 0;
        for (const side of task.sides) {
          const value = data.result?.cartons?.[side];
          if (!value) continue;
          setRecords(prev => {
            if (prev[side]?.task_id === task.id) return prev;
            const extraction = value.extraction as CartonExtraction | undefined;
            return { ...prev, [side]: { key: task.keys[side]!, task_id: task.id, extraction,
              error: value.error, acknowledged: false,
              fields: Object.fromEntries(keys.map(key => [key, extraction?.fields[key]?.value || ''])) as Record<CartonField, string> } };
          });
        }
        if (data.status === 'completed' || data.status === 'failed') {
          setTask(null);
          if (data.status === 'failed') setError(data.error || 'Identification failed. Retry the remaining product.');
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (++errors >= 3) {
          setError(`${e instanceof Error ? e.message : String(e)} Identification may still be running. Resume the status check before starting another task.`);
          setPaused(true);
          return;
        }
      }
      timer = setTimeout(poll, 1800);
    };
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [task, paused]);

  const identify = async (sides: Side[]) => {
    if (active || disabled || task) return;
    setSubmitting(true); setElapsed(0); setError('');
    try {
      const form = new FormData();
      const submittedKeys: Partial<Record<Side, string>> = {};
      for (const side of sides) {
        const value = selections[side];
        form.set(side, JSON.stringify(value.descriptor));
        if (value.file) form.set(`${side}_upload`, value.file);
        submittedKeys[side] = sourceKey(value);
      }
      const response = await fetch('/api/image-review/cartons/extractions', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not identify cartons.');
      setRecords(prev => { const next = { ...prev }; sides.forEach(side => delete next[side]); return next; });
      setTask({ id: data.task_id, sides, keys: submittedKeys });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  };
  const missing = SIDES.filter(side => selections[side].ready && (!records[side]?.extraction || records[side]?.key !== sourceKey(selections[side])));
  const locked = disabled || active || task !== null;
  const edit = (side: Side, change: Partial<Identified>) => setRecords(prev => ({ ...prev, [side]: { ...prev[side]!, ...change } }));

  return <section className="ivr-carton-flow" aria-label="Package carton review steps">
    <ol className="ivr-carton-steps">
      <li aria-current={!left.ready || !right.ready ? 'step' : undefined}>1. Select cartons</li>
      <li aria-current={left.ready && right.ready && !comparing && !hasResult ? 'step' : undefined}>2. Identify & confirm</li>
      <li aria-current={comparing || hasResult ? 'step' : undefined}>3. Compare confusion factors</li>
    </ol>
    <details open={!comparing && !hasResult}>
    <summary>Carton identification & confirmation</summary>
    <p>Select one package carton per product below, preferably the same face (front to front). Unfolded cartons are supported. IFU, chemical structures, clinical figures and container labels are excluded.</p>
    <p>We first identify A and B in parallel. Each result appears when ready. Review or correct the information, then confirm and compare. Each AI stage can take some time; your completed identification results are retained if comparison fails.</p>
    <button className="ivr-button ivr-primary" disabled={locked || !left.ready || !right.ready || !missing.length} onClick={() => void identify(missing)}>
      {active ? 'Identifying cartons…' : 'Identify selected cartons'}
    </button>
    {active && <p role="status">Identification in progress · {elapsed}s elapsed. Waiting for the worker or image analysis; completed products appear below.</p>}
    {error && <p className="ivr-error" role="alert">{error}</p>}
    {paused && <button className="ivr-button" onClick={() => { setError(''); setPaused(false); }}>Resume status check</button>}
    <div className="ivr-carton-cards">
      {SIDES.map(side => {
        const record = records[side]?.key === sourceKey(selections[side]) ? records[side] : undefined;
        const extraction = record?.extraction;
        return <section key={side} className="ivr-carton-card" aria-label={`Product ${side === 'left' ? 'A' : 'B'} identification`}>
          <h3>Product {side === 'left' ? 'A' : 'B'}</h3>
          {!extraction && <p role="status">{record?.error || (task?.sides.includes(side) ? 'Identifying this carton…' : 'Select a carton and identify it to review its information.')}</p>}
          {extraction && <>
            <p><strong>{extraction.suitability === 'unsupported' ? 'Unsupported image — replace it below' : extraction.suitability === 'uncertain' ? 'Carton type uncertain — verify before continuing' : 'Package carton identified'}</strong> · View: {extraction.view}</p>
            <p>{extraction.reason}</p>
            <p>{extraction.visual_features}</p>
            {extraction.limitations.length > 0 && <ul>{extraction.limitations.map((note, i) => <li key={i}>{note}</li>)}</ul>}
            {extraction.suitability !== 'unsupported' && <>
              <div className="ivr-carton-fields">{keys.map(key => {
                const field = extraction.fields[key];
                const changed = record!.fields[key] !== field.value;
                return <label key={key}>{CARTON_FIELDS[key]}
                  <input value={record!.fields[key]} maxLength={1000} disabled={locked} placeholder="Unknown / not visible"
                    onChange={e => edit(side, { fields: { ...record!.fields, [key]: e.target.value }, acknowledged: false })} />
                  <span>{changed ? 'User provided — does not establish visibility' : field.status.replace('_', ' ')}{changed && field.value ? ` · Extracted: ${field.value}` : ''}</span>
                </label>;
              })}</div>
              <label className="ivr-carton-confirm"><input type="checkbox" disabled={locked} checked={record!.acknowledged}
                onChange={e => edit(side, { acknowledged: e.target.checked })} /> I reviewed this image, its information and limitations, and confirm it is a package carton. Unknown fields may remain blank.</label>
            </>}
          </>}
          <button className="ivr-button" disabled={locked || !selections[side].ready} onClick={() => void identify([side])}>{extraction || record?.error ? 'Retry identification' : 'Identify this product'}</button>
        </section>;
      })}
    </div>
    <p>Different faces or unfolded views limit comparison to corresponding visible areas. Confirm each product above, then use <strong>Confirm and compare</strong>. You can inspect and zoom both images throughout the analysis.</p>
    <button className="ivr-button ivr-primary" disabled={!canCompare} onClick={onCompare}>Confirm and compare</button>
    </details>
  </section>;
}
