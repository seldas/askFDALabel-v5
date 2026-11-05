/** Preserve API explanations and references, including proxy failures without JSON. */
export function queryErrorMessage(body: Record<string, any>, fallback: string): string {
  const parts = [body.error || fallback, body.message];
  if (body.error_ref) parts.push(`Reference: ${body.error_ref}`);
  return [...new Set(parts.filter((part) => typeof part === 'string' && part))].join(' ');
}

export async function readQueryResponse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const reason = response.status === 504
      ? 'The server or database took too long to respond. Narrow the search and try again.'
      : response.status === 502 || response.status === 503
        ? 'The query service is unavailable. Try again or ask the administrator to check the backend connection.'
        : 'The query service returned an invalid response. Try again or contact the administrator.';
    throw new Error(`${reason} (HTTP ${response.status})`);
  }
}
