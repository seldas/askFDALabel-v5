'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLabel } from '../LabelContext';
import './image-analysis.css';

type LabelImage = { id: string; filename: string; title: string; category: string; url: string; proxy_url: string };
type CompareResult = { style: string; content: string; critical_summary: string };

function splitProcessReview(text: string) {
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;
  const headingPattern = /^\s*(?:#{1,4}\s*)?(Extracted Text|Original Text|Normalized Product Information|Warnings and Instructions|Uncertainties)\s*:?[ \t]*$/i;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(headingPattern);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1], body: '' };
    } else if (current) {
      current.body += `${current.body ? '\n' : ''}${line}`;
    } else if (line.trim()) {
      current = { title: 'Normalized Product Information', body: line };
    }
  }
  if (current) sections.push(current);
  const extracted = sections.filter((section) => /^(extracted|original) text$/i.test(section.title)).map((section) => section.body.trim()).join('\n\n');
  const normalized = sections.filter((section) => !/^(extracted|original) text$/i.test(section.title))
    .map((section) => `## ${section.title}\n\n${section.body.trim()}`).join('\n\n');
  return { extracted, normalized: normalized || text };
}

function apiPath(setId: string, path: string, splId: string | null) {
  const query = splId ? `?spl_id=${encodeURIComponent(splId)}` : '';
  return `/api/image-analysis/${encodeURIComponent(setId)}/${path}${query}`;
}

