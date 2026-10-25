import { hostname } from 'node:os';
import path from 'node:path';

import { parseChatToolsMode, type ChatToolsMode } from './chatTools.js';

export interface WorkerConfig {
  bridgeApiUrl: string;
  // A personal API key from the environment — the legacy way. Absent for a worker added in the UI: it enrols with a
  // one-time code and keeps its own key in stateDir (see credentials.ts).
  bridgeApiKey?: string;
  // Where an enrolled worker keeps its key (a volume in Docker); never the work directory, which is wiped per job.
  stateDir: string;
  // A one-time code from the Worker page; only used while the worker has no stored key.
  enrollCode?: string;
  pollIntervalSec: number;
  workDir: string;
  workerName: string;
  // HTTP proxy (not SOCKS5 — see README) for reaching AI providers from behind a geo-restricted
  // host — scoped to provider calls only (OpenAI-compatible fetches, and the
  // claude CLI's own env), never bridge's own API: bridge is reachable
  // directly from wherever worker runs, so routing that through the proxy
  // too would just add an unnecessary hop.
  proxyUrl?: string;
  // Max wall-clock seconds a claude CLI job may run before it's killed.
  jobTimeoutSec: number;
  // Max wall-clock seconds a claude CLI chat turn may run before it's killed; absent: CHAT_TURN_TIMEOUT_SEC.
  chatTimeoutSec?: number;
  // Seconds a running job may keep going after SIGTERM/SIGINT before it is stopped; 0 (default) = stop at once.
  shutdownGraceSec?: number;
  // Bridge-native tools for gpt/deepseek/qwen chat turns (chatTools.ts): off by
  // default; `read` looks at jobs/files/worker status, `write` may also start jobs.
  chatTools: ChatToolsMode;
  // OS user the claude CLI runs as (via sudo), so job code cannot read the worker's own key; absent: the worker's user.
  runAs?: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is not set — see worker/README.md for setup`);
  }
  return value;
}

const DEFAULT_JOB_TIMEOUT_SEC = 30 * 60;

export const CHAT_TURN_TIMEOUT_SEC = 10 * 60;

function parseChatTimeoutSec(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return CHAT_TURN_TIMEOUT_SEC;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`WORKER_CHAT_TIMEOUT_SEC must be a positive number of seconds, got "${raw}"`);
  }
  return value;
}

function parseJobTimeoutSec(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_JOB_TIMEOUT_SEC;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`WORKER_JOB_TIMEOUT_SEC must be a positive number of seconds, got "${raw}"`);
  }
  return value;
}

function parseShutdownGraceSec(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`WORKER_SHUTDOWN_GRACE_SEC must be a non-negative number of seconds, got "${raw}"`);
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
    bridgeApiKey: env.BRIDGE_API_KEY?.trim() || undefined,
    stateDir: env.WORKER_STATE_DIR ?? path.join(process.cwd(), '.worker-state'),
    enrollCode: env.WORKER_ENROLL_CODE?.trim() || undefined,
    pollIntervalSec: pollInterval(env),
    workDir: env.WORKER_WORK_DIR ?? path.join(process.cwd(), '.worker-work'),
    // Purely informational (shown in bridge's job list) — falls back to the
    // machine's own hostname so multiple worker instances are distinguishable
    // without extra configuration.
    workerName: env.WORKER_NAME ?? hostname(),
    proxyUrl: env.WORKER_PROXY_URL,
    jobTimeoutSec: parseJobTimeoutSec(env.WORKER_JOB_TIMEOUT_SEC),
    chatTimeoutSec: parseChatTimeoutSec(env.WORKER_CHAT_TIMEOUT_SEC),
    shutdownGraceSec: parseShutdownGraceSec(env.WORKER_SHUTDOWN_GRACE_SEC),
    chatTools: parseChatToolsMode(env.WORKER_CHAT_TOOLS),
    runAs: env.WORKER_RUN_AS?.trim() || undefined,
  };
}
