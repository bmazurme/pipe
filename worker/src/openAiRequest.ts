import type { OpenAiCompatibleConfig } from './providers.js';
import { chooseRoute, type RouteDecision } from './routing.js';

// One completion may take minutes (a long answer, or a local model loading); without a bound a hung server would block the
// job or turn forever. A key can raise it for slow local models.
export const DEFAULT_COMPLETION_TIMEOUT_MS = 300_000;

// Headers a key may not set: they are the request's own.
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding']);

export function completionTimeoutMs(config: Pick<OpenAiCompatibleConfig, 'timeoutSec'>): number {
  return config.timeoutSec && config.timeoutSec > 0 ? config.timeoutSec * 1000 : DEFAULT_COMPLETION_TIMEOUT_MS;
}

// The request headers for a model server: the key by its scheme, the key's extra headers (a Yandex folder id, …), JSON body.
export function completionHeaders(config: Pick<OpenAiCompatibleConfig, 'apiKey' | 'authScheme' | 'extraHeaders'>): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(config.extraHeaders ?? {})) {
    if (!FORBIDDEN_HEADERS.has(name.trim().toLowerCase())) headers[name] = value;
  }

  const scheme = config.authScheme ?? 'bearer';

  if (scheme === 'bearer') headers.Authorization = `Bearer ${config.apiKey}`;
  else if (scheme === 'api-key') headers.Authorization = `Api-Key ${config.apiKey}`;

  headers['Content-Type'] = 'application/json';

  return headers;
}

// Where this request goes, from the key and from the proxy the worker has right now.
export function routeFor(config: Pick<OpenAiCompatibleConfig, 'baseUrl' | 'route'>, proxyUrl: string | undefined): RouteDecision {
  return chooseRoute({ url: config.baseUrl, route: config.route, proxyUrl });
}
