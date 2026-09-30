#!/usr/bin/env node
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

interface SyncState {
  [projectName: string]: { lastHash: string };
}

// Mirrors sync/src/types.ts's AgentRunnerState exactly: a dedup marker so
// agent-runner doesn't mistake its own push-back for a fresh incoming
// parcel, not a progress record — there is no richer "pending" state on
// this side to show.
interface SyncAgentEntry {
  lastOwnOutputHash: string;
}

// Mirrors sync/src/gitlabWorkerState.ts's GitlabWorkerState — the one
// sync-side file with real per-issue data: which issues gitlab-worker has
// already turned into a pushed parcel, and when.
interface GitlabWorkerEntry {
  pushedAt: string;
  filename: string;
}

interface SubscriptionEntry {
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

export interface DerivedStatus {
  label: string;
  stale: boolean;
}

export interface AnnotatedTaskEntry extends TaskEntry {
  status: DerivedStatus;
}

export interface AnnotatedReportData extends ReportData {
  tasks: AnnotatedTaskEntry[];
}

export const DEFAULT_STALE_HOURS = 24;

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

function hoursSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / (60 * 60 * 1000);
}

// Synthesizes one combined label per task from whichever signals are
// present — this is the actual "merged view," versus just listing each
// side's raw fields next to each other. Reports' own `step` is the fullest
// single-file record of an issue's lifecycle when it's there; gitlab-worker
// + agent-runner's dedup hash are the best available signal when it isn't
// (e.g. this machine only runs sync-cli, not reports). All local-only — no
// bridge query, so "ready to pull" is an inference from what was last
// pushed locally, not a live check of what's still on bridge.
export function deriveStatus(task: TaskEntry, staleHours: number, now: number): DerivedStatus {
  const s = task.subscription;

  if (s) {
    switch (s.step) {
      case 'published':
        return { label: 'published — done', stale: false };
      case 'pulled': {
        const stale = Boolean(s.pulledAt) && hoursSince(s.pulledAt!, now) > staleHours;
        return {
          label: stale ? `pulled ${s.pulledAt} — not yet published` : 'pulled — ready to publish',
          stale,
        };
      }
      case 'pushed': {
        const stale = Boolean(s.pushedAt) && hoursSince(s.pushedAt!, now) > staleHours;
        return {
          label: stale ? `pushed ${s.pushedAt} — no pull since` : 'pushed — waiting to be pulled',
          stale,
        };
      }
      default:
        return { label: `${s.step} — not yet pushed`, stale: false };
    }
  }

  if (task.gitlabWorker) {
    const stale = hoursSince(task.gitlabWorker.pushedAt, now) > staleHours;

    if (task.syncAgent) {
      return { label: 'agent-runner already pushed a result back — likely ready to pull', stale: false };
    }

    return {
      label: stale
        ? `pushed to bridge ${task.gitlabWorker.pushedAt} — still waiting on agent-runner`
        : 'pushed to bridge — waiting on agent-runner',
      stale,
    };
  }

  if (task.syncAgent) {
    return { label: 'agent-runner has pushed at least one result (no gitlab-worker record for it)', stale: false };
  }

  return { label: 'no local state', stale: false };
}

export function annotateTasks(tasks: TaskEntry[], staleHours: number, now: number = Date.now()): AnnotatedTaskEntry[] {
  return tasks.map((task) => ({ ...task, status: deriveStatus(task, staleHours, now) }));
}

function formatProjectSyncSection(state: SyncState): string[] {
  const lines = ['== sync: project push/pull state (.sync-state.json) =='];
  const entries = Object.entries(state);

  if (entries.length === 0) {
    lines.push('  no state yet');
  } else {
    for (const [project, { lastHash }] of entries) {
      lines.push(`  ${project}: lastHash ${lastHash.slice(0, 12)}…`);
    }
  }

  lines.push('');
  return lines;
}

function formatTaskSection(tasks: AnnotatedTaskEntry[]): string[] {
  const lines = ['== task status (sync + reports subscription, by "projectId:iid") =='];

  if (tasks.length === 0) {
    lines.push('  no in-flight tasks', '');
    return lines;
  }

  for (const task of tasks) {
    lines.push(`  ${task.key}: ${task.status.label}${task.status.stale ? ' [stale]' : ''}`);

    if (task.gitlabWorker) {
      lines.push(`    gitlab-worker: pushed ${task.gitlabWorker.pushedAt} as ${task.gitlabWorker.filename}`);
    }

    if (task.syncAgent) {
      lines.push(`    sync (agent-runner): last own output ${task.syncAgent.lastOwnOutputHash.slice(0, 12)}…`);
    } else if (!task.gitlabWorker) {
      lines.push('    sync: no local state');
    }

    if (task.subscription) {
      const s = task.subscription;
      const parts = [`step ${s.step}`];
      if (s.manual) parts.push(`[вручную] "${s.title ?? ''}"`);
      if (s.branch) parts.push(`branch ${s.branch}`);
      if (s.pushedAt) parts.push(`pushed ${s.pushedAt}`);
      if (s.pulledAt) parts.push(`pulled ${s.pulledAt}`);
      if (s.publishedAt) parts.push(`published ${s.publishedAt}`);
      if (s.encrypted) parts.push('encrypted');
      lines.push(`    reports (subscription): ${parts.join(', ')}`);
    } else {
      lines.push('    reports (subscription): no local state');
    }
  }

  lines.push('');
  return lines;
}

