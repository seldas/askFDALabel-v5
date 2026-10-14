'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Finding, ReviewMode, Selection, Side } from './types';
import SelectLabelModal, { type SelectedLabel } from './SelectLabelModal';

type Asset = { id: string; title: string; filename: string; category: string };
type Props = {
  side: Side;
  mode?: ReviewMode;
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
  const [imageReady, setImageReady] = useState(false);
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  const sequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setFrame({ width: Math.max(1, element.clientWidth - 24), height: Math.max(1, element.clientHeight - 24) })
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitWidth = Math.min(frame.width, (frame.height * natural.width) / natural.height);

  const loadLabel = useCallback(
    async (overrideSetId?: string, overrideSplId?: string) => {
      const targetSetId = (overrideSetId ?? setId).trim();
      const targetSplId = (overrideSplId ?? splId).trim();
      if (!targetSetId) return;
      const current = ++sequence.current;
      setLoading(true);
      setError('');
      setAssets([]);
      setAssetId('');
      setUpload(null);
      setLoaded(null);
      setImageReady(false);
      if (fileInput.current) fileInput.current.value = '';
      try {
        const query = targetSplId ? `?spl_id=${encodeURIComponent(targetSplId)}` : '';
        const response = await fetch(`/api/image-review/labels/${encodeURIComponent(targetSetId)}/images${query}`);
        const data = await response.json();
        if (current !== sequence.current) return;
        if (!response.ok) throw new Error(data.error || 'Could not load labeling images.');
        setLoaded({ set_id: targetSetId, spl_id: data.source.spl_id, origin: data.source.origin });
        setAssets(data.images);
        setAssetId(data.images[0]?.id || '');
        if (!data.images.length) setError('No artwork images extracted from this SPL. Upload a package image to verify against this labeling.');
      } catch (e) {
        if (current === sequence.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [setId, splId]
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
    if (upload) {
      objectUrl = URL.createObjectURL(upload);
      setUrl(objectUrl);
    } else if (assetId && loaded) {
      const query = loaded.spl_id ? `?spl_id=${encodeURIComponent(loaded.spl_id)}` : '';
      fetch(`/api/image-review/labels/${encodeURIComponent(loaded.set_id)}/images/${assetId}${query}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            const body = await response.json();
            throw new Error(body.error || 'Image unavailable.');
          }
          return response.blob();
        })
        .then(blob => {
          if (alive) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(e => {
          if (alive && e.name !== 'AbortError') setError(e.message);
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

  const defaultTitle = mode === 'consistency' ? 'Artwork & Labeling Reference' : `Product ${side === 'left' ? 'A' : 'B'}`;

  return (
    <section className="ivr-panel" aria-label={`${side} artwork`}>
      <header className="ivr-panel-heading">
        <strong>{labelTitle || defaultTitle}</strong>
        <span>{upload ? 'Uploaded artwork' : 'Label artwork'}</span>
      </header>
      <div className="ivr-source-controls">
        {loaded ? (
          <div className="ivr-loaded-badge">
            <div className="ivr-loaded-badge-icon">💊</div>
            <div className="ivr-loaded-badge-info">
              <strong>{labelMeta?.brand_name || loaded.set_id}</strong>
              {labelMeta?.manufacturer_name && <span>{labelMeta.manufacturer_name}</span>}
              <small>Set-ID: {loaded.set_id}{loaded.spl_id ? ` · SPL: ${loaded.spl_id.slice(0, 8)}…` : ''}</small>
            </div>
            <button
              type="button"
              className="ivr-button"
              onClick={() => setShowLabelModal(true)}
              disabled={busy || loading}
            >
              Change Label
            </button>
          </div>
        ) : (
          <div className="ivr-source-select-bar">
            <button
              type="button"
              className="ivr-button ivr-primary-subtle"
              onClick={() => setShowLabelModal(true)}
              disabled={busy || loading}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7h6l2 2h10v11H3z" />
                <path d="M3 7V4h7l2 3" />
              </svg>
              Choose Label (Task / Project)
            </button>
            <button
              type="button"
              className="ivr-button"
              onClick={() => setShowManualInput(!showManualInput)}
              title="Enter Set-ID directly"
            >
              Direct Set-ID {showManualInput ? '▲' : '▼'}
            </button>
          </div>
        )}

        {(!loaded || showManualInput) && (
          <div className="ivr-manual-setid-box">
            <div className="ivr-source-row">
              <label>
                Set-ID
                <input
                  value={setId}
                  placeholder="Paste SPL Set-ID UUID"
                  disabled={busy || loading}
                  onChange={e => {
                    setSetId(e.target.value);
                    clearLabel();
                  }}
                />
              </label>
              <button
                className="ivr-button"
                disabled={busy || loading || !setId.trim()}
                onClick={() => void loadLabel()}
              >
                {loading ? 'Loading…' : 'Load label'}
              </button>
            </div>
            <label>
              Version pin (optional SPL-ID)
              <input
                value={splId}
                placeholder="Latest available labeling if empty"
                disabled={busy || loading}
                onChange={e => {
                  setSplId(e.target.value);
                  clearLabel();
                }}
              />
            </label>
          </div>
        )}

        <div className="ivr-source-row">
          <label>
            Artwork
            <select
              value={upload ? '' : assetId}
              disabled={busy || loading || !assets.length}
              onChange={e => {
                setAssetId(e.target.value);
                setUpload(null);
                setError('');
                if (fileInput.current) fileInput.current.value = '';
              }}
            >
              <option value="">Choose an image</option>
              {assets.map(asset => (
                <option key={asset.id} value={asset.id}>
                  {asset.category} · {asset.title}
                </option>
              ))}
            </select>
          </label>
          <label className="ivr-upload">
            Upload image
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/tiff"
              disabled={busy || loading}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 12 * 1024 * 1024) {
                  setError('Each image must be at most 12 MiB.');
                  e.target.value = '';
                  return;
                }
                setUpload(file);
                setError('');
              }}
            />
          </label>
        </div>
        {loaded && upload && (
          <p className="ivr-source-note">
            Uploaded artwork: will be verified against labeling {loaded.set_id}.
          </p>
        )}
        {error && (
          <p role="alert" className="ivr-error">
            {error}
          </p>
        )}
      </div>

      <div className="ivr-viewport" ref={viewport}>
        {url ? (
          <div className="ivr-image-stage" style={{ width: fitWidth ? `${fitWidth * zoom}px` : '100%' }}>
            <img
              src={url}
              alt={`${side === 'left' ? 'Product A' : 'Product B'} selected artwork`}
              onLoad={e => {
                setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight });
                setImageReady(true);
              }}
              onError={() => {
                setImageReady(false);
                setError('This image cannot be displayed. Use a PNG, JPEG, or WebP copy.');
              }}
            />
            {imageReady &&
              highlights &&
              findings.map(finding => {
                const region = finding.regions[side];
                if (!region) return null;
                return (
                  <button
                    key={finding.id}
                    data-finding={finding.id}
                    className={`ivr-region ${finding.category === 'color' ? 'is-color' : ''} ${
                      selected === finding.id ? 'is-selected' : ''
                    }`}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.w * 100}%`,
                      height: `${region.h * 100}%`,
                    }}
                    aria-label={`Finding ${finding.id}: ${finding.title}`}
                    title={finding.title}
                    onClick={() => onSelect(finding.id)}
                  >
                    <span>{finding.id}</span>
                  </button>
                );
              })}
          </div>
        ) : (
          <div className="ivr-empty-artwork">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="6" y="8" width="36" height="32" />
              <circle cx="17" cy="18" r="4" />
              <path d="m8 36 12-12 9 9 6-7 7 10" />
            </svg>
            <strong>Select carton, container, or package artwork</strong>
            <span>
              Load a drug labeling from your tasks or upload an image.
              <br />
              PNG, JPEG, WebP, GIF, TIFF · up to 12 MiB
            </span>
          </div>
        )}
      </div>

      <footer className="ivr-viewer-controls">
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
