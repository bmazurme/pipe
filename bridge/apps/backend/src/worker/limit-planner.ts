// R10 — a scheduler that knows the Claude plan's limits. A worker already reports the windows of the plan it ran on (five hours, a
// week, a week per model) and bridge keeps the last report per stored token (claude-limits.ts). This turns that into a decision at
// the moment a job is made, instead of letting it start, hit the wall and fail (a week once held 32 such failures in 318 jobs):
//
//   urgent job (the owner asked, a person is waiting) → on a token that still has room, else as it is;
//   deferrable job (a schedule, a repair, an analysis) → on a token that still has room, else held back until the window resets,
//                                                         and held back a little earlier — at RESERVE_AT — so the last tenth of
//                                                         a window stays for what is urgent.
//
// A model the owner named is never swapped silently: when nothing has room, the answer says which other model does, and that is all.
// Pure: WorkerService.create reads the tokens and acts on the decision.

import type { ClaudeLimits } from './claude-limits';
import { windowLabel } from './limit-alerts';

export type Urgency = 'urgent' | 'deferrable';

/** A deferrable job holds off at this share of a window; urgent ones only when it is used up. */
export const RESERVE_AT = 0.9;
export const EXHAUSTED_AT = 1;
/** A reset is a moment, not an instant — wait a minute past it. */
export const RESET_GRACE_MS = 60_000;
/** A report that names no reset time says something only for this long. */
export const UNDATED_TTL_MS = 30 * 60_000;
/** A job that failed on the limit is put back only when the report that said so is this fresh (it came with that run). */
export const FRESH_REPORT_MS = 15 * 60_000;

const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus'] as const;

export interface PlanToken {
  id: number;
  limits: ClaudeLimits | null;
  /** Anthropic refused this token (auth) — it is the last choice, not a first one. */
  authFailed?: boolean;
}

export type Plan =
  | { action: 'run'; warning?: string; alternativeModel?: string }
  | { action: 'switch'; credentialId: number; reason: string }
  | { action: 'defer'; until: Date; reason: string };

/** The windows that bound a model: the two every Claude model shares, and its own weekly one when the plan has it. */
export function windowsOf(model: string): string[] {
  const own =
    model === 'opus' || model === 'sonnet' ? [`seven_day_${model}`] : [];

  return ['five_hour', 'seven_day', ...own];
}

export function isClaudeModel(model: string): boolean {
  return (CLAUDE_MODELS as readonly string[]).includes(model);
}

interface Blocker {
  window: string;
  percent: number;
  until: number;
}

/**
 * What stops `model` on a token, from its last report: every bounding window at or over `threshold` that has not reset yet.
 * A window whose reset has passed is a new window (nothing is known against it); a report with no reset time counts for half an hour.
 */
function blockers(
  limits: ClaudeLimits | null,
  model: string,
  threshold: number,
  nowMs: number,
): Blocker[] {
  if (!limits) return [];

  const reportedMs = Date.parse(limits.reportedAt);
  const fresh =
    Number.isFinite(reportedMs) && nowMs - reportedMs < UNDATED_TTL_MS;
  const bounding = windowsOf(model);
  const found: Blocker[] = [];

  for (const window of bounding) {
    const state = limits.windows[window];
    const rejected =
      limits.status === 'rejected' && limits.rateLimitType === window;

    if (!state && !rejected) continue;

    const utilization = rejected ? 1 : (state?.utilization ?? 0);
    const resetsAt = state?.resetsAt ?? null;

    if (utilization < threshold) continue;

    if (resetsAt !== null) {
      if (resetsAt * 1000 <= nowMs) continue;
      found.push({
        window,
        percent: Math.min(100, Math.round(utilization * 100)),
        until: resetsAt * 1000 + RESET_GRACE_MS,
      });
    } else if (fresh) {
      found.push({
        window,
        percent: Math.min(100, Math.round(utilization * 100)),
        until:
          (Number.isFinite(reportedMs) ? reportedMs : nowMs) + UNDATED_TTL_MS,
      });
    }
  }

  // A verdict that names a window the report does not list (or none) still means "not now".
  if (
    limits.status === 'rejected' &&
    fresh &&
    (limits.rateLimitType === null ||
      !bounding.includes(limits.rateLimitType)) &&
    found.length === 0 &&
    threshold >= EXHAUSTED_AT
  ) {
    found.push({
      window: limits.rateLimitType ?? 'limit',
      percent: 100,
      until: reportedMs + UNDATED_TTL_MS,
    });
  }

  return found;
}

