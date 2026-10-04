import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export interface StatusPaths {
  syncState: string;
  syncAgentState: string;
  gitlabWorkerState: string;
  reportsState: string;
}

export const DEFAULT_PATHS: StatusPaths = {
  syncState: path.join(REPO_ROOT, 'sync', '.sync-state.json'),
  syncAgentState: path.join(REPO_ROOT, 'sync', '.sync-agent-state.json'),
  gitlabWorkerState: path.join(REPO_ROOT, 'sync', '.gitlab-worker-state.json'),
  reportsState: path.join(
    REPO_ROOT,
    'reports',
    'packages',
    'server',
    'src',
    'subscription',
    'subscription-state.json',
  ),
};

export interface SyncState {
  [projectName: string]: { lastHash: string };
}

// Mirrors sync/src/types.ts's AgentRunnerState exactly: a dedup marker so
// agent-runner doesn't mistake its own push-back for a fresh incoming
// parcel, not a progress record — there is no richer "pending" state on
// this side to show.
export interface SyncAgentEntry {
  lastOwnOutputHash: string;
}

// Mirrors sync/src/gitlabWorkerState.ts's GitlabWorkerState — the one
// sync-side file with real per-issue data: which issues gitlab-worker has
// already turned into a pushed parcel, and when.
export interface GitlabWorkerEntry {
  pushedAt: string;
  filename: string;
}

export interface SubscriptionEntry {
  step: string;
  branch?: string;
  parcelId?: number;
  pushedAt?: string;
  pulledAt?: string;
  publishedAt?: string;
  encrypted?: boolean;
  manual?: boolean;
  title?: string;
}

export interface TaskEntry {
  key: string;
  gitlabWorker?: GitlabWorkerEntry;
  syncAgent?: SyncAgentEntry;
  subscription?: SubscriptionEntry;
}

export interface ReportData {
  errors: string[];
  syncState: SyncState;
  tasks: TaskEntry[];
}

interface ReadResult<T> {
  value: T | undefined;
  error?: string;
}

// Returns the parse error as data (instead of logging it directly) so
// collectReportData can fold it into the report — keeping this function
// pure and unit-testable without mocking console.
export function readJson<T>(filePath: string): ReadResult<T> {
  if (!existsSync(filePath)) return { value: undefined };

  try {
    return { value: JSON.parse(readFileSync(filePath, 'utf-8')) as T };
  } catch (error) {
    return { value: undefined, error: `state file at ${filePath} is malformed: ${(error as Error).message}` };
  }
}

// Splits "projectId:iid" and compares both segments numerically when
// possible, so "2:5" sorts before "173:628" instead of after it (plain
// string comparison puts "1" before "2" character-by-character, which
// breaks for multi-digit ids). Falls back to string comparison for a
// segment that isn't purely numeric — a manual entry's iid looks like
// "m-<base36>".
export function compareIssueKeys(a: string, b: string): number {
  const [aProject, aIid] = a.split(':');
  const [bProject, bIid] = b.split(':');

  const compareSegment = (x: string, y: string): number => {
    const xNum = Number(x);
    const yNum = Number(y);
    if (Number.isFinite(xNum) && Number.isFinite(yNum)) return xNum - yNum;
    return x.localeCompare(y);
  };

  const projectCompare = compareSegment(aProject, bProject);
  return projectCompare !== 0 ? projectCompare : compareSegment(aIid ?? '', bIid ?? '');
}

// Reads and merges all four state files into one structured view — the
// single source of truth both the text formatter and --json mode render
// from, so they can never drift apart.
export function collectReportData(paths: StatusPaths): ReportData {
  const syncState = readJson<SyncState>(paths.syncState);
  const syncAgentState = readJson<Record<string, SyncAgentEntry>>(paths.syncAgentState);
  const gitlabWorkerState = readJson<Record<string, GitlabWorkerEntry>>(paths.gitlabWorkerState);
  const subscriptionState = readJson<Record<string, SubscriptionEntry>>(paths.reportsState);

  const errors = [syncState.error, syncAgentState.error, gitlabWorkerState.error, subscriptionState.error]
    .filter((error): error is string => Boolean(error));

  const keys = new Set([
    ...Object.keys(syncAgentState.value ?? {}),
    ...Object.keys(gitlabWorkerState.value ?? {}),
    ...Object.keys(subscriptionState.value ?? {}),
  ]);

  const tasks: TaskEntry[] = [...keys].sort(compareIssueKeys).map((key) => ({
    key,
    gitlabWorker: gitlabWorkerState.value?.[key],
    syncAgent: syncAgentState.value?.[key],
    subscription: subscriptionState.value?.[key],
  }));

  return { errors, syncState: syncState.value ?? {}, tasks };
}

// Scopes a report to one project ("402") or one issue ("402:6") — matches
// on the key's project segment, or the whole key.
export function filterReportData(data: ReportData, filter: string | undefined): ReportData {
  if (!filter) return data;

  const tasks = data.tasks.filter((task) => task.key === filter || task.key.startsWith(`${filter}:`));
  return { ...data, tasks };
}
