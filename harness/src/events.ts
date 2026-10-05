import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TaskEntry } from './collect.js';

// IMPROVEMENTS_HARNESS.md 4.1. Deliberately NOT gated behind the daemon
// item 3.1 would eventually add — the doc frames 4.1 as something 3.1's
// daemon writes, but the actual diffing need nothing from a daemon: it
// only needs two observations of the same task to compare, and harness's
// existing --watch loop (or even two separate one-shot invocations) already
// provides that. 3.1, when it exists, just adds an OS notification as a
// second action on the same diff this module already computes — this is
// the cheaper order to build the two in, not the order the original doc
// happened to list them.
//
// Lives outside the repo checkout (unlike every other state file harness
// reads) since it's a record of what *this machine's user* has watched
// happen, not something sync/reports themselves produce or consume.
export interface EventsPaths {
  log: string;
  snapshot: string;
}

export const DEFAULT_EVENTS_PATHS: EventsPaths = {
  log: path.join(os.homedir(), '.local', 'state', 'pipe', 'events.jsonl'),
  snapshot: path.join(os.homedir(), '.local', 'state', 'pipe', 'last-snapshot.json'),
};

export interface TaskEvent {
  ts: string;
  key: string;
  source: string;
  from: string;
  to: string;
}

// A stable identifier for "what this task's state means" — deliberately
// NOT deriveStatus()'s own label, which bakes in staleness wording that
// changes purely with the passage of time (e.g. "pushed — waiting to be
// pulled" vs "pushed <date> — no pull since" for the exact same underlying
// step). Diffing the label directly would log a spurious "transition"
// for every task that simply sits still long enough to cross the stale
// threshold — this tracks only the underlying local signals
// (IMPROVEMENTS_HARNESS.md's own "каждый state-файл хранит только
// последнее значение" framing is scoped to local files, not live/--live
// facts, so bridge/GitLab data plays no part here either).
function taskSignature(task: TaskEntry): string {
  if (task.subscription) return `subscription:${task.subscription.step}`;
  if (task.gitlabWorker && task.syncAgent) return 'gitlab-worker+agent-runner';
  if (task.gitlabWorker) return 'gitlab-worker';
  if (task.syncAgent) return 'agent-runner';
  return 'no-local-state';
}

function taskSource(task: TaskEntry): string {
  if (task.subscription) return 'reports (subscription)';
  if (task.syncAgent) return 'sync (agent-runner)';
  if (task.gitlabWorker) return 'sync (gitlab-worker)';
  return 'none';
}

function loadSnapshot(snapshotPath: string): Record<string, string> {
  if (!existsSync(snapshotPath)) return {};
  try {
    return JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Record<string, string>;
  } catch {
    // A corrupted snapshot shouldn't block the report or crash the
    // process — same "errors as data, never throw" convention as
    // collect.ts's own readers, just with nothing to surface it to here
    // since this isn't itself part of the report. Treated as "no prior
    // observations": the next run's diff starts fresh rather than losing
    // the ability to record anything at all.
    return {};
  }
}

function saveSnapshot(snapshotPath: string, snapshot: Record<string, string>): void {
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
}

function appendEvents(logPath: string, events: TaskEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

// Diffs the current task list against the last-observed signature per key
// (persisted across invocations — one-shot or --watch alike) and appends
// one event per task whose underlying local state actually changed. A
// brand-new key (no prior snapshot entry at all) is NOT logged as a
// transition from "nothing" — only a change between two actually-observed
// states is, so the very first run against an already-populated checkout
// doesn't dump every existing task into the log as a fake "just happened"
// burst. Task removals (a key no longer appearing in any run) aren't
// logged — its last-known signature just lingers harmlessly in the
// snapshot file — for the same reason this doesn't try to be a full audit
// trail, just a record of forward progress, matching the doc's own framing.
//
// No file locking: this is a single-user local CLI, not a server — two
// pipe-status processes racing to write the same snapshot at once is an
// accepted, deliberately-not-handled edge case.
export function recordTransitions(
  tasks: TaskEntry[],
  paths: EventsPaths = DEFAULT_EVENTS_PATHS,
  now: () => string = () => new Date().toISOString(),
): TaskEvent[] {
  const previous = loadSnapshot(paths.snapshot);
  // Seeded from the previous snapshot, not built fresh — a key this call's
  // own `tasks` doesn't happen to mention (e.g. a --filter'd subset, or any
  // future caller that doesn't always pass the complete set) keeps its
  // last-known signature instead of silently vanishing from the snapshot,
  // which would otherwise look identical to a real removal next time that
  // key *does* reappear.
  const next: Record<string, string> = { ...previous };
  const events: TaskEvent[] = [];

  for (const task of tasks) {
    const signature = taskSignature(task);
    next[task.key] = signature;

    const previousSignature = previous[task.key];
    if (previousSignature !== undefined && previousSignature !== signature) {
      events.push({ ts: now(), key: task.key, source: taskSource(task), from: previousSignature, to: signature });
    }
  }

  appendEvents(paths.log, events);
  saveSnapshot(paths.snapshot, next);

  return events;
}

// `pipe-status --log <key>` — this item's own `pipe log <key>` example
// assumes the subcommand restructuring item 6.5 would eventually bring
// (`pipe` with verbs); adapted here to a flag on the existing
// flag-based `pipe-status` binary instead, since 6.5 isn't in scope.
export function readTaskEvents(key: string, paths: EventsPaths = DEFAULT_EVENTS_PATHS): TaskEvent[] {
  if (!existsSync(paths.log)) return [];

  return readFileSync(paths.log, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TaskEvent)
    .filter((event) => event.key === key);
}