function latest(list: Blocker[]): Blocker {
  return list.reduce((a, b) => (b.until > a.until ? b : a));
}

/**
 * Where a new job of `model` should go.
 * `pinned`: the owner chose this token for the job — it is never swapped, only waited for (when deferrable).
 * `tokens`: the account's tokens in the order a job would take them (the first is what runs by default).
 */
export function planJob(input: {
  model: string;
  urgency: Urgency;
  pinnedCredentialId?: number | null;
  /** The token the job would take (a retry carries the one it had): tried first, but not binding like a pin. */
  preferredCredentialId?: number | null;
  tokens: PlanToken[];
  now?: Date;
}): Plan {
  const nowMs = (input.now ?? new Date()).getTime();
  const { model, urgency } = input;

  if (!isClaudeModel(model) || input.tokens.length === 0) {
    return { action: 'run' };
  }

  const threshold = urgency === 'deferrable' ? RESERVE_AT : EXHAUSTED_AT;
  const pinned = input.pinnedCredentialId ?? null;
  const usable =
    pinned !== null
      ? input.tokens.filter((token) => token.id === pinned)
      : [...input.tokens].sort(
          (a, b) =>
            Number(b.id === input.preferredCredentialId) -
              Number(a.id === input.preferredCredentialId) ||
            Number(a.authFailed === true) - Number(b.authFailed === true),
        );

  if (usable.length === 0) return { action: 'run' };

  const verdicts = usable.map((token) => ({
    token,
    blocked: blockers(token.limits, model, threshold, nowMs),
  }));
  const free = verdicts.find((verdict) => verdict.blocked.length === 0);

  if (free) {
    return free.token.id === usable[0].id || pinned !== null
      ? { action: 'run' }
      : {
          action: 'switch',
          credentialId: free.token.id,
          reason: `Токен #${usable[0].id} у лимита — задача пошла на токен #${free.token.id}, где есть запас`,
        };
  }

  // Nothing has room. The soonest any token frees up is when waiting ends.
  const soonest = verdicts
    .map((verdict) => latest(verdict.blocked))
    .reduce((a, b) => (b.until < a.until ? b : a));
  const why = `Claude · ${windowLabel(soonest.window)} ${soonest.percent}%`;

  if (urgency === 'deferrable') {
    return {
      action: 'defer',
      until: new Date(soonest.until),
      reason: `${why} — несрочная задача отложена до сброса лимита`,
    };
  }

  const alternative = CLAUDE_MODELS.filter((other) => other !== model).find(
    (other) =>
      usable.some(
        (token) =>
          blockers(token.limits, other, EXHAUSTED_AT, nowMs).length === 0,
      ),
  );

  return {
    action: 'run',
    warning: `${why} — задача может упасть на лимите`,
    ...(alternative ? { alternativeModel: alternative } : {}),
  };
}

/**
 * A job that has just failed: when does the limit it hit end? null when the report does not say it was a limit, is not fresh (it
 * belongs to an older run), or names no reset time (nothing to wait for).
 */
export function resetAfterFailure(
  limits: ClaudeLimits | null,
  now: Date = new Date(),
): Date | null {
  if (!limits || limits.status !== 'rejected') return null;

  const reportedMs = Date.parse(limits.reportedAt);

  if (
    !Number.isFinite(reportedMs) ||
    now.getTime() - reportedMs > FRESH_REPORT_MS
  ) {
    return null;
  }

  const type = limits.rateLimitType;
  const named = type ? limits.windows[type]?.resetsAt : null;
  const anyOver = Object.values(limits.windows)
    .filter(
      (state) => state.utilization >= EXHAUSTED_AT && state.resetsAt !== null,
    )
    .map((state) => state.resetsAt as number);
  const resetsAt = named ?? (anyOver.length > 0 ? Math.max(...anyOver) : null);

  if (resetsAt === null || resetsAt * 1000 <= now.getTime()) return null;

  return new Date(resetsAt * 1000 + RESET_GRACE_MS);
}

/** "15:04", or "29.11 15:04" when it is not today — for the job's log line. */
export function clock(date: Date, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  return date.toDateString() === now.toDateString()
    ? time
    : `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${time}`;
}
