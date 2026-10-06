import { addSpentTime } from '@pipe/protocol/gitlabClient';

import { defaultConfirm } from './actions.js';
import { collectReportData, DEFAULT_PATHS, type StatusPaths } from './collect.js';
import { loadGitlabLiveConfig, type GitlabLiveConfigPaths } from './gitlabLive.js';

// IMPROVEMENTS_HARNESS.md 4.2 — "предлагать черновики записей времени в
// reports... пользователь подтверждает." reports itself has no manual
// time-entry concept to propose a draft into at all: its own monthly
// report (reports/src/reports/handler.ts) PULLS hours from each GitLab
// issue's own time_stats — it never accepts a created-from-outside entry.
// The actually-feasible version of this item logs the proposed duration
// straight to GitLab instead, via the same `/spend` endpoint GitLab's own
// quick action uses (addSpentTime, new in @pipe/protocol/gitlabClient) —
// which then shows up in reports' existing report automatically, no
// reports-side change needed at all.
//
// Reads reports' own subscription.pushedAt/pulledAt directly — NOT a
// reconstruction from events.jsonl's diff log, which was tried first and
// turned out wrong: events.ts deliberately never logs a key's very first
// observation (nothing to diff against yet — see its own comment), so
// the FIRST push→pull cycle's push is never in the log at all, only the
// pull is; reports' own state file has the real timestamps directly,
// unconditionally. Scoped to subscription-based tasks (reports) only — a
// gitlab-worker-only flow pulls via sync-cli's pull-issue, which doesn't
// write a pulledAt (or any local record) at all, so there's nothing to
// propose for it either way.
export interface TimeDraft {
  key: string;
  hours: number;
  duration: string;
  pushedAt: string;
  pulledAt: string;
}

// GitLab's own duration syntax (e.g. "2h30m", "1d") — at least one minute,
// since GitLab rejects an empty/zero duration outright.
export function formatGitlabDuration(hours: number): string {
  const totalMinutes = Math.max(1, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

// pulledAt <= pushedAt specifically means the recorded pull predates the
// current push (a second push happened since the last pull — reports'
// setIssueState only overwrites the field its own step actually touches,
// so an old pulledAt from a finished earlier cycle otherwise lingers on
// the entry) — i.e. nothing has completed *since* this push, not a
// negative-duration bug to paper over.
export function proposeTimeEntry(subscription: { pushedAt?: string; pulledAt?: string } | undefined, key: string): TimeDraft | undefined {
  if (!subscription?.pushedAt || !subscription?.pulledAt) return undefined;

  const pushedMs = Date.parse(subscription.pushedAt);
  const pulledMs = Date.parse(subscription.pulledAt);
  if (pulledMs <= pushedMs) return undefined;

  const hours = (pulledMs - pushedMs) / (60 * 60 * 1000);
  return { key, hours, duration: formatGitlabDuration(hours), pushedAt: subscription.pushedAt, pulledAt: subscription.pulledAt };
}

export interface LogTimeOptions {
  yes: boolean;
  dryRun: boolean;
  paths?: Partial<StatusPaths>;
}

export interface LogTimeResult {
  code: number;
  output: string;
}

export interface LogTimeDeps {
  loadGitlabConfig: (paths?: GitlabLiveConfigPaths) => ReturnType<typeof loadGitlabLiveConfig>;
  addSpentTime: typeof addSpentTime;
  confirm: (message: string) => Promise<boolean>;
  isInteractive: boolean;
}

export const DEFAULT_LOG_TIME_DEPS: LogTimeDeps = {
  loadGitlabConfig: loadGitlabLiveConfig,
  addSpentTime,
  confirm: defaultConfirm,
  isInteractive: Boolean(process.stdin.isTTY),
};

// Same shape/safety conventions as actions.ts's runAction, deliberately:
// a confirmation requirement that can't be skipped except by --yes, an
// outright (never hanging) refusal when non-interactive and --yes wasn't
// given, --dry-run short-circuiting before either check, and a returned
// { code, output } instead of printing directly — a candidate for a
// future MCP tool too, same reasoning as mcp.ts's own ActionResult.
export async function logTime(key: string, options: LogTimeOptions, deps: LogTimeDeps = DEFAULT_LOG_TIME_DEPS): Promise<LogTimeResult> {
  const [projectId, iid] = key.split(':');
  if (!projectId || !iid) {
    return { code: 1, output: `Invalid task key "${key}" — expected "projectId:iid"` };
  }

  const paths: StatusPaths = { ...DEFAULT_PATHS, ...options.paths };
  const task = collectReportData(paths).tasks.find((t) => t.key === key);
  const draft = proposeTimeEntry(task?.subscription, key);
  if (!draft) {
    return {
      code: 1,
      output: `No completed push→pull cycle on record for ${key} (reports' own subscription-state.json) — nothing to propose.`,
    };
  }

  const description = `log ${draft.duration} spent on ${key} to GitLab (pushed ${draft.pushedAt}, pulled ${draft.pulledAt})`;

  if (options.dryRun) {
    return { code: 0, output: `Would ${description}.` };
  }

  if (!options.yes) {
    if (!deps.isInteractive) {
      return { code: 1, output: `Refusing to ${description} without confirmation in a non-interactive session — pass --yes.` };
    }
    const proceed = await deps.confirm(`About to ${description}. Proceed?`);
    if (!proceed) {
      return { code: 1, output: 'Aborted.' };
    }
  }

  const config = deps.loadGitlabConfig();
  if (!config) {
    return {
      code: 1,
      output: 'no GitLab token configured for sync-cli — run "sync-cli login-gitlab <token>" once (see sync/README.md)',
    };
  }

  try {
    await deps.addSpentTime(config.apiUrl, config.token, projectId, iid, draft.duration);
    return { code: 0, output: `Logged ${draft.duration} on ${key}.` };
  } catch (error) {
    return { code: 1, output: (error as Error).message };
  }
}
