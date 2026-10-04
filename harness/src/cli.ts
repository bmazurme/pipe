import { collectReportData, DEFAULT_PATHS, filterReportData, type StatusPaths } from './collect.js';
import { annotateTasks, DEFAULT_STALE_HOURS, exitCodeFor, type AnnotatedReportData } from './deriveStatus.js';
import { formatReportText } from './render.js';

export interface CliOptions {
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
      continue;
    }

    throw new Error(`Unknown option: ${arg} (see --help)`);
  }

  return { paths, json, filter, watchSeconds, staleHours, help };
}

function renderOnce(paths: StatusPaths, options: CliOptions): number {
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

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };

  if (!options.watchSeconds) {
    process.exitCode = renderOnce(paths, options);
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
    process.exitCode = renderOnce(paths, options);
    await sleep(options.watchSeconds * 1000);
  }
}
