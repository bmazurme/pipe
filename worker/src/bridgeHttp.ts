// Shared plumbing for every call worker makes to bridge. A request without an
// AbortSignal can hang the whole poll loop (index.ts calls claim every tick), so
// the timeout lives here once instead of in each client.
// Transfers get a longer budget since a parcel/result can be a real file.
export const API_TIMEOUT_MS = 15_000;
export const TRANSFER_TIMEOUT_MS = 120_000;

export function bearer(apiKey: string, json = false): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export interface BridgeFetchOptions {
  timeoutMs?: number;
  // When set, a non-ok response throws `<expectOk> failed (<status>)`, with the
  // response body appended if `includeBody` is true. Leave unset to inspect the
  // response yourself.
  expectOk?: string;
  includeBody?: boolean;
}

export async function bridgeFetch(
  url: string,
  init: RequestInit = {},
  { timeoutMs = API_TIMEOUT_MS, expectOk, includeBody = false }: BridgeFetchOptions = {},
): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

  if (expectOk !== undefined && !response.ok) {
    const body = includeBody ? `: ${await response.text()}` : '';
    throw new Error(`${expectOk} failed (${response.status})${body}`);
  }

  return response;
}

// Bridge answers "nothing to claim" with an empty body (204 now; an older
// deployment may still send 201 with no body), never a 200 with JSON "null".
// response.json() throws on an empty body, so check the raw text first rather
// than assuming a specific status code.
export async function readOptionalJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T | null) : null;
}
