import { CRITERION_DEFS, type TargetDb, type WireQuery } from './types';

export const QUERY_CODE_PREFIX = 'FDALABEL-Q1:';
export interface SavedQuery { query: WireQuery; targetDb: TargetDb }

export async function encodeQueryCode(query: WireQuery, targetDb: TargetDb): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify({ query, targetDb }));
  const compressed = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return QUERY_CODE_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeQueryCode(code: string): Promise<SavedQuery> {
  try {
    const encoded = code.trim().slice(QUERY_CODE_PREFIX.length).replace(/\s/g, '');
    if (!code.trim().startsWith(QUERY_CODE_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const saved = JSON.parse(await new Response(stream).text());
    if (!['local', 'oracle', 'oracle_all'].includes(saved.targetDb) || !Array.isArray(saved.query?.groups)) throw new Error();
    for (const group of saved.query.groups) {
      if (!Array.isArray(group.criteria)) throw new Error();
      for (const criterion of group.criteria) {
        if (!Object.prototype.hasOwnProperty.call(CRITERION_DEFS, criterion.type)
          || !criterion.value || typeof criterion.value !== 'object' || Array.isArray(criterion.value)) throw new Error();
      }
    }
    return saved;
  } catch {
    throw new Error('Invalid or unsupported query code. Copy the complete code from the search results and try again.');
  }
}
