import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';

import {
  agentRunnerStateSchema,
  gitlabWorkerStateSchema,
  parseState,
  subscriptionStateSchema,
  syncStateSchema,
  type AgentRunnerStateEntry,
  type GitlabWorkerStateEntry,
  type SubscriptionStateEntry,
  type SyncState,
} from '@pipe/protocol/state';

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

// Shared with sync's and reports' own readers/writers of the same files
// (@pipe/protocol/state, IMPROVEMENTS_HARNESS.md 6.1) — previously each of
// these was a hand-copied interface here ("Mirrors sync/src/types.ts's
// AgentRunnerState exactly", a comment, not an enforced guarantee) that
// could silently drift from what a writer actually produces.
export type { SyncState };
export type SyncAgentEntry = AgentRunnerStateEntry;
export type GitlabWorkerEntry = GitlabWorkerStateEntry;
export type SubscriptionEntry = SubscriptionStateEntry;

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

// Reads a JSON state file and validates it against the given schema in one
// pass — a missing file is fine (nothing pushed/pulled yet), but malformed
// JSON *or* well-formed JSON in the wrong shape (a writer's own schema
// drifting from what this file actually expects) both come back as data
// (instead of logging/throwing directly), so collectReportData can fold
// either into the report. Keeps this pure and unit-testable without mocking
// console.
function readValidatedJson<T extends z.ZodTypeAny>(
  filePath: string,
  schema: T,
): ReadResult<z.infer<T>> {
  if (!existsSync(filePath)) return { value: undefined };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    return { value: undefined, error: `state file at ${filePath} is malformed: ${(error as Error).message}` };
  }

  const result = parseState(schema, raw);
  if ('error' in result) {
    return { value: undefined, error: `state file at ${filePath} is malformed: ${result.error}` };
  }
  return { value: result.value };
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
  const syncState = readValidatedJson(paths.syncState, syncStateSchema);
  const syncAgentState = readValidatedJson(paths.syncAgentState, agentRunnerStateSchema);
  const gitlabWorkerState = readValidatedJson(paths.gitlabWorkerState, gitlabWorkerStateSchema);
  const subscriptionState = readValidatedJson(paths.reportsState, subscriptionStateSchema);

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
