import { ProxyAgent, type Dispatcher } from 'undici';

// Built once per proxy URL rather than per-request — ProxyAgent keeps its
// own connection pool, so a fresh instance per call would defeat that.
let cached: { url: string; agent: Dispatcher } | undefined;

// Returns undefined when no proxy is configured, so callers can pass the
// result straight through to fetch's `dispatcher` option unconditionally
// (an `undefined` dispatcher just means "use the default").
export function resolveDispatcher(proxyUrl: string | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined;

  if (cached?.url !== proxyUrl) {
    cached = { url: proxyUrl, agent: new ProxyAgent(proxyUrl) };
  }

  return cached.agent;
}
