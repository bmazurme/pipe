import { request } from 'undici';

import { bearer, bridgeFetch } from './bridgeHttp.js';
import { resolveDispatcher } from './proxyAgent.js';

// End-to-end checks of the worker's own way out: not "does the VPN server accept a connection" (bridge's channel probes say that) but
// "does a request go THROUGH the tunnel to the service this worker needs". Made through the proxy the worker really uses (its own Xray
// tunnel, or the stack's vpn-client), once a minute, and reported to bridge under this worker's name: bridge's «Каналы связи» tile shows
// them as a row per target, and a Claude API that no worker can reach is a problem there. The keys are the vocabulary of
// bridge/apps/backend/src/links/e2e.ts.

export interface E2eTarget {
  key: string;
  url: string;
}

export const E2E_TARGETS: E2eTarget[] = [
  { key: 'e2e:claude', url: 'https://api.anthropic.com/' },
  { key: 'e2e:telegram', url: 'https://api.telegram.org/' },
  // GitHub's own «how much of my limit is left» endpoint: answers 200 and does not count against the anonymous 60-an-hour limit of the tunnel's
  // exit address, which a probe every minute on every worker would otherwise use up (and then get 403 for).
  { key: 'e2e:github', url: 'https://api.github.com/rate_limit' },
];

export type E2eResultName = 'ok' | 'tcp_refused' | 'tls_timeout' | 'tls_reset' | 'error';

export interface E2eOutcome {
  key: string;
  result: E2eResultName;
  /** The whole request in milliseconds, when it got an answer. */
  tcpMs?: number;
  detail?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
// undici sends no User-Agent of its own, and GitHub's API answers such a request with 403 («Request forbidden by administrative rules»).
export const PROBE_HEADERS = { 'user-agent': 'pipe-worker-e2e-probe' };
const PROBE_EVERY_MS = 60_000;

export interface ProbeLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

// What an answer means. Anthropic answers a request from a region it refuses with 403 «Request not allowed» (what a Russian address gets
// when the tunnel is down, and what a bad exit gives), where a good exit gets a 404 for this address: so a 403 is a failure, like a 5xx.
export function classifyStatus(status: number): { result: E2eResultName; detail?: string } {
  if (status === 403 || status >= 500) return { result: 'error', detail: `HTTP ${status}` };

  return { result: 'ok' };
}

// What a request that threw means: the tunnel's proxy refusing connections (it is down), silence (throttling), a reset, anything else.
export function classifyError(error: unknown): { result: E2eResultName; detail: string } {
  const err = error as { name?: string; code?: string; message?: string; cause?: { code?: string } } | undefined;
  const code = err?.code ?? err?.cause?.code;

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return { result: 'tls_timeout', detail: 'timeout' };
  }
  if (code === 'ECONNREFUSED') return { result: 'tcp_refused', detail: 'proxy' };
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return { result: 'tls_reset', detail: code };

  return { result: 'error', detail: (code ?? err?.message ?? 'error').slice(0, 60) };
}

export type RequestFn = (url: string, proxyUrl: string, timeoutMs: number) => Promise<number>;

// One GET through the proxy; only the status matters, the body is thrown away.
const defaultRequest: RequestFn = async (url, proxyUrl, timeoutMs) => {
  const response = await request(url, {
    method: 'GET',
    headers: PROBE_HEADERS,
    dispatcher: resolveDispatcher(proxyUrl),
    signal: AbortSignal.timeout(timeoutMs),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });

  await response.body.dump();

  return response.statusCode;
};

export async function probeTarget(
  target: E2eTarget,
  proxyUrl: string,
  options: { timeoutMs?: number; request?: RequestFn; now?: () => number } = {},
): Promise<E2eOutcome> {
  const now = options.now ?? Date.now;
  const started = now();

  try {
    const status = await (options.request ?? defaultRequest)(target.url, proxyUrl, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const verdict = classifyStatus(status);

    return { key: target.key, ...verdict, tcpMs: now() - started };
  } catch (error) {
    return { key: target.key, ...classifyError(error) };
  }
}

export interface TunnelProbeOptions {
  apiUrl: string;
  log?: ProbeLog;
  targets?: E2eTarget[];
  intervalMs?: number;
  now?: () => number;
  request?: RequestFn;
  send?: (apiUrl: string, key: string, results: E2eOutcome[]) => Promise<void>;
}

// Best-effort like the other reports: an old bridge without the route, a timeout, anything — the worker's work never depends on it.
export async function reportE2e(apiUrl: string, key: string, results: E2eOutcome[]): Promise<void> {
  try {
    await bridgeFetch(
      `${apiUrl}/api/v1/worker/links`,
      { method: 'POST', headers: bearer(key, true), body: JSON.stringify({ results }) },
      { expectOk: 'Reporting through-tunnel probes' },
    );
  } catch {
    // Deliberately ignored — see above.
  }
}

// Decides on every settings fetch whether a round is due (about once a minute), and runs it beside the polling — never waiting, never
// throwing, never two at once. Without a proxy there is no tunnel to check, and nothing is reported.
export class TunnelProbe {
  private running = false;
  private lastRoundAt = 0;

  constructor(private readonly options: TunnelProbeOptions) {}

  consider(remote: { proxyUrl?: string | null }, key: string): void {
    const proxyUrl = remote.proxyUrl?.trim();
    const now = (this.options.now ?? Date.now)();

    if (!proxyUrl || this.running || now - this.lastRoundAt < (this.options.intervalMs ?? PROBE_EVERY_MS)) return;

    this.running = true;
    this.lastRoundAt = now;

    void this.round(proxyUrl, key).finally(() => {
      this.running = false;
    });
  }

  private async round(proxyUrl: string, key: string): Promise<void> {
    try {
      const results: E2eOutcome[] = [];

      for (const target of this.options.targets ?? E2E_TARGETS) {
        results.push(await probeTarget(target, proxyUrl, { request: this.options.request, now: this.options.now }));
      }

      await (this.options.send ?? reportE2e)(this.options.apiUrl, key, results);
    } catch (error) {
      this.options.log?.warn({ err: error }, 'through-tunnel probe failed');
    }
  }
}
