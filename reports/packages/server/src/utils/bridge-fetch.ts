import { getSettings } from '../settings/props';
import { describeFetchError } from './describe-fetch-error';

const BRIDGE_TIMEOUT_MS = 20_000;
const NOT_CONFIGURED = 'Интеграция с bridge не настроена: укажите адрес и ключ на странице Settings';

export type BridgeFetchOptions = {
  apiKey?: string;
  method?: string;
  json?: unknown;
  timeoutMs?: number;
  bridgeUrl?: string;
};

export function bridgeOrigin(bridgeUrl: string | undefined = getSettings().bridgeApiUrl): string {
  if (!bridgeUrl) {
    throw new Error(NOT_CONFIGURED);
  }

  return new URL(bridgeUrl).origin;
}

// `path` is appended to bridge's origin; a URL instance is used as given (for callers that keep a full route in Settings).
export async function bridgeFetch(path: string | URL, options: BridgeFetchOptions = {}): Promise<Response> {
  const { apiKey = getSettings().bridgeApiKey, method, json, timeoutMs = BRIDGE_TIMEOUT_MS, bridgeUrl } = options;

  if (!apiKey) {
    throw new Error(NOT_CONFIGURED);
  }

  const url = typeof path === 'string' ? `${bridgeOrigin(bridgeUrl)}${path}` : path;
  const headers: Record<string, string> = { 'X-Api-Key': apiKey };

  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error) => {
    throw describeFetchError(error, url);
  });
}

export async function bridgeErrorMessage(response: Response, prefix = 'Bridge API вернул ошибку'): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;

  return `${prefix} ${response.status}${message ? `: ${message}` : ''}`;
}
