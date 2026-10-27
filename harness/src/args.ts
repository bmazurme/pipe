import type { StatusPaths } from './collect.js';
import { DEFAULT_STALE_HOURS } from './deriveStatus.js';

export type ActionKind = 'pull' | 'retry' | 'publish';

export const DEFAULT_RECENT_HOURS = 24;

export interface CliOptions {
  paths: Partial<StatusPaths>;
  json: boolean;
  filter?: string;
  watchSeconds?: number;
  staleHours?: number;
  live: boolean;
  logKey?: string;
  logTimeKey?: string;
  notify: boolean;
  next: boolean;
  brief: boolean;
  recentHours?: number;
  action?: { kind: ActionKind; key: string };
  yes: boolean;
  dryRun: boolean;
  project?: string;
  reportsUrl?: string;
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
  --live                     check bridge for the worker's heartbeat, each
                              task's storage result, and its worker job
                              status (sync-cli's bridge API key), and GitLab
                              for each task's issue/MR/pipeline state plus
                              newly assigned issues not yet pushed
                              (sync-cli's GitLab token) — each independently
                              falls back to the offline report if its own
                              credential is absent or it's unreachable
  --log <projectId:iid>      print the recorded transition timeline for one
                              task and exit — every run (watched or
                              one-shot) records any task's local-state
                              transition since the last run to
                              ~/.local/state/pipe/events.jsonl
  --notify                   fire an OS notification for each new local-state
                              transition this run finds (on top of printing
                              the report as usual) — meant for a scheduled
                              one-shot run or a long --watch with nobody
                              reading the terminal; see harness/README.md
  --next                     print the single most important task right now
                              and what to do about it, then exit (combine
                              with --live to also weigh confirmed-ready
                              results and newly assigned issues, not just
                              local state)
  --brief                    print a digest (incoming, ready to review,
                              stale, what moved recently, worker status),
                              then exit — always checks bridge/GitLab
                              (like --live) regardless of whether --live
                              was also given; combine with --notify for a
                              short one-line OS notification instead of/
                              alongside the full text, meant for a
                              scheduled run (see harness/README.md)
  --recent-hours <hours>     with --brief, how far back "moved recently"
                              looks (default: ${DEFAULT_RECENT_HOURS})
  --pull <projectId:iid>     run sync-cli pull-issue for this task, then exit
  --retry <projectId:iid>    re-run sync-cli push-issue for this task (a
                              fresh parcel for agent-runner to pick up again),
                              then exit
  --publish <projectId:iid>  call reports' publish endpoint for this task,
                              then exit
  --log-time <projectId:iid> propose and log actual time spent (GitLab's
                              own time tracking, from the last completed
                              push→pull cycle in reports' own
                              subscription-state.json) for this task, then
                              exit — see "Logging time spent" in
                              harness/README.md
  --yes                      skip the interactive confirmation prompt before
                              --pull/--retry/--publish/--log-time (for
                              scripts) — refused outright instead of
                              hanging when stdin isn't a terminal and this
                              isn't given
  --dry-run                  with --pull/--retry/--publish/--log-time,
                              print what would run/be called instead of
                              doing it
  --project <name>           override the local project name
                              --pull/--retry resolve from sync.config.json —
                              needed when that resolution is ambiguous
  --reports-url <url>        override reports' base URL for --publish (loopback only)
                              (default: http://127.0.0.1:4000)
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
  let live = false;
  let logKey: string | undefined;
  let logTimeKey: string | undefined;
  let notify = false;
  let next = false;
  let brief = false;
  let recentHours: number | undefined;
  let action: { kind: ActionKind; key: string } | undefined;
  let yes = false;
  let dryRun = false;
  let project: string | undefined;
  let reportsUrl: string | undefined;
  let help = false;

  const ACTION_FLAG_TO_KIND: Record<string, ActionKind> = {
    '--pull': 'pull',
    '--retry': 'retry',
    '--publish': 'publish',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--live') {
      live = true;
      continue;
    }

    if (arg === '--notify') {
      notify = true;
      continue;
    }

    if (arg === '--next') {
      next = true;
      continue;
    }

    if (arg === '--brief') {
      brief = true;
      continue;
    }

    if (arg === '--recent-hours') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--recent-hours expects a number of hours');
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error(`--recent-hours expects a positive number of hours, got "${value}"`);
      }
      recentHours = hours;
      i++;
      continue;
    }

    const actionKind = ACTION_FLAG_TO_KIND[arg];
    if (actionKind) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} expects a task key (projectId:iid)`);
      if (action) throw new Error('only one of --pull/--retry/--publish can be given at a time');
      action = { kind: actionKind, key: value };
      i++;
      continue;
    }

    if (arg === '--yes') {
      yes = true;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--project') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--project expects a name');
      project = value;
      i++;
      continue;
    }

    if (arg === '--reports-url') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--reports-url expects a URL');
      reportsUrl = value;
      i++;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }

    if (arg === '--log') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--log expects a task key (projectId:iid)');
      logKey = value;
      i++;
      continue;
    }

    if (arg === '--log-time') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--log-time expects a task key (projectId:iid)');
      logTimeKey = value;
      i++;
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
      continue;
    }

    throw new Error(`Unknown option: ${arg} (see --help)`);
  }

  return { paths, json, filter, watchSeconds, staleHours, live, logKey, logTimeKey, notify, next, brief, recentHours, action, yes, dryRun, project, reportsUrl, help };
}
