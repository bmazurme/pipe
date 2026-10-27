import { notify } from '@pipe/protocol/notify';

import { runAction } from './actions.js';
import { type CliOptions, DEFAULT_RECENT_HOURS, HELP_TEXT, parseArgs } from './args.js';
import { buildBrief, formatBrief, summarizeBrief } from './brief.js';
import { DEFAULT_PATHS, type StatusPaths } from './collect.js';
import { exitCodeFor } from './deriveStatus.js';
import { recordTransitions, readTaskEvents } from './events.js';
import { formatNextRecommendation, pickNextTask } from './next.js';
import { notifyTransitions } from './notifyTransitions.js';
import { buildReportData, formatBuiltReport } from './reportBuilder.js';
import { logTime } from './timeTracking.js';


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

// IMPROVEMENTS_HARNESS.md 3.2 — another standalone one-shot mode. Always
// requests live data regardless of --live (buildBrief's own job, not
// repeated here) — a scheduled brief run is pointless without bridge/
// GitLab checked, same reasoning the interactive list (2.4) already uses
// for always living live. --notify here fires one short digest
// notification (summarizeBrief) instead of notifyTransitions' per-task
// ones — a morning brief is one notification, not N.
async function runBrief(paths: StatusPaths, options: CliOptions): Promise<number> {
  const sections = await buildBrief({ paths, staleHours: options.staleHours, recentHours: options.recentHours });

  if (options.notify) notify('pipe-status brief', summarizeBrief(sections));

  if (options.json) {
    console.log(JSON.stringify(sections, replaceMaps, 2));
  } else {
    console.log(formatBrief(sections, options.recentHours ?? DEFAULT_RECENT_HOURS));
  }

  return sections.stale.length > 0 ? 1 : 0;
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
  const argv = process.argv.slice(2);

  // IMPROVEMENTS_HARNESS.md 2.4 — "pipe без аргументов" launches the
  // interactive list instead of the static report; ANY flag at all (or no
  // real terminal — a script, a pipe, CI) keeps today's plain-text
  // behavior completely unchanged. Checked on raw argv, not parsed
  // options, specifically so this can never accidentally fire for an
  // explicit invocation that merely happens to match every flag's
  // default. Dynamic import: no reason to load @clack/prompts at all for
  // the overwhelmingly more common flag-driven/scripted invocations.
  if (argv.length === 0 && process.stdout.isTTY) {
    const { runTui } = await import('./tui.js');
    process.exitCode = await runTui();
    return;
  }

  const options = parseArgs(argv);

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

  if (options.logTimeKey) {
    const result = await logTime(options.logTimeKey, { yes: options.yes, dryRun: options.dryRun, paths: options.paths });
    if (result.output) console.log(result.output);
    process.exitCode = result.code;
    return;
  }

  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };

  if (options.next) {
    process.exitCode = await runNext(paths, options);
    return;
  }

  if (options.brief) {
    process.exitCode = await runBrief(paths, options);
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
