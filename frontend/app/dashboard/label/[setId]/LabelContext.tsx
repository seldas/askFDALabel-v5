'use client';

/*
 * Shared label context for the workspace shell.
 *
 * The layout fetches the label once and exposes it here, so the reader and
 * every tool route render against the same data instead of each re-fetching
 * it. Previously the page owned this fetch and the tools were all mounted
 * simultaneously inside it, each hiding itself with an `activeTab` check.
 */

import { createContext, useContext } from 'react';
import type { LabelData } from './types';

export interface LabelContextValue {
  setId: string;
  /** Version pin from ?spl_id=, when the caller arrived from a history view. */
  splId: string | null;
  data: LabelData | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch, e.g. after an annotation write. */
  refresh: () => void;
  headerCollapsed: boolean;
  setHeaderCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
}

const LabelContext = createContext<LabelContextValue | null>(null);

export const LabelContextProvider = LabelContext.Provider;

/** Throws outside the label layout so a mis-placed tool route fails loudly. */
export function useLabel(): LabelContextValue {
  const ctx = useContext(LabelContext);
  if (!ctx) {
    throw new Error('useLabel must be used inside the label workspace layout');
  }
  return ctx;
}

/*
 * Tool ids. These double as the `activeTab` values the existing view
 * components already switch on, so those components need no changes — each
 * route simply passes its own id.
 */
export const TOOL_LABEL = 'label-view';
export const TOOL_FAERS = 'faers-view';
export const TOOL_TOX = 'tox-view';
export const TOOL_EXAMINE = 'examine-view';
export const TOOL_DEEPDIVE = 'deep-dive-view';
export const TOOL_PV_PROFILE = 'pv-profile-view';
