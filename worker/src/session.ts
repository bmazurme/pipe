import type { WorkerConfig } from './config.js';
import { clearCredentials, loadCredentials, saveCredentials, type StoredCredentials } from './credentials.js';
import { enrollWorker, EnrollmentRejectedError } from './enrollment.js';

// Who this process is to bridge. 'legacy': a personal API key from the environment (the old way, still supported).
// 'managed': a worker added in the UI, holding its own key from enrolment — no secret in its environment.
export interface Session {
  mode: 'legacy' | 'managed';
  key: string;
  name: string;
}

export interface SessionDeps {
  version: string;
  enroll?: (bridgeApiUrl: string, code: string, version: string) => Promise<StoredCredentials>;
  load?: (stateDir: string, bridgeApiUrl: string) => StoredCredentials | null;
  save?: (stateDir: string, credentials: StoredCredentials) => void;
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

const NOT_ENROLLED_HINT_EVERY_MS = 60_000;
const RECHECK_EVERY_MS = 5_000;

// The session this process can start with right now, or null when it has not been enrolled yet. In order: a personal
// API key from the environment; a key stored by an earlier enrolment; a one-time code from the environment (redeemed
// once, the key is stored). `rejectedCodes` remembers codes bridge refused, so a stale one is not tried again every few
// seconds against a rate-limited endpoint.
export async function resolveSession(
  config: WorkerConfig,
  deps: SessionDeps,
  rejectedCodes: Set<string> = new Set(),
): Promise<Session | null> {
  if (config.bridgeApiKey) {
    return { mode: 'legacy', key: config.bridgeApiKey, name: config.workerName };
  }

  const stored = (deps.load ?? loadCredentials)(config.stateDir, config.bridgeApiUrl);

  if (stored) {
    return { mode: 'managed', key: stored.key, name: stored.name };
  }

  if (config.enrollCode && !rejectedCodes.has(config.enrollCode)) {
    try {
      const credentials = await (deps.enroll ?? enrollWorker)(config.bridgeApiUrl, config.enrollCode, deps.version);

      (deps.save ?? saveCredentials)(config.stateDir, credentials);
      deps.log?.info({ workerId: credentials.workerId, name: credentials.name }, 'enrolled with bridge — the key is stored; the code is no longer needed');

      return { mode: 'managed', key: credentials.key, name: credentials.name };
    } catch (error) {
      if (error instanceof EnrollmentRejectedError) {
        rejectedCodes.add(config.enrollCode);
      }

      deps.log?.error({ err: error }, 'enrolment with the code from WORKER_ENROLL_CODE failed');
    }
  }

  return null;
}

// Waits until the worker can start: it is enrolled from outside too (`node dist/enrollCli.js <code>` writes the key to
// the state directory), so it keeps looking until it appears — or the process is asked to stop.
export async function waitForSession(
  config: WorkerConfig,
  deps: SessionDeps,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<Session | null> {
  const rejected = new Set<string>();
  let lastHint = 0;

  while (!signal?.aborted) {
    const session = await resolveSession(config, deps, rejected);

    if (session) return session;

    if (Date.now() - lastHint >= NOT_ENROLLED_HINT_EVERY_MS) {
      lastHint = Date.now();
      deps.log?.warn(
        { stateDir: config.stateDir },
        'this worker is not enrolled: add it on the Worker page of bridge, then run `node dist/enrollCli.js <code>` here (or start it with WORKER_ENROLL_CODE=<code>)',
      );
    }

    await sleep(RECHECK_EVERY_MS, signal);
  }

  return null;
}

// bridge no longer accepts this worker's key (it was deleted or reconnected there): forget the key, so a restart does
// not present it again, and go back to waiting for a new enrolment.
export function forgetRevokedKey(config: WorkerConfig): void {
  clearCredentials(config.stateDir);
}
