import { fetchLiveStatus } from './bridgeLive.js';
import { collectReportData, DEFAULT_PATHS, filterReportData, type StatusPaths } from './collect.js';
import { annotateTasks, DEFAULT_STALE_HOURS, exitCodeFor, type AnnotatedReportData } from './deriveStatus.js';
import { recordTransitions, readTaskEvents } from './events.js';
import { fetchGitlabLiveStatus } from './gitlabLive.js';
import { notifyTransitions } from './notifyTransitions.js';
import { formatReportText } from './render.js';

export interface CliOptions {
  paths: Partial<StatusPaths>;
  json: boolean;
  filter?: string;
  watchSeconds?: number;
  staleHours?: number;
  live: boolean;
  logKey?: string;
  notify: boolean;
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
  let help = false;

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

  return { paths, json, filter, watchSeconds, staleHours, live, logKey, notify, help };
}

async function renderOnce(paths: StatusPaths, options: CliOptions): Promise<number> {
  const collected = collectReportData(paths);
  // Recorded against the full, unfiltered task list — a --filter scoping
  // the printed report to one project shouldn't make tasks outside it look
  // like they vanished (IMPROVEMENTS_HARNESS.md 4.1). Same reasoning for
  // --notify below: a transition outside the --filter'd scope still fires
  // its notification.
  const events = recordTransitions(collected.tasks);
  if (options.notify) notifyTransitions(events);
  const filtered = filterReportData(collected, options.filter);

  // Independent of each other — a machine can have sync's bridge API key
  // configured without its GitLab token, or vice versa (IMPROVEMENTS_HARNESS.md
  // 1.1 vs 1.2/1.3) — each falls back to "unavailable" on its own rather
  // than one missing credential taking out both.
  const [liveResult, gitlabLiveResult] = options.live
    ? await Promise.all([fetchLiveStatus(), fetchGitlabLiveStatus(filtered.tasks)])
    : [undefined, undefined];
  const liveTasks = liveResult?.available ? liveResult.data.tasks : undefined;
  const gitlabLiveTasks = gitlabLiveResult?.available ? gitlabLiveResult.data.tasks : undefined;

  const now = Date.now();
  const data: AnnotatedReportData = {
    ...filtered,
    tasks: annotateTasks(filtered.tasks, options.staleHours ?? DEFAULT_STALE_HOURS, now, liveTasks, gitlabLiveTasks),
  };

  if (options.json) {
    console.log(JSON.stringify({ ...data, live: liveResult, gitlabLive: gitlabLiveResult }, replaceMaps, 2));
  } else {
    const liveWorker = liveResult?.available ? liveResult.data.worker : undefined;
    const liveError = liveResult && !liveResult.available ? liveResult.reason : undefined;
    const claudeCredentials = liveResult?.available ? liveResult.data.claudeCredentials : undefined;
    const incoming = gitlabLiveResult?.available ? gitlabLiveResult.data.incoming : undefined;
    const gitlabError = gitlabLiveResult && !gitlabLiveResult.available ? gitlabLiveResult.reason : undefined;
    console.log(formatReportText(data, liveWorker, liveError, claudeCredentials, incoming, gitlabError, now));
  }

  return exitCodeFor(data);
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

  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };

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
