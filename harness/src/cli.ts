import { type ActionKind, runAction } from './actions.js';
import { DEFAULT_PATHS, type StatusPaths } from './collect.js';
import { DEFAULT_STALE_HOURS, exitCodeFor } from './deriveStatus.js';
import { recordTransitions, readTaskEvents } from './events.js';
import { formatNextRecommendation, pickNextTask } from './next.js';
import { notifyTransitions } from './notifyTransitions.js';
import { buildReportData, formatBuiltReport } from './reportBuilder.js';

export interface CliOptions {
  paths: Partial<StatusPaths>;
  json: boolean;
  filter?: string;
  watchSeconds?: number;
  staleHours?: number;
  live: boolean;
  logKey?: string;
  notify: boolean;
  next: boolean;
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
  --pull <projectId:iid>     run sync-cli pull-issue for this task, then exit
  --retry <projectId:iid>    re-run sync-cli push-issue for this task (a
                              fresh parcel for agent-runner to pick up again),
                              then exit
  --publish <projectId:iid>  call reports' publish endpoint for this task,
                              then exit
  --yes                      skip the interactive confirmation prompt before
                              --pull/--retry/--publish (for scripts) — refused
                              outright instead of hanging when stdin isn't a
                              terminal and this isn't given
  --dry-run                  with --pull/--retry/--publish, print what would
                              run/be called instead of doing it
  --project <name>           override the local project name
                              --pull/--retry resolve from sync.config.json —
                              needed when that resolution is ambiguous
  --reports-url <url>        override reports' base URL for --publish
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
  let notify = false;
  let next = false;
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

  return { paths, json, filter, watchSeconds, staleHours, live, logKey, notify, next, action, yes, dryRun, project, reportsUrl, help };
}

async function renderOnce(paths: StatusPaths, options: CliOptions): Promise<number> {
  const built = await buildReportData({
    paths,
    filter: options.filter,
    live: options.live,
    staleHours: options.staleHours,
  });

  // Recorded against the full, unfiltered task list — a --filter scoping
  // the printed report to one project shouldn't make tasks outside it look
  // like they vanished (IMPROVEMENTS_HARNESS.md 4.1). Same reasoning for
  // --notify below: a transition outside the --filter'd scope still fires
  // its notification.
  const events = recordTransitions(built.collected.tasks);
  if (options.notify) notifyTransitions(events);

  if (options.json) {
    console.log(JSON.stringify({ ...built.data, live: built.liveResult, gitlabLive: built.gitlabLiveResult }, replaceMaps, 2));
  } else {
    console.log(formatBuiltReport(built));
  }

  return exitCodeFor(built.data);
}

// IMPROVEMENTS_HARNESS.md 2.2 — a standalone one-shot mode, same as --log
// and --pull/--retry/--publish, not folded into the full report. Shares
// buildReportData's own live-fetch shape above, since pickNextTask needs
// the same liveTasks/gitlabLiveTasks/incoming inputs to weigh a
// confirmed-ready result or a newly assigned issue, not just local state.
async function runNext(paths: StatusPaths, options: CliOptions): Promise<number> {
  const built = await buildReportData({
    paths,
    filter: options.filter,
    live: options.live,
    staleHours: options.staleHours,
  });
  const liveTasks = built.liveResult?.available ? built.liveResult.data.tasks : undefined;
  const incoming = built.gitlabLiveResult?.available ? built.gitlabLiveResult.data.incoming : [];
  const picked = pickNextTask(built.data.tasks, incoming, liveTasks);

  if (options.json) {
    console.log(JSON.stringify(picked ?? null, null, 2));
  } else {
    console.log(formatNextRecommendation(picked));
  }

  // Same convention as exitCodeFor: non-zero only for the one bucket that's
  // actually alarm-worthy on its own — a confirmed-ready/incoming/
  // in-progress task is normal, expected backlog, not something cron/CI
  // should flag.
  return picked?.bucket === 'stale' ? 1 : 0;
}

// JSON.stringify can't serialize a Map directly (used internally for
// liveTasks) — this only ever shows up nested inside `live.data.tasks` when
// --live --json are combined, so convert it to a plain object there instead
// of silently printing "{}".
function replaceMaps(_key: string, value: unknown): unknown {
  return value instanceof Map ? Object.fromEntries(value) : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (options.logKey) {
    const events = readTaskEvents(options.logKey);
    if (events.length === 0) {
      console.log(`No recorded transitions for ${options.logKey} yet.`);
    } else {
      console.log(`Timeline for ${options.logKey}:`);
      for (const event of events) {
        console.log(`  ${event.ts}  ${event.source.padEnd(22)}  ${event.from} → ${event.to}`);
      }
    }
    return;
  }

  if (options.action) {
    const result = await runAction(options.action.kind, options.action.key, {
      yes: options.yes,
      dryRun: options.dryRun,
      project: options.project,
      reportsBaseUrl: options.reportsUrl,
    });
    // Empty for pull/retry's inherited-stdio path (defaultRunSyncCli) —
    // the terminal already saw sync-cli's own output live, nothing left to
    // print here. Non-empty for every other outcome (dry-run, refused,
    // aborted, publish success/failure) — see actions.ts's own ActionResult
    // comment for why this is returned instead of printed directly inside
    // runAction itself.
    if (result.output) console.log(result.output);
    process.exitCode = result.code;
    return;
  }

  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };

  if (options.next) {
    process.exitCode = await runNext(paths, options);
    return;
  }

  if (!options.watchSeconds) {
    process.exitCode = await renderOnce(paths, options);
    return;
  }

  console.log(`Watching every ${options.watchSeconds}s. Ctrl+C to stop.\n`);
  for (;;) {
    // Clears each prior report before the next one prints — without it,
    // --watch just appended report after report, pushing everything above
    // out of the visible terminal area well before the second or third
    // iteration. The exit code is updated every pass too (previously only
    // ever set by the one-shot path above), so Ctrl+C'ing out of --watch
    // still leaves a meaningful exit code behind for the latest report.
    console.clear();
    process.exitCode = await renderOnce(paths, options);
    await sleep(options.watchSeconds * 1000);
  }
}
