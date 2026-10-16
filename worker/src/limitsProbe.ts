import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { reportClaudeUsage } from './bridgeHttp.js';
import { runClaude, type RunResult } from './modelRunners/claudeRunner.js';
import type { RemoteWorkerConfig } from './remoteConfig.js';

type Run = (cwd: string, token: string, proxyUrl: string | undefined, model: string) => Promise<RunResult>;

export interface ProbeLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

// The owner's request is only honoured while it is fresh (bridge stops sending the token after the same time).
const REQUEST_VALID_MS = 10 * 60 * 1000;
// The cheapest model first; a token that cannot use it (or a network that stalls on it) must not leave the card without an answer, so
// the next one is tried — and the one that worked is remembered for the later probes. Each attempt is short: a hung CLI is not waited for.
export const PROBE_MODELS = ['haiku', 'sonnet'];
const PROBE_TIMEOUT_MS = 45_000;

// One tiny Claude call — a bare system prompt, no tools, the smallest model, about 4k tokens — whose only purpose is the plan-limit
// event the CLI reports with every response. It is how a worker's numbers are refreshed without a job: when the owner presses
// "refresh" on its card, and, if chosen in its settings, every N minutes.
export async function runLimitsProbe(
  cwd: string,
  token: string,
  proxyUrl: string | undefined,
  model: string = PROBE_MODELS[0],
): Promise<RunResult> {
  mkdirSync(cwd, { recursive: true });

  return runClaude(cwd, 'ok', model, () => undefined, proxyUrl, token, PROBE_TIMEOUT_MS, undefined, undefined, undefined, [
    '--system-prompt',
    'Reply with OK.',
    '--tools',
    '',
  ]);
}

export interface LimitsProbeOptions {
  apiUrl: string;
  workDir: string;
  log?: ProbeLog;
  now?: () => number;
  run?: Run;
  send?: typeof reportClaudeUsage;
}

// Decides on every settings fetch whether a probe is due, and runs it beside the polling — never waiting, never throwing, never two at
// once. A failed probe counts as done for its trigger (an interval waits for its next turn, a request is not retried in a loop).
export class LimitsProbe {
  private running = false;
  private lastProbeAt = 0;
  private lastRequestHandled = 0;
  // Index into PROBE_MODELS of the model that last worked (or 0 until one did).
  private modelIndex = 0;

  constructor(private readonly options: LimitsProbeOptions) {}

  private due(remote: RemoteWorkerConfig, now: number): 'request' | 'interval' | null {
    const requested = remote.limitsRefreshRequestedAt ? new Date(remote.limitsRefreshRequestedAt).getTime() : 0;

    if (requested > this.lastRequestHandled && now - requested < REQUEST_VALID_MS) return 'request';

    const everyMs = (remote.limitsRefreshMin ?? 0) * 60_000;

    if (everyMs > 0 && now - this.lastProbeAt >= everyMs) return 'interval';

    return null;
  }

  consider(remote: RemoteWorkerConfig, key: string): void {
    const token = remote.limitProbe?.claudeToken;
    const now = (this.options.now ?? Date.now)();

    if (this.running || !token) return;

    const why = this.due(remote, now);

    if (!why) return;

    this.running = true;
    this.lastProbeAt = now;

    if (why === 'request') {
      this.lastRequestHandled = remote.limitsRefreshRequestedAt ? new Date(remote.limitsRefreshRequestedAt).getTime() : now;
    }

    void this.probe(token, remote.proxyUrl?.trim() || undefined, key, why).finally(() => {
      this.running = false;
    });
  }

  private async probe(token: string, proxyUrl: string | undefined, key: string, why: string): Promise<void> {
    const run = this.options.run ?? ((cwd, t, proxy, model) => runLimitsProbe(cwd, t, proxy, model));
    const cwd = path.join(this.options.workDir, 'limits-probe');
    let failure: unknown;

    // Start with the model that worked last time, then try the others in order.
    for (let step = 0; step < PROBE_MODELS.length; step += 1) {
      const index = (this.modelIndex + step) % PROBE_MODELS.length;
      const model = PROBE_MODELS[index];

      try {
        const result = await run(cwd, token, proxyUrl, model);

        if (result.report?.limits) {
          this.modelIndex = index;
          await (this.options.send ?? reportClaudeUsage)(this.options.apiUrl, key, { limits: result.report.limits, probe: true });
          this.options.log?.info({ why, model }, 'limits probe: reported');

          return;
        }

        failure = new Error(`the CLI reported no limits (exit ${result.exitCode})`);
        this.options.log?.warn({ exitCode: result.exitCode, why, model }, 'limits probe: the CLI reported no limits');
      } catch (error) {
        failure = error;
        this.options.log?.warn({ err: error, why, model }, 'limits probe failed');
      }
    }

    this.options.log?.warn({ err: failure, why }, 'limits probe: no model answered');
  }
}
