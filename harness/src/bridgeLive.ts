import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.resolve(__dirname, '..', '..', 'sync');

// Deliberately reuses sync's own credential/config files rather than
// inventing a third set (IMPROVEMENTS_HARNESS.md 1.1 names this explicitly:
// "через API-ключ bridge, тот же механизм, что у sync/worker") — harness
// has no bridge account concept of its own, it just borrows whatever this
// machine already logged sync-cli into. A refresh-token login still works
// for sync itself, but a live check here needs the static API key
// specifically (no refresh-rotation dance for what's meant to be a cheap,
// read-only, non-interactive report).
export interface BridgeLiveConfigPaths {
  syncCredentials: string;
  syncConfig: string;
}

// Same override-ability as collect.ts's StatusPaths/DEFAULT_PATHS — lets
// tests point this at fixture files instead of this machine's real
// sync/.sync-credentials.json.
export const DEFAULT_BRIDGE_LIVE_CONFIG_PATHS: BridgeLiveConfigPaths = {
  syncCredentials: path.join(SYNC_ROOT, '.sync-credentials.json'),
  syncConfig: path.join(SYNC_ROOT, 'sync.config.json'),
};

const API_TIMEOUT_MS = 20_000;

export interface BridgeLiveConfig {
  apiUrl: string;
  apiKey: string;
}

// Returns undefined (not a thrown error) when there's simply nothing to log
// in with yet — same "absence is fine, malformed is an error" split
// collect.ts's readValidatedJson already uses for the other state files.
export function loadBridgeLiveConfig(
  paths: BridgeLiveConfigPaths = DEFAULT_BRIDGE_LIVE_CONFIG_PATHS,
): BridgeLiveConfig | undefined {
  if (!existsSync(paths.syncCredentials) || !existsSync(paths.syncConfig)) return undefined;

  const credentials = JSON.parse(readFileSync(paths.syncCredentials, 'utf-8')) as { apiKey?: string };
  if (!credentials.apiKey) return undefined;

  const config = JSON.parse(readFileSync(paths.syncConfig, 'utf-8')) as { bridge?: { apiUrl?: string } };
  if (!config.bridge?.apiUrl) return undefined;

  return { apiUrl: config.bridge.apiUrl, apiKey: credentials.apiKey };
}

interface WorkerHeartbeatStatusWire {
  name: string;
  lastSeenAt: string;
  isUp: boolean;
}

interface WorkerStatusWire {
  isUp: boolean;
  workers: WorkerHeartbeatStatusWire[];
}

interface StoredFileWire {
  id: number;
  taskKey: string | null;
  direction: 'outbound' | 'result' | null;
}

interface JobWire {
  id: number;
  sourceFileId: number | null;
  resultFileId: number | null;
  model: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// Never carries the token value — ClaudeCredentialResponseDto on the
// bridge side doesn't either (IMPROVEMENTS_HARNESS.md 1.5).
interface ClaudeCredentialWire {
  id: number;
  name: string;
  createdAt: string;
}

// A thin, read-only client — deliberately not sync's own BridgeClient
// (which also handles upload/download/refresh-token rotation this never
// needs). If IMPROVEMENTS_TECH.md 2.1 (a shared bridge HTTP client) lands
// first, this should be rebuilt on top of it instead of duplicating a third
// fetch-with-timeout wrapper.
class BridgeLiveClient {
  constructor(private readonly config: BridgeLiveConfig) {}

  private async getJson<T>(urlPath: string): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${urlPath}`, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${urlPath} failed (${response.status})`);
    }

    return (await response.json()) as T;
  }

  getWorkerStatus(): Promise<WorkerStatusWire> {
    return this.getJson('/api/v1/worker/status');
  }

  listStorageFiles(): Promise<StoredFileWire[]> {
    return this.getJson('/api/v1/storage');
  }

  listJobs(): Promise<JobWire[]> {
    return this.getJson('/api/v1/worker/jobs');
  }

  listClaudeCredentials(): Promise<ClaudeCredentialWire[]> {
    return this.getJson('/api/v1/worker/claude-credentials');
  }
}

export interface LiveWorkerInfo {
  isUp: boolean;
  workers: WorkerHeartbeatStatusWire[];
}

