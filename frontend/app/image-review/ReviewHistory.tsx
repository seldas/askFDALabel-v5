'use client';

import { useEffect, useState } from 'react';
import type { Review, ReviewComment, Source } from './types';

type HistoryItem = { task_id: number; status: string; created_at: string | null; mode: string | null; summary: string; cached: boolean; sources: Record<string, Source> };
type Detail = { task_id: number; status: string; message: string; error?: string; result?: Review };
function SavedImage({ taskId, side }: { taskId: number; side: 'left' | 'right' }) {
  const [missing, setMissing] = useState(false);
  return missing ? <p>Image is unavailable for this older review.</p> : <img src={`/api/image-review/reviews/${taskId}/images/${side}`} alt={`Saved ${side} artwork`} onError={() => setMissing(true)} />;
}
const labels: Record<string, string> = { artwork: 'Artwork Comparison', confusion: 'Product Confusion', consistency: 'Labeling Consistency' };

export default function ReviewHistory({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/image-review/history');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load history.');
      setItems(data.reviews);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const open = async (id: number) => {
    setError('');
    try {
      const response = await fetch(`/api/image-review/reviews/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load review.');
      setDetail(data);
      const responseComments = await fetch(`/api/image-review/reviews/${id}/comments`);
      setComments(responseComments.ok ? (await responseComments.json()).comments : []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const remove = async (id: number) => {
    if (!window.confirm('Delete this review, its saved images, and comments?')) return;
    try {
      const response = await fetch(`/api/image-review/reviews/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete review.');
      setDetail(null);
      setError('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const result = detail?.result;
  return <section className="ivr-history">
    <div className="ivr-history__heading"><div><h1>{detail ? 'Review details' : 'Review history'}</h1><p>Private to your account.</p></div>
      <button type="button" className="ivr-button" onClick={detail ? () => setDetail(null) : onClose}>{detail ? 'Back to history' : 'Back to visual review'}</button></div>
    {error && <p role="alert" className="ivr-history__error">{error}</p>}
    {!detail ? <>
      {loading ? <p>Loading history…</p> : items.length === 0 ? <p>No saved visual reviews yet.</p> : <div className="ivr-history__list">
        {items.map(item => <article key={item.task_id} className="ivr-history__item">
          <button type="button" className="ivr-history__open" onClick={() => void open(item.task_id)}>
            <strong>{labels[item.mode || ''] || 'Visual review'} · {item.status}</strong>
            <span>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Date unavailable'}{item.cached ? ' · Saved analysis' : ''}</span>
            <span>{[item.sources?.left?.filename, item.sources?.right?.filename].filter(Boolean).join(' / ') || item.summary || `Review #${item.task_id}`}</span>
          </button>
          <button type="button" className="ivr-button" disabled={!['completed', 'failed'].includes(item.status)} onClick={() => void remove(item.task_id)}>Delete</button>
        </article>)}
      </div>}
    </> : <>
      <div className="ivr-history__meta"><strong>{labels[result?.mode || ''] || 'Visual review'}</strong> · {detail.status}{result?.model ? ` · ${result.model}` : ''}{result?.cached ? ' · Saved analysis' : ''}</div>
      <p>{detail.message}{detail.error ? ` — ${detail.error}` : ''}</p>
      <div className="ivr-history__images">
        {(['left', 'right'] as const).filter(side => side === 'left' || result?.mode !== 'consistency').map(side => <figure key={side}>
          <figcaption>{side === 'left' ? 'Image A' : 'Image B'}{result?.sources?.[side]?.filename ? ` · ${result.sources[side].filename}` : ''}</figcaption>
          <SavedImage key={`${detail.task_id}-${side}`} taskId={detail.task_id} side={side} />
        </figure>)}
      </div>
      <p className="ivr-history__note">Saved images are normalized for review. The model analyzed a resized version.</p>
      {result?.summary && <section><h2>Summary</h2><p>{result.summary}</p></section>}
      {result?.assessment && <p><strong>Assessment:</strong> {result.assessment.replaceAll('_', ' ')}</p>}
      {result?.distinguishing_factors?.length ? <section><h2>Distinguishing factors</h2><ul>{result.distinguishing_factors.map((v, i) => <li key={i}>{v}</li>)}</ul></section> : null}
      {result?.carton_inputs && <section><h2>Confirmed packaging information</h2>{Object.entries(result.carton_inputs).map(([side, carton]) => <div key={side}><strong>{side === 'left' ? 'Image A' : 'Image B'}</strong><ul>{Object.entries(carton.confirmed_fields || {}).map(([name, field]) => <li key={name}>{name.replaceAll('_', ' ')}: {field.value || 'Not provided'}</li>)}</ul></div>)}</section>}
      {result?.findings?.length ? <section><h2>Findings</h2>{result.findings.map(f => <article key={f.id} className="ivr-history__finding"><h3>{f.title}</h3><p>{f.priority} · {f.category} · {f.confidence}</p><p>{f.observation}</p>{f.risk && <p><strong>Potential risk:</strong> {f.risk}</p>}{f.left_text && <p><strong>Image A:</strong> {f.left_text}</p>}{f.right_text && <p><strong>Image B:</strong> {f.right_text}</p>}{f.label_evidence?.map((e, i) => <blockquote key={i}>{e.quote}</blockquote>)}{comments.filter(c => c.finding_id === f.id).map(c => <p key={c.id}><strong>Decision:</strong> {c.decision}{c.comment && ` — ${c.comment}`}</p>)}</article>)}</section> : null}
      {result?.limitations?.length ? <section><h2>Limitations</h2><ul>{result.limitations.map((v, i) => <li key={i}>{v}</li>)}</ul></section> : null}
      <button type="button" className="ivr-button" disabled={!['completed', 'failed'].includes(detail.status)} onClick={() => void remove(detail.task_id)}>Delete review</button>
    </>}
  </section>;
}
