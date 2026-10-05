import type { LiveStatusResult } from './bridgeLive.js';
import { fetchLiveStatus } from './bridgeLive.js';
import { collectReportData, DEFAULT_PATHS, filterReportData, type ReportData, type StatusPaths } from './collect.js';
import { annotateTasks, DEFAULT_STALE_HOURS, type AnnotatedReportData } from './deriveStatus.js';
import { fetchGitlabLiveStatus, type GitlabLiveStatusResult } from './gitlabLive.js';
import { formatReportText } from './render.js';

// Shared collect → filter → (optional) live-fetch → annotate pipeline —
// cli.ts's renderOnce/runNext and the MCP server (IMPROVEMENTS_HARNESS.md
// 5.1) both need exactly this, just with different side effects layered on
// top (recordTransitions/--notify/console output for the CLI; a tool-call
// result for MCP). Factored out once it had two real consumers, not before.
export interface ReportBuildOptions {
  paths?: Partial<StatusPaths>;
  filter?: string;
  live?: boolean;
  staleHours?: number;
  now?: number;
}

export interface ReportBuildResult {
  // Unfiltered — recordTransitions (IMPROVEMENTS_HARNESS.md 4.1) needs the
  // full task list regardless of --filter, so this is exposed separately
  // from the filtered+annotated `data` below rather than baked in.
  collected: ReportData;
  data: AnnotatedReportData;
  liveResult?: LiveStatusResult;
  gitlabLiveResult?: GitlabLiveStatusResult;
  now: number;
}

export async function buildReportData(options: ReportBuildOptions = {}): Promise<ReportBuildResult> {
  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };
  const collected = collectReportData(paths);
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

  const now = options.now ?? Date.now();
  const data: AnnotatedReportData = {
    ...filtered,
    tasks: annotateTasks(filtered.tasks, options.staleHours ?? DEFAULT_STALE_HOURS, now, liveTasks, gitlabLiveTasks),
  };

  return { collected, data, liveResult, gitlabLiveResult, now };
}

export function formatBuiltReport(result: ReportBuildResult): string {
  const { data, liveResult, gitlabLiveResult, now } = result;
  const liveWorker = liveResult?.available ? liveResult.data.worker : undefined;
  const liveError = liveResult && !liveResult.available ? liveResult.reason : undefined;
  const claudeCredentials = liveResult?.available ? liveResult.data.claudeCredentials : undefined;
  const incoming = gitlabLiveResult?.available ? gitlabLiveResult.data.incoming : undefined;
  const gitlabError = gitlabLiveResult && !gitlabLiveResult.available ? gitlabLiveResult.reason : undefined;

  return formatReportText(data, liveWorker, liveError, claudeCredentials, incoming, gitlabError, now);
}
