'use client';

/*
 * askFDALabel v5 — deployment capabilities.
 *
 * /api/check-fdalabel reports what this deployment can reach: whether we are on
 * the FDA internal network, and whether local structured query is enabled. That
 * endpoint was previously fetched independently by both Header.tsx and the home
 * page, so every page load hit it twice. This provider fetches it once and
 * shares the result.
 *
 * The backend derives these from the `labeling_source` setting and a network
 * probe of fdalabel.fda.gov (see backend/app.py check_fdalabel and
 * dashboard/services/ai_handler.py _check_is_internal).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Capabilities {
  /** On the FDA internal network (either FDA or CDER endpoint reachable). */
  isInternal: boolean;
  /** fdalabel.fda.gov reachable. */
  fdaAccessible: boolean;
  /** The CDER/CBER variant reachable. */
  cderAccessible: boolean;
  /** Local structured query against the labeling schema is permitted. */
  localAccessible: boolean;
  allowLocalQuery: boolean;
}

/**
 * Defaults are the safe, public-internet answer and match the error branches
 * the old call sites used. `allowLocalQuery` defaults true because the backend
 * config default is LOCAL_QUERY=True.
 */
const DEFAULT_CAPABILITIES: Capabilities = {
  isInternal: false,
  fdaAccessible: false,
  cderAccessible: false,
  localAccessible: true,
  allowLocalQuery: true,
};

interface CapabilitiesState {
  capabilities: Capabilities;
  /** False until the probe resolves; gate optimistic UI on this if it matters. */
  ready: boolean;
}

const CapabilitiesContext = createContext<CapabilitiesState>({
  capabilities: DEFAULT_CAPABILITIES,
  ready: false,
});

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<Capabilities>(DEFAULT_CAPABILITIES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/check-fdalabel', { method: 'POST' });
        if (!res.ok) throw new Error(`check-fdalabel returned ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setCapabilities({
          isInternal: Boolean(data.isInternal),
          fdaAccessible: Boolean(data.fdaAccessible),
          cderAccessible: Boolean(data.cderAccessible),
          localAccessible: Boolean(data.localAccessible),
          allowLocalQuery: Boolean(data.allowLocalQuery),
        });
      } catch {
        // Keep defaults: assume public internet, local query allowed.
        if (!cancelled) setCapabilities(DEFAULT_CAPABILITIES);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ capabilities, ready }), [capabilities, ready]);

  return (
    <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
  );
}

export function useCapabilities(): CapabilitiesState {
  return useContext(CapabilitiesContext);
}