export interface LiveJobInfo {
  id: number;
  status: string;
  model: string;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface LiveTaskInfo {
  hasResultInStorage: boolean;
  job?: LiveJobInfo;
}

export interface LiveClaudeCredential {
  name: string;
  createdAt: string;
}

export interface LiveData {
  worker: LiveWorkerInfo;
  tasks: Map<string, LiveTaskInfo>;
  // IMPROVEMENTS_HARNESS.md 1.5 ("assistant resources"), VPN-half only:
  // just the configured Claude credentials, not VPN panel status — the VPN
  // endpoints (/api/v1/vpn/*) are deliberately JwtGuard-only (browser
  // session, not JwtOrApiKeyGuard), the same provisioning-credential
  // exposure reasoning as IMPROVEMENTS_TECH.md 1.4 — sync-cli's bridge API
  // key this file already uses for worker/storage/jobs has no business
  // reaching them, and widening that guard just for a status display isn't
  // a call to make here.
  claudeCredentials: LiveClaudeCredential[];
}

export type LiveStatusResult = { available: true; data: LiveData } | { available: false; reason: string };

// GET /storage lists every stored file for this account, addressed or not
// (manual Purge uploads have no taskKey/channel at all) — only the
// addressed ones are useful here, to join a Worker job's bare
// sourceFileId/resultFileId back to the "projectId:iid" task it belongs to.
// Mirrors the propagation WorkerService.setResult already does server-side
// (a result file inherits its source file's taskKey), so a job claimed
// against an addressed source file always resolves to a task key here too.
function buildLiveData(
  workerStatus: WorkerStatusWire,
  files: StoredFileWire[],
  jobs: JobWire[],
  claudeCredentials: ClaudeCredentialWire[],
): LiveData {
  const taskKeyByFileId = new Map<number, string>();
  const hasResultByTaskKey = new Map<string, boolean>();
  // Every addressed file's taskKey counts as "known to bridge," not just
  // ones with a result — otherwise a task that's only been pushed so far
  // (outbound file, no result yet) gets no entry at all here, and
  // deriveStatus can't tell "confirmed: no result yet" apart from "no live
  // data for this task."
  const knownTaskKeys = new Set<string>();

  for (const file of files) {
    if (!file.taskKey) continue;
    taskKeyByFileId.set(file.id, file.taskKey);
    knownTaskKeys.add(file.taskKey);
    if (file.direction === 'result') hasResultByTaskKey.set(file.taskKey, true);
  }

  const latestJobByTaskKey = new Map<string, JobWire>();
  for (const job of jobs) {
    const taskKey = (job.sourceFileId !== null ? taskKeyByFileId.get(job.sourceFileId) : undefined) ?? (job.resultFileId !== null ? taskKeyByFileId.get(job.resultFileId) : undefined);
    if (!taskKey) continue;

    const existing = latestJobByTaskKey.get(taskKey);
    if (!existing || Date.parse(job.createdAt) > Date.parse(existing.createdAt)) {
      latestJobByTaskKey.set(taskKey, job);
    }
  }

  const tasks = new Map<string, LiveTaskInfo>();
  const taskKeys = new Set([...knownTaskKeys, ...latestJobByTaskKey.keys()]);
  for (const taskKey of taskKeys) {
    const job = latestJobByTaskKey.get(taskKey);
    tasks.set(taskKey, {
      hasResultInStorage: hasResultByTaskKey.get(taskKey) ?? false,
      ...(job
        ? {
            job: {
              id: job.id,
              status: job.status,
              model: job.model,
              errorMessage: job.errorMessage,
              createdAt: job.createdAt,
              finishedAt: job.finishedAt,
            },
          }
        : {}),
    });
  }

  return {
    worker: workerStatus,
    tasks,
    claudeCredentials: claudeCredentials.map((credential) => ({ name: credential.name, createdAt: credential.createdAt })),
  };
}

// Never throws — a live check failing (no credentials, bridge unreachable,
// an expired API key) just means the caller falls back to the existing
// offline report, same "errors as data" convention collect.ts already uses
// for a malformed state file.
export async function fetchLiveStatus(
  paths: BridgeLiveConfigPaths = DEFAULT_BRIDGE_LIVE_CONFIG_PATHS,
): Promise<LiveStatusResult> {
  const config = loadBridgeLiveConfig(paths);
  if (!config) {
    return {
      available: false,
      reason:
        'no bridge API key configured for sync-cli — run "sync-cli login-api-key <key>" once (see sync/README.md)',
    };
  }

  const client = new BridgeLiveClient(config);

  try {
    const [workerStatus, files, jobs, claudeCredentials] = await Promise.all([
      client.getWorkerStatus(),
      client.listStorageFiles(),
      client.listJobs(),
      client.listClaudeCredentials(),
    ]);

    return { available: true, data: buildLiveData(workerStatus, files, jobs, claudeCredentials) };
  } catch (error) {
    return { available: false, reason: `bridge live check failed: ${(error as Error).message}` };
  }
}
