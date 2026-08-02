'use client';

/*
 * Loader for the legacy vanilla-JS bundles in public/dashboard/js.
 *
 * What this replaces: the label page used to load ALL of chart/marked/utils/ui/
 * favorites/session_manager/chat/annotations/faers on every view, then spin a
 * 100ms setInterval waiting for five window.init* globals to appear, giving up
 * after 50 attempts. It also had to null out window.meddraScanData and friends
 * on every setId change because those globals leaked between labels.
 *
 * Here each tool declares only the scripts it needs and gets a callback once
 * they have actually loaded — no polling, no fixed timeout, and no tool paying
 * for another tool's dependencies.
 *
 * These scripts are not modules: they attach functions to `window` and must
 * execute in order, since ui.js and faers.js both expect utils.js first. Next's
 * <Script> does not guarantee ordering across instances, so they are chained
 * here explicitly.
 */

import { useEffect, useRef } from 'react';
import { withAppBase } from '../../../utils/appPaths';

/** Script bundles keyed by the globals they install. */
export const LEGACY_SCRIPTS = {
  chart: 'chart.js',
  marked: 'marked.min.js',
  utils: 'utils.js',
  ui: 'ui.js',
  favorites: 'favorites.js',
  session: 'session_manager.js',
  chat: 'chat.js',
  annotations: 'annotations.js',
  faers: 'faers.js',
} as const;

export type LegacyScript = keyof typeof LEGACY_SCRIPTS;

/** Tracks in-flight and completed loads so a script is fetched at most once. */
const loaded = new Map<string, Promise<void>>();

function loadOne(file: string): Promise<void> {
  const existing = loaded.get(file);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const src = withAppBase(`/dashboard/js/${file}`);
    // A previous mount may have inserted it before this module cached it.
    const already = document.querySelector<HTMLScriptElement>(
      `script[data-legacy="${file}"]`,
    );
    if (already) {
      resolve();
      return;
    }

    const el = document.createElement('script');
    el.src = src;
    el.async = false; // preserve execution order
    el.dataset.legacy = file;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load legacy script ${file}`));
    document.body.appendChild(el);
  });

  loaded.set(file, promise);
  return promise;
}

/** Load the named bundles in order. Resolves once all have executed. */
export async function loadLegacyScripts(names: readonly LegacyScript[]): Promise<void> {
  for (const name of names) {
    await loadOne(LEGACY_SCRIPTS[name]);
  }
}

interface LegacyBridgeProps {
  /** Bundles this tool needs, in dependency order. */
  scripts: readonly LegacyScript[];
  /**
   * Per-label globals the legacy code reads. Set before the scripts run so
   * initializers see them, replacing the inline <Script> block that used to
   * assign window.currentSetId and friends.
   */
  globals?: Record<string, unknown>;
  /**
   * Global function names to invoke once loading completes, in order. Missing
   * ones are skipped rather than blocking the rest.
   */
  init?: readonly string[];
  /** Runs after init, for tool-specific follow-up such as loadMeddraScan. */
  onReady?: () => void;
  /** Re-runs the whole sequence when this changes — normally the set id. */
  resetKey?: string;
}

export default function LegacyBridge({
  scripts,
  globals,
  init = [],
  onReady,
  resetKey,
}: LegacyBridgeProps) {
  // Keep the latest callback without making it a dependency of the effect.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const globalsRef = useRef(globals);
  globalsRef.current = globals;

  const scriptKey = scripts.join(',');
  const initKey = init.join(',');

  useEffect(() => {
    let cancelled = false;
    const win = window as unknown as Record<string, unknown>;

    // Clear cross-label caches the legacy scripts keep on window. Without this
    // a second label renders the first one's FAERS and MedDRA data.
    win.meddraScanData = null;
    win.faersDataLoaded = false;
    win.trendCache = {};
    win.selectedTerms = new Set();

    Object.entries(globalsRef.current ?? {}).forEach(([key, value]) => {
      win[key] = value;
    });

    loadLegacyScripts(scripts)
      .then(() => {
        if (cancelled) return;
        for (const fn of init) {
          const candidate = win[fn];
          if (typeof candidate === 'function') {
            try {
              (candidate as () => void)();
            } catch (err) {
              console.error(`Legacy initializer ${fn} threw`, err);
            }
          }
        }
        onReadyRef.current?.();
      })
      .catch((err) => {
        if (!cancelled) console.error('Legacy script load failed', err);
      });

    return () => {
      cancelled = true;
    };
    // scriptKey/initKey stand in for the array identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptKey, initKey, resetKey]);

  return null;
}
