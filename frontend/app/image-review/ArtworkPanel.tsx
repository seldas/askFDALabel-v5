'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Finding, VisualTask, Selection, Side } from './types';
import SelectLabelModal, { type SelectedLabel } from './SelectLabelModal';

type Asset = { id: string; title: string; filename: string; category: string };
type Props = {
  side: Side;
  mode?: VisualTask;
  initialImage?: string;
  initialImageId?: string;
  labelTitle?: string;
  initialSetId: string;
  initialSplId: string;
  busy: boolean;
  findings: Finding[];
  selected: number | null;
  highlights: boolean;
  zoom: number;
  onZoom: (zoom: number) => void;
  onSelect: (id: number) => void;
  onChange: (value: Selection) => void;
};

export default function ArtworkPanel({
  side,
  mode,
  labelTitle,
  initialSetId,
  initialSplId,
  initialImage,
  initialImageId,
  busy,
  findings,
  selected,
  highlights,
  zoom,
  onZoom,
  onSelect,
  onChange,
}: Props) {
  const [setId, setSetId] = useState(initialSetId);
  const [splId, setSplId] = useState(initialSplId);
  const [labelMeta, setLabelMeta] = useState<{ brand_name?: string; generic_name?: string; manufacturer_name?: string } | null>(null);
  const [loaded, setLoaded] = useState<{ set_id: string; spl_id?: string; origin?: string } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [upload, setUpload] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isArchivedUnavailable, setIsArchivedUnavailable] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  const sequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(element);
      setFrame({
        width: Math.max(1, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
        height: Math.max(1, element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitWidth = Math.min(frame.width, (frame.height * natural.width) / natural.height);

  const loadLabel = useCallback(
    async (overrideSetId?: string, overrideSplId?: string) => {
      const targetSetId = (overrideSetId ?? setId).trim();
      const targetSplId = (overrideSplId ?? splId).trim();
      if (!targetSetId) return;
      const retainUpload = mode === 'consistency' && Boolean(upload);
      const current = ++sequence.current;
      setLoading(true);
      setError('');
      setAssets([]);
      setAssetId('');
      if (!retainUpload) setUpload(null);
      setLoaded(null);
      setImageReady(false);
      if (fileInput.current && !retainUpload) fileInput.current.value = '';
      try {
        const query = targetSplId ? `?spl_id=${encodeURIComponent(targetSplId)}` : '';
        const base = `/api/image-review/labels/${encodeURIComponent(targetSetId)}`;
        const response = await fetch(`${base}/images${query}`);
        const data = await response.json();
        if (current !== sequence.current) return;
        if (!response.ok) throw new Error(data.error || 'Could not load labeling images.');
        setLoaded({ set_id: targetSetId, spl_id: data.source.spl_id, origin: data.source.origin });
        setAssets(data.images);
        const requested = targetSetId === initialSetId && targetSplId === initialSplId
          ? data.images.find((asset: Asset) => asset.id === initialImageId || asset.filename.toLowerCase() === initialImage?.toLowerCase()) : null;
        setAssetId(requested?.id || data.images[0]?.id || '');
        if (!data.images.length && !retainUpload) setError('No artwork images extracted from this SPL. Upload a package image to verify against this labeling.');
      } catch (e) {
        if (current === sequence.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [setId, splId, initialSetId, initialSplId, initialImage, initialImageId, mode, upload]
  );

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (initialSetId) void loadLabel();
    }
  }, [initialSetId, loadLabel]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setImageReady(false);
    setIsArchivedUnavailable(false);
    if (upload) {
      objectUrl = URL.createObjectURL(upload);
      setUrl(objectUrl);
    } else if (assetId && loaded) {
      const query = loaded.spl_id ? `?spl_id=${encodeURIComponent(loaded.spl_id)}` : '';
      const base = `/api/image-review/labels/${encodeURIComponent(loaded.set_id)}`;
      fetch(`${base}/images/${assetId}${query}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const errMsg = body.error || 'Image unavailable.';
            if (errMsg.includes('Archived labeling image is currently not available')) {
              if (alive) setIsArchivedUnavailable(true);
              return;
            }
            throw new Error(errMsg);
          }
          return response.blob();
        })
        .then(blob => {
          if (alive && blob) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
            setIsArchivedUnavailable(false);
          }
        })
        .catch(e => {
          if (alive && e.name !== 'AbortError') {
            setIsArchivedUnavailable(false);
            setError(e.message);
          }
        });
    }
    return () => {
      alive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, loaded, upload]);

  useEffect(() => {
    onChange({
      descriptor: {
        set_id: loaded?.set_id,
        spl_id: loaded?.spl_id,
        image_id: upload ? undefined : assetId,
        filename: upload?.name || assets.find(asset => asset.id === assetId)?.filename,
      },
      file: upload,
      url,
      ready: imageReady && !loading,
    });
  }, [loaded, assetId, upload, url, imageReady, loading, assets, onChange]);

  useEffect(() => {
    const region = findings.find(f => f.id === selected)?.regions[side];
    if (!region || !viewport.current) return;
    const target = viewport.current.querySelector<HTMLButtonElement>(`[data-finding="${selected}"]`);
    if (target) {
      viewport.current.scrollTo({
        left: Math.max(0, target.offsetLeft - viewport.current.clientWidth / 2 + target.offsetWidth / 2),
        top: Math.max(0, target.offsetTop - viewport.current.clientHeight / 2 + target.offsetHeight / 2),
        behavior: 'smooth',
      });
    }
  }, [selected, findings, side, zoom]);

  const clearLabel = () => {
    sequence.current++;
    setLoading(false);
    setLoaded(null);
    setAssets([]);
    setAssetId('');
    setError('');
  };

  const handleModalSelect = (label: SelectedLabel) => {
    setSetId(label.set_id);
    setSplId(label.spl_id || '');
    setLabelMeta({
      brand_name: label.brand_name,
      generic_name: label.generic_name,
      manufacturer_name: label.manufacturer_name,
    });
    void loadLabel(label.set_id, label.spl_id);
  };

  const defaultTitle = mode === 'read' || mode === 'consistency' ? 'Your image' : `Image ${side === 'left' ? 'A' : 'B'}`;
  const filename = upload?.name || assets.find(asset => asset.id === assetId)?.filename;

  return (
    <section className="ivr-panel" aria-label={`${side} artwork`}>
      <header className="ivr-panel-heading">
        <strong>{labelTitle || defaultTitle}</strong>
        <span>{upload ? 'Uploaded artwork' : 'Label artwork'}</span>
      </header>
      <details className="ivr-image-source" open={sourcesOpen} onToggle={e => setSourcesOpen(e.currentTarget.open)}>
        <summary><span>{filename || 'Choose an image'}</span><span className="ivr-source-change">{filename ? 'Change image' : 'Select or upload'}</span></summary>
        <div className="ivr-source-controls">
          <div className="ivr-source-select-bar">
            <button type="button" className="ivr-button" onClick={() => setShowLabelModal(true)} disabled={busy || loading}>
              {mode === 'consistency' && upload ? (loaded ? 'Change reference labeling' : 'Choose reference labeling') : loaded ? 'Change labeling' : 'Choose from labeling'}
            </button>
            <label className="ivr-upload">
              Upload image
              <input ref={fileInput} type="file" aria-label={`Upload image ${side === 'left' ? 'A' : 'B'}`}
                accept="image/png,image/jpeg,image/webp,image/gif,image/tiff" disabled={busy || loading}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 12 * 1024 * 1024) {
                    setError('Each image must be at most 12 MiB.'); e.target.value = ''; return;
                  }
                  setUpload(file); setError('');
                }} />
            </label>
          </div>
          {assets.length > 0 && <label>Image in this labeling
            <select value={upload ? '' : assetId} disabled={busy || loading} onChange={e => {
              setAssetId(e.target.value); setUpload(null); setError('');
              if (fileInput.current) fileInput.current.value = '';
            }}>
              <option value="">Choose an image</option>
              {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.category} · {asset.title}</option>)}
            </select>
          </label>}
          <details className="ivr-source-metadata">
            <summary>Labeling reference & version</summary>
            {loaded && <p>{labelMeta?.brand_name || 'Selected labeling'}{labelMeta?.manufacturer_name ? ` · ${labelMeta.manufacturer_name}` : ''}</p>}
            <div className="ivr-manual-setid-box">
              <label>Set-ID<input value={setId} placeholder="Paste SPL Set-ID" disabled={busy || loading}
                onChange={e => { setSetId(e.target.value); clearLabel(); }} /></label>
              <label>SPL-ID (optional version)<input value={splId} placeholder="Latest available version" disabled={busy || loading}
                onChange={e => { setSplId(e.target.value); clearLabel(); }} /></label>
              <button className="ivr-button" disabled={busy || loading || !setId.trim()} onClick={() => void loadLabel()}>
                {loading ? 'Loading…' : 'Load labeling'}
              </button>
            </div>
          </details>
          {loading && <p role="status">Loading labeling images…</p>}
          <p className="ivr-source-note">PNG, JPEG, WebP, GIF or TIFF · up to 12 MiB</p>
        </div>
      </details>
      {loaded && <div className="ivr-reference-caption">
        <span>{mode === 'consistency' ? 'Official labeling reference' : 'Labeling source'}{upload ? ' · uploaded image association unverified' : ''}</span>
        <small title={`Set-ID: ${loaded.set_id} · SPL-ID: ${loaded.spl_id || 'unverified'}`}>
          {labelMeta?.brand_name || 'Selected labeling'} · version {loaded.spl_id?.slice(0, 8) || 'unverified'}
        </small>
      </div>}
      {error && <p role="alert" className="ivr-error ivr-image-error">{error}</p>}

      <div className="ivr-viewport" ref={viewport}>
        {url ? (
          <div className="ivr-image-stage" style={{ width: fitWidth ? `${fitWidth * zoom}px` : '100%' }}>
            <img
              src={url}
              alt={`${side === 'left' ? 'Product A' : 'Product B'} selected artwork`}
              onLoad={e => {
                setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight });
                setImageReady(true);
                setSourcesOpen(false);
              }}
              onError={() => {
                setImageReady(false);
                setSourcesOpen(true);
                setError('This image cannot be displayed. Use a PNG, JPEG, or WebP copy.');
              }}
            />
            {/* If a finding is selected, show its non-blocking outline box */}
            {imageReady && highlights && selected && (() => {
              const activeFinding = findings.find(f => f.id === selected);
              const region = activeFinding?.regions[side];
              if (!region) return null;
              return (
                <div
                  className={`ivr-active-region-outline ${activeFinding.category === 'color' ? 'is-color' : ''}`}
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.w * 100}%`,
                    height: `${region.h * 100}%`,
                  }}
                />
              );
            })()}

            {/* Display clean numbered circular tags centered in each difference area */}
            {imageReady &&
              highlights &&
              findings.map(finding => {
                const region = finding.regions[side];
                if (!region) return null;
                const isSelected = selected === finding.id;
                const centerX = (region.x + region.w / 2) * 100;
                const centerY = (region.y + region.h / 2) * 100;
                return (
                  <button
                    key={finding.id}
                    type="button"
                    data-tag={finding.id}
                    className={`ivr-tag-pin ${finding.category === 'color' ? 'is-color' : ''} ${
                      isSelected ? 'is-selected' : ''
                    }`}
                    style={{
                      left: `${centerX}%`,
                      top: `${centerY}%`,
                    }}
                    aria-label={`Finding ${finding.id}: ${finding.title}`}
                    title={`${finding.id}. ${finding.title}`}
                    onClick={e => {
                      e.stopPropagation();
                      onSelect(finding.id);
                    }}
                  >
                    <span>{finding.id}</span>
                  </button>
                );
              })}
          </div>
        ) : isArchivedUnavailable ? (
          <div className="ivr-empty-artwork ivr-archived-artwork">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#64748b" strokeWidth="1.5">
              <rect x="6" y="8" width="36" height="32" rx="2" />
              <path d="M14 18h20M14 26h14M14 34h8" />
              <circle cx="34" cy="32" r="6" stroke="#94a3b8" />
              <path d="M34 29v3l2 2" stroke="#94a3b8" />
            </svg>
            <strong>Archived labeling image is currently not available in askFDALabel.</strong>
            <span>
              This is a historical label version. Images for archived labels cannot be pulled from DailyMed.
              <br />
              You may upload a package photo or artwork above to review against this labeling.
            </span>
          </div>
        ) : (
          <div className="ivr-empty-artwork">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="6" y="8" width="36" height="32" />
              <circle cx="17" cy="18" r="4" />
              <path d="m8 36 12-12 9 9 6-7 7 10" />
            </svg>
            <strong>Choose an image to begin</strong>
            <span>
              Select a labeling image or upload your own.
              <br />
              PNG, JPEG, WebP, GIF, TIFF · up to 12 MiB
            </span>
          </div>
        )}
      </div>

      <footer className="ivr-viewer-controls" hidden={!url}>
        <span>Zoom</span>
        <button className="ivr-button" onClick={() => onZoom(Math.max(1, zoom - 0.25))} disabled={zoom <= 1}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="ivr-button" onClick={() => onZoom(Math.min(4, zoom + 0.25))} disabled={zoom >= 4}>
          +
        </button>
        <button className="ivr-button" onClick={() => onZoom(1)}>
          Fit
        </button>
      </footer>

      <SelectLabelModal
        isOpen={showLabelModal}
        onClose={() => setShowLabelModal(false)}
        onSelect={handleModalSelect}
      />
    </section>
  );
}
