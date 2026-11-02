import { readFusionConfig } from './config.js';
import { FusionClient } from './client.js';

const CACHE_MS = 30_000;
const HEALTH_TIMEOUT_MS = 2_000;

// Is Fusion 360 answering on this machine right now: the add-in's config file is there and /health replies.
export async function fusionReady(): Promise<boolean> {
  try {
    const client = new FusionClient(readFusionConfig(), (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) }),
    );

    await client.health();

    return true;
  } catch {
    return false;
  }
}

// The capabilities to report as unavailable before a claim; the check is cached so a short poll interval does not hit Fusion each time.
export function makeUnavailableCapabilities(
  check: () => Promise<boolean> = fusionReady,
  now: () => number = Date.now,
): () => Promise<string[]> {
  let cached: { at: number; ready: boolean } | null = null;

  return async () => {
    if (!cached || now() - cached.at >= CACHE_MS) cached = { at: now(), ready: await check() };

    return cached.ready ? [] : ['fusion'];
  };
}
