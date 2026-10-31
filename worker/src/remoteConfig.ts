import { BridgeHttpError, bearer, bridgeFetch } from './bridgeHttp.js';
import type { WorkerConfig } from './config.js';
import { workerVersion } from './version.js';

// What the owner set for this worker on the Worker page. Fetched before every poll, so a change applies within one
// poll interval without restarting anything.
export interface RemoteWorkerConfig {
  id: number;
  name: string;
  enabled: boolean;
  models: string[] | null;
  pollIntervalSec: number;
  jobTimeoutSec: number;
  proxyUrl: string | null;
  chatEnabled: boolean;
  // The worker's own VPN (a vless:// Reality link), run as a local Xray tunnel — see vpn/tunnel.ts. Absent/null: none.
  vpnLink?: string | null;
  // Probing the Claude plan limits: every `limitsRefreshMin` minutes (0 = never by itself), once when the owner asked
  // (`limitsRefreshRequestedAt`), with the token bridge hands over only while a probe is due. Absent on an older bridge.
  limitsRefreshMin?: number;
  limitsRefreshRequestedAt?: string | null;
  limitProbe?: { claudeToken: string } | null;
}

// bridge no longer accepts this worker's key: it was deleted (or re-enrolled) on the Worker page.
export class WorkerRevokedError extends Error {
  constructor() {
    super('bridge no longer accepts this worker — it was deleted or reconnected on the Worker page');
    this.name = 'WorkerRevokedError';
  }
}

// The version goes with every fetch: bridge decides from it which jobs this worker may be given (a custom model needs 0.2.0),
// and the version recorded at enrolment goes stale on the first upgrade.
export async function fetchRemoteConfig(bridgeApiUrl: string, key: string, version: string = workerVersion()): Promise<RemoteWorkerConfig> {
  try {
    const response = await bridgeFetch(
      `${bridgeApiUrl}/api/v1/workers/me/config`,
      { headers: { ...bearer(key), 'X-Worker-Version': version } },
      { expectOk: 'Fetching worker settings' },
    );

    return (await response.json()) as RemoteWorkerConfig;
  } catch (error) {
    if (error instanceof BridgeHttpError && error.status === 401) {
      throw new WorkerRevokedError();
    }

    throw error;
  }
}

// The page's settings over what the environment said. A proxy that is not set on the page leaves the environment's one
// alone (a Swarm stack's internal VPN proxy keeps working until it is set there).
export function applyRemoteConfig(base: WorkerConfig, remote: RemoteWorkerConfig): WorkerConfig {
  return {
    ...base,
    workerName: remote.name,
    pollIntervalSec: remote.pollIntervalSec,
    jobTimeoutSec: remote.jobTimeoutSec,
    proxyUrl: remote.proxyUrl?.trim() ? remote.proxyUrl.trim() : base.proxyUrl,
  };
}