export function formatReportText(data: AnnotatedReportData): string {
  const lines = [
    ...data.errors,
    ...formatProjectSyncSection(data.syncState),
    ...formatTaskSection(data.tasks),
    '== bridge ==',
    '  no local task state (storage relay only — see bridge/README.md)',
  ];

  return lines.join('\n');
}

export function buildReport(paths: StatusPaths, staleHours: number = DEFAULT_STALE_HOURS): string {
  const data = collectReportData(paths);
  return formatReportText({ ...data, tasks: annotateTasks(data.tasks, staleHours) });
}

interface CliOptions {
  paths: Partial<StatusPaths>;
  json: boolean;
  filter?: string;
  watchSeconds?: number;
  staleHours?: number;
  help: boolean;
}

const FLAG_TO_PATH_KEY: Record<string, keyof StatusPaths> = {
  '--sync-state': 'syncState',
  '--sync-agent-state': 'syncAgentState',
  '--gitlab-worker-state': 'gitlabWorkerState',
  '--reports-state': 'reportsState',
};

export const HELP_TEXT = `pipe-status — one merged view of sync's and reports' local task state

Usage: pipe-status [options]

Options:
  --json                     print the merged report as JSON instead of text
  --filter <projectId[:iid]> scope the report to one project or one issue
  --watch <seconds>          re-run and re-print on an interval (Ctrl+C to stop)
  --sync-state <path>        override .sync-state.json's path
  --sync-agent-state <path>  override .sync-agent-state.json's path
  --gitlab-worker-state <path>
                              override .gitlab-worker-state.json's path
  --reports-state <path>     override reports' subscription-state.json's path
  --stale-after <hours>      mark a task stale after this many hours with no
                              further movement (default: ${DEFAULT_STALE_HOURS})
  -h, --help                 print this help and exit`;

// Parses argv into path overrides plus the ergonomics flags — kept as one
// pure function (no process/exit access) so it stays unit-testable.
export function parseArgs(argv: string[]): CliOptions {
  const paths: Partial<StatusPaths> = {};
  let json = false;
  let filter: string | undefined;
  let watchSeconds: number | undefined;
  let staleHours: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }

    if (arg === '--filter') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--filter expects a value');
      filter = value;
      i++;
      continue;
    }

    if (arg === '--watch') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--watch expects a number of seconds');
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`--watch expects a positive number of seconds, got "${value}"`);
      }
      watchSeconds = seconds;
      i++;
      continue;
    }

    if (arg === '--stale-after') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--stale-after expects a number of hours');
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error(`--stale-after expects a positive number of hours, got "${value}"`);
      }
      staleHours = hours;
      i++;
      continue;
    }

    const pathKey = FLAG_TO_PATH_KEY[arg];
    if (pathKey) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} expects a path argument`);
      paths[pathKey] = value;
      i++;
    }
  }

  return { paths, json, filter, watchSeconds, staleHours, help };
}

// Non-zero when there's something actionable to see: a malformed state
// file, or a task whose derived status came back stale — lets pipe-status
// double as a cron/CI health check, not only something a human has to read.
export function exitCodeFor(data: AnnotatedReportData): number {
  const hasStaleTask = data.tasks.some((task) => task.status.stale);
  return data.errors.length > 0 || hasStaleTask ? 1 : 0;
}

function render(paths: StatusPaths, options: CliOptions): number {
  const filtered = filterReportData(collectReportData(paths), options.filter);
  const data: AnnotatedReportData = {
    ...filtered,
    tasks: annotateTasks(filtered.tasks, options.staleHours ?? DEFAULT_STALE_HOURS),
  };

  console.log(options.json ? JSON.stringify(data, null, 2) : formatReportText(data));

  return exitCodeFor(data);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };

  if (!options.watchSeconds) {
    process.exitCode = render(paths, options);
    return;
  }

  console.log(`Watching every ${options.watchSeconds}s. Ctrl+C to stop.\n`);
  for (;;) {
    render(paths, options);
    await sleep(options.watchSeconds * 1000);
  }
}

// Guards against running main() as a side effect of a test file importing
// this module for its exported pure functions — only run it when this file
// is actually the process entry point (`node dist/status.js ...`).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
