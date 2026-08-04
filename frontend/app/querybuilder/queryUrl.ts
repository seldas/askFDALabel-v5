/*
 * Packs a criteria tree into a URL parameter.
 *
 * The results page carries its whole query in the URL rather than reading it
 * from storage, which is what makes "View Query (permanent link)" work and what
 * lets Search open a real second window — a new tab has no access to the
 * builder's React state, and sessionStorage is per-tab.
 *
 * Encoding is base64url over JSON: compact enough for a realistic criteria set
 * and, unlike raw JSON in a query string, safe from proxies that re-encode `%`.
 */

import type { WireQuery } from './types';

export const QUERY_PARAM = 'q';

/** Practical URL ceiling; browsers and proxies get unreliable well past this. */
const MAX_ENCODED_LENGTH = 8000;

export class QueryTooLargeError extends Error {}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export function encodeQuery(query: WireQuery): string {
  // TextEncoder rather than escape/unescape: criteria routinely contain
  // non-ASCII (drug names, MedDRA terms), and btoa alone throws on those.
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(query)));
  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new QueryTooLargeError(
      'This query is too large to open in a new window. Remove some criteria and try again.',
    );
  }
  return encoded;
}

export function decodeQuery(encoded: string | null): WireQuery | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    return parsed && Array.isArray(parsed.groups) ? (parsed as WireQuery) : null;
  } catch {
    return null;
  }
}

/** App-relative results URL; the base path is applied by the caller's link. */
export function resultsPath(query: WireQuery, targetDb: 'oracle' | 'local' = 'oracle'): string {
  const params = new URLSearchParams();
  params.set(QUERY_PARAM, encodeQuery(query));
  if (targetDb) {
    params.set('target_db', targetDb);
  }
  return `/labelquery?${params.toString()}`;
}
