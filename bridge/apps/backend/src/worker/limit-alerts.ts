import type { ClaudeLimits } from './claude-limits';

// When a Claude plan window is nearly used up, the owner hears about it once per level and window — before jobs and chat
// turns start failing on it, not after. Pure rules here; LimitAlertsService keeps the state and sends.
export const WARN_AT = 0.8;
export const CRITICAL_AT = 0.95;

export type AlertLevel = 0 | 1 | 2 | 3;
// 0 = fine · 1 = running low · 2 = almost gone · 3 = used up (the CLI said "rejected", or the window is at 100 %)

export interface WindowState {
  level: AlertLevel;
  /** Unix seconds of the window's reset the level was seen in; a different one is a new window. */
  resetsAt: number | null;
}

export interface LimitAlert {
  window: string;
  level: 1 | 2 | 3;
  percent: number;
  resetsAt: number | null;
}

const WINDOW_LABEL: Record<string, string> = {
  five_hour: '5 часов',
  seven_day: 'неделя',
  seven_day_opus: 'неделя · Opus',
  seven_day_sonnet: 'неделя · Sonnet',
};

export function windowLabel(window: string): string {
  return WINDOW_LABEL[window] ?? window.replace(/_/g, ' ');
}

export function levelOf(utilization: number, rejected: boolean): AlertLevel {
  if (rejected || utilization >= 1) return 3;
  if (utilization >= CRITICAL_AT) return 2;
  if (utilization >= WARN_AT) return 1;

  return 0;
}

// "через 3 дн 11 ч" — coarse on purpose.
export function formatResetIn(resetsAtSec: number, nowMs: number): string {
  const minutes = Math.max(
    0,
    Math.round((resetsAtSec * 1000 - nowMs) / 60_000),
  );
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;

  if (days > 0) return `через ${days} дн${hours ? ` ${hours} ч` : ''}`;
  if (hours > 0) return `через ${hours} ч${rest ? ` ${rest} мин` : ''}`;

  return `через ${Math.max(rest, 1)} мин`;
}

/**
 * Compares a fresh report with what was already announced. An alert is due when a window reaches a HIGHER level than the one
 * announced for the same window (same reset time); a window that has rolled over (another reset time) starts again from
 * zero, so next week's low-water mark is announced again. Returns the alerts to send and the state to keep.
 */
export function evaluateLimits(
  limits: ClaudeLimits,
  previous: Record<string, WindowState>,
): { alerts: LimitAlert[]; state: Record<string, WindowState> } {
  const alerts: LimitAlert[] = [];
  const state: Record<string, WindowState> = {};
  // The CLI's verdict names the window that ran out; any other window keeps its own utilization.
  const rejectedWindow =
    limits.status === 'rejected' ? limits.rateLimitType : null;

  for (const [window, value] of Object.entries(limits.windows)) {
    const level = levelOf(value.utilization, rejectedWindow === window);
    const before = previous[window];
    const sameWindow =
      before !== undefined && before.resetsAt === value.resetsAt;
    const announced: AlertLevel = sameWindow ? before.level : 0;

    if (level > announced) {
      alerts.push({
        window,
        level: level as 1 | 2 | 3,
        percent: Math.min(100, Math.round(value.utilization * 100)),
        resetsAt: value.resetsAt,
      });
    }

    state[window] = {
      level: sameWindow ? (Math.max(level, announced) as AlertLevel) : level,
      resetsAt: value.resetsAt,
    };
  }

  // A "rejected" verdict whose window is not among the reported ones (or names none) still deserves one announcement.
  const covered = rejectedWindow !== null && rejectedWindow in limits.windows;

  if (
    limits.status === 'rejected' &&
    !covered &&
    !Object.values(previous).some((s) => s.level === 3)
  ) {
    alerts.push({
      window: limits.rateLimitType ?? 'limit',
      level: 3,
      percent: 100,
      resetsAt: null,
    });
    state[limits.rateLimitType ?? 'limit'] = { level: 3, resetsAt: null };
  }

  return { alerts, state };
}

const LEVEL_TEXT: Record<1 | 2 | 3, { icon: string; tail: string }> = {
  1: { icon: '⚠️', tail: 'лимит подходит к концу' },
  2: { icon: '🔴', tail: 'почти исчерпан' },
  3: {
    icon: '⛔',
    tail: 'лимит исчерпан — задачи и чат на этом токене падают до сброса',
  },
};

export function formatAlert(
  alert: LimitAlert,
  subject: string,
  nowMs: number = Date.now(),
): string {
  const { icon, tail } = LEVEL_TEXT[alert.level];
  const reset =
    alert.resetsAt !== null
      ? `, сброс ${formatResetIn(alert.resetsAt, nowMs)}`
      : '';
  const percent = alert.level === 3 ? '' : ` ${alert.percent}%`;

  return `${icon} Claude · ${subject}: ${windowLabel(alert.window)}${percent} — ${tail}${reset}`;
}