export default function ImageAnalysisPage() {
  const { setId, splId, data, loading: labelLoading } = useLabel();
  const [images, setImages] = useState<LabelImage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proxyImageIds, setProxyImageIds] = useState<string[]>([]);
  const [brokenImageIds, setBrokenImageIds] = useState<string[]>([]);
  const [processResult, setProcessResult] = useState('');
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareId, setCompareId] = useState('');
  const [upload, setUpload] = useState<File | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareCached, setCompareCached] = useState(false);

  const selected = useMemo(() => images.find((image) => image.id === selectedId) ?? null, [images, selectedId]);
  const processedSections = useMemo(() => splitProcessReview(processResult), [processResult]);
  const imageSrc = (image: LabelImage) => proxyImageIds.includes(image.id) ? image.proxy_url : image.url;
  const imageFailed = (image: LabelImage) => {
    if (!proxyImageIds.includes(image.id)) {
      setProxyImageIds((current) => [...current, image.id]);
    } else {
      setBrokenImageIds((current) => current.includes(image.id) ? current : [...current, image.id]);
      setError(`Could not load ${image.filename} from DailyMed or the local SPL package.`);
    }
  };

  const refreshImages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(apiPath(setId, 'images', splId));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Image list failed (${response.status})`);
      setImages(body.images || []);
      setProxyImageIds([]);
      setBrokenImageIds([]);
      setSelectedId((current) => body.images?.some((image: LabelImage) => image.id === current) ? current : body.images?.[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setId, splId]);

  useEffect(() => { void refreshImages(); }, [refreshImages]);

  const processImage = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setProcessResult('');
    try {
      const response = await fetch(apiPath(setId, 'process', null), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: selected.id, spl_id: splId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Image processing failed (${response.status})`);
      setProcessResult(body.result || 'No result returned.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const compareImages = async () => {
    if (!selected || (!compareId && !upload)) return;
    setBusy(true); setError(''); setCompareResult(null);
    try {
      const form = new FormData();
      form.set('image_id', selected.id);
      form.set('spl_id', splId || '');
      if (compareId) form.set('compare_image_id', compareId);
      if (upload) form.set('upload', upload);
      const response = await fetch(apiPath(setId, 'compare', null), { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Image comparison failed (${response.status})`);
      setCompareResult(body.result);
      setCompareCached(Boolean(body.cached));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (labelLoading) return null;

  return (
    <main className="image-review">
      <header className="image-review__header">
        <div>
          <div className="image-review__eyebrow">LABEL REVIEW</div>
          <h1>Image Analysis</h1>
          <p>Review package artwork and compare visible text, design, and safety details for {data?.brand_name || data?.drug_name || 'this label'}.</p>
        </div>
        <div className="image-review__actions">
          <button className="image-review__button image-review__button--secondary" onClick={() => { setCompareOpen(true); setCompareResult(null); setCompareId(''); setUpload(null); }} disabled={!selected}>Compare</button>
          <button className="image-review__button image-review__button--primary" onClick={processImage} disabled={!selected || busy}>{busy ? 'Processing…' : 'Process image'}</button>
        </div>
      </header>

      {error && <div className="image-review__error" role="alert">{error}</div>}
      {loading ? <div className="image-review__empty">Loading label images…</div> : images.length === 0 ? (
        <div className="image-review__empty">No package images were found in this label’s SPL. The label may contain text only, or its artwork may not be available in the local SPL package.</div>
      ) : (
        <>
          <nav className="image-review__filmstrip" aria-label="Label images">
            <div className="image-review__filmstrip-title">Select an image <span>{images.length}</span></div>
            <div className="image-review__cards">{images.map((image) => <button key={image.id} className={`image-review__card ${selectedId === image.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(image.id); setProcessResult(''); }} aria-pressed={selectedId === image.id}>
              {brokenImageIds.includes(image.id) ? <span className="image-review__thumb-error">Unavailable</span> : <img src={imageSrc(image)} onError={() => imageFailed(image)} alt="" loading="lazy" />}
              <span className="image-review__card-category">{image.category}</span>
              <span className="image-review__card-name">{image.title}</span>
            </button>)}</div>
          </nav>
          <section className="image-review__stage" aria-label="Selected label image">
            {selected && <>
              <div className="image-review__preview-wrap">{brokenImageIds.includes(selected.id) ? <div className="image-review__image-error">Image unavailable<br /><small>{selected.filename}</small></div> : <img src={imageSrc(selected)} onError={() => imageFailed(selected)} alt={selected.title} className="image-review__preview" />}</div>
              <div className="image-review__caption"><span>{selected.category}</span><strong>{selected.title}</strong><small>{selected.filename}</small></div>
            </>}
          </section>

          {processResult && <section className="image-review__result"><div className="image-review__result-title">Normalized image review</div><div className="image-review__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{processedSections.normalized}</ReactMarkdown></div>{processedSections.extracted && <details className="image-review__extracted"><summary>Show extracted text</summary><div className="image-review__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{processedSections.extracted}</ReactMarkdown></div></details>}</section>}
        </>
      )}

      {compareOpen && <div className="image-review__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompareOpen(false); }}>
        <section className="image-review__dialog" role="dialog" aria-modal="true" aria-labelledby="image-compare-title">
          <header><div><div className="image-review__eyebrow">COMPARE ARTWORK</div><h2 id="image-compare-title">Compare with another image</h2></div><button className="image-review__close" onClick={() => setCompareOpen(false)} aria-label="Close">×</button></header>
          {!compareResult ? <>
            <p className="image-review__dialog-intro">Compare <strong>{selected?.title}</strong> with another image in this label or upload a temporary image. Uploaded images are deleted after comparison.</p>
            <label className="image-review__field">Another image in this label
              <select value={compareId} onChange={(event) => { setCompareId(event.target.value); setUpload(null); }}>
                <option value="">Choose an image…</option>
                {images.filter((image) => image.id !== selectedId).map((image) => <option value={image.id} key={image.id}>{image.category} — {image.title}</option>)}
              </select>
            </label>
            <div className="image-review__or">OR UPLOAD TEMPORARILY (12 MiB MAX)</div>
            <label className="image-review__upload">{upload ? upload.name : 'Choose a JPEG, PNG, WebP, GIF or TIFF image'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/tiff" onChange={(event) => { setUpload(event.target.files?.[0] || null); setCompareId(''); }} /></label>
            <button className="image-review__button image-review__button--primary image-review__compare-submit" onClick={compareImages} disabled={busy || (!compareId && !upload)}>{busy ? 'Comparing…' : 'Compare images'}</button>
          </> : <div className="image-review__compare-result">
            <div className="image-review__cache-note">{compareCached ? 'Loaded saved comparison' : 'AI comparison'}{compareCached ? ' · no new model call' : ''}</div>
            <article><h3>Style</h3><div className="image-review__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{compareResult.style || 'No clear style difference identified.'}</ReactMarkdown></div></article>
            <article><h3>Content</h3><div className="image-review__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{compareResult.content || 'No clear content difference identified.'}</ReactMarkdown></div></article>
            <article className="is-critical"><h3>Critical Summary</h3><div className="image-review__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{compareResult.critical_summary || 'No summary returned.'}</ReactMarkdown></div></article>
            <button className="image-review__button image-review__button--secondary" onClick={() => setCompareResult(null)}>Compare another pair</button>
          </div>}
        </section>
      </div>}
    </main>
  );
}
