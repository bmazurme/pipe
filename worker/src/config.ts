import { hostname } from 'node:os';
import path from 'node:path';

import { parseChatToolsMode, type ChatToolsMode } from './chatTools.js';

export interface WorkerConfig {
  bridgeApiUrl: string;
  bridgeApiKey: string;
  pollIntervalSec: number;
  workDir: string;
  workerName: string;
  // SOCKS5/HTTP proxy for reaching AI providers from behind a geo-restricted
  // host — scoped to provider calls only (OpenAI-compatible fetches, and the
  // claude CLI's own env), never bridge's own API: bridge is reachable
  // directly from wherever worker runs, so routing that through the proxy
  // too would just add an unnecessary hop.
  proxyUrl?: string;
  // Max wall-clock seconds a claude CLI job may run before it's killed.
  jobTimeoutSec: number;
  // Bridge-native tools for gpt/deepseek/qwen chat turns (chatTools.ts): off by
  // default; `read` looks at jobs/files/worker status, `write` may also start jobs.
  chatTools: ChatToolsMode;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is not set — see worker/README.md for setup`);
  }
  return value;
}

const DEFAULT_JOB_TIMEOUT_SEC = 30 * 60;

function parseJobTimeoutSec(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_JOB_TIMEOUT_SEC;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`WORKER_JOB_TIMEOUT_SEC must be a positive number of seconds, got "${raw}"`);
  }
  return value;
}

function pollInterval(env: NodeJS.ProcessEnv): number {
  const value = Number(env.POLL_INTERVAL_SEC ?? '10');
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('POLL_INTERVAL_SEC must be a positive number');
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    bridgeApiUrl: required(env, 'BRIDGE_API_URL').replace(/\/$/, ''),
    bridgeApiKey: required(env, 'BRIDGE_API_KEY'),
    pollIntervalSec: pollInterval(env),
    workDir: env.WORKER_WORK_DIR ?? path.join(process.cwd(), '.worker-work'),
    // Purely informational (shown in bridge's job list) — falls back to the
    // machine's own hostname so multiple worker instances are distinguishable
    // without extra configuration.
    workerName: env.WORKER_NAME ?? hostname(),
    proxyUrl: env.WORKER_PROXY_URL,
    jobTimeoutSec: parseJobTimeoutSec(env.WORKER_JOB_TIMEOUT_SEC),
    chatTools: parseChatToolsMode(env.WORKER_CHAT_TOOLS),
  };
}
