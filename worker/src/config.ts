import { hostname } from 'node:os';
import path from 'node:path';

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
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is not set — see worker/README.md for setup`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    bridgeApiUrl: required(env, 'BRIDGE_API_URL').replace(/\/$/, ''),
    bridgeApiKey: required(env, 'BRIDGE_API_KEY'),
    pollIntervalSec: Number(env.POLL_INTERVAL_SEC ?? '10'),
    workDir: env.WORKER_WORK_DIR ?? path.join(process.cwd(), '.worker-work'),
    // Purely informational (shown in bridge's job list) — falls back to the
    // machine's own hostname so multiple worker instances are distinguishable
    // without extra configuration.
    workerName: env.WORKER_NAME ?? hostname(),
    proxyUrl: env.WORKER_PROXY_URL,
  };
}
