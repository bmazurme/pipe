import type { ClaudeLimits, ClaudeLimitWindow, ClaudeRunUsage, RecentClaudeUsage } from '../../store/api';

const WINDOW_LABEL: Record<string, string> = {
  five_hour: '5 часов',
  seven_day: 'Неделя',
  seven_day_opus: 'Неделя · Opus',
  seven_day_sonnet: 'Неделя · Sonnet',
};

export type LimitTheme = 'success' | 'warning' | 'danger';

export interface LimitRow {
  key: string;
  label: string;
  /** 0..100, what the bar shows. */
  percent: number;
  theme: LimitTheme;
  /** "сброс через 3 ч", or a note that the window has already reset since the report. */
  reset: string;
  /** The window rolled over after the snapshot: the percent is from the previous one. */
  stale: boolean;
}

export function windowLabel(key: string): string {
  return WINDOW_LABEL[key] ?? key.replace(/_/g, ' ');
}

export function limitTheme(utilization: number): LimitTheme {
  if (utilization >= 0.9) return 'danger';
  if (utilization >= 0.75) return 'warning';

  return 'success';
}

// "через 3 ч 20 мин" / "через 2 дн 4 ч" — coarse on purpose; this is a gauge, not a clock.
export function formatResetIn(resetsAtSec: number, now: number): string {
  const minutes = Math.max(0, Math.round((resetsAtSec * 1000 - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;

  if (days > 0) return `через ${days} дн${hours ? ` ${hours} ч` : ''}`;
  if (hours > 0) return `через ${hours} ч${rest ? ` ${rest} мин` : ''}`;

  return `через ${Math.max(rest, 1)} мин`;
}

const ORDER = ['five_hour', 'seven_day'];

export function limitRows(limits: ClaudeLimits, now: number): LimitRow[] {
  const entries = Object.entries(limits.windows) as [string, ClaudeLimitWindow][];

  entries.sort(([a], [b]) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);

    return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib) || a.localeCompare(b);
  });

  return entries.map(([key, window]) => {
    const stale = window.resetsAt !== null && window.resetsAt * 1000 <= now;

    return {
      key,
      label: windowLabel(key),
      percent: Math.min(100, Math.round(window.utilization * 100)),
      theme: stale ? 'success' : limitTheme(window.utilization),
      reset: window.resetsAt === null ? '' : stale ? 'окно уже сброшено' : `сброс ${formatResetIn(window.resetsAt, now)}`,
      stale,
    };
  });
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// "$0.25 · 12.3k токенов" — what one run used. Cache reads count: they are most of a long agentic run.
export function describeUsage(usage: ClaudeRunUsage): string {
  const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  const parts: string[] = [];

  if (usage.costUsd !== null) parts.push(`$${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}`);
  parts.push(`${compact(tokens)} токенов`);

  return parts.join(' · ');
}

const runsWord = (n: number) => {
  const mod100 = n % 100;
  const mod10 = n % 10;

  if (mod100 >= 11 && mod100 <= 14) return 'запусков';
  if (mod10 === 1) return 'запуск';
  if (mod10 >= 2 && mod10 <= 4) return 'запуска';

  return 'запусков';
};

// "За 7 дней: 14 запусков · $3.20 · 1.2M токенов" — a token's runs summed over the week; no runs say so.
export function describeRecentUsage(usage: RecentClaudeUsage | null | undefined): string {
  if (!usage || usage.runs === 0) return 'За 7 дней запусков не было';

  const parts = [`${usage.runs} ${runsWord(usage.runs)}`];

  if (usage.costUsd !== null) parts.push(`$${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}`);
  parts.push(`${compact(usage.tokens)} токенов`);

  return `За 7 дней: ${parts.join(' · ')}`;
}

const SESSION_LIMIT = /session limit/i;
const MAX_DELAY_MS = 7 * 24 * 3600_000 - 60_000;

export function isSessionLimitFailure(errorMessage: string | null | undefined): boolean {
  return errorMessage != null && SESSION_LIMIT.test(errorMessage);
}

/**
 * When a failed session-limit job can be run again: the reset of the window the CLI rejected on
 * (else the earliest known upcoming reset) from the token's snapshot, as an ISO time a minute after it
 * — or null when the failure is something else or no usable reset time is known.
 */
export function limitResetAt(
  errorMessage: string | null | undefined,
  limits: ClaudeLimits | null | undefined,
  now: number,
): string | null {
  if (!isSessionLimitFailure(errorMessage) || !limits) return null;

  const upcoming = (resetsAt: number | null | undefined) =>
    typeof resetsAt === 'number' && resetsAt * 1000 > now && resetsAt * 1000 + 60_000 - now <= MAX_DELAY_MS
      ? resetsAt
      : null;
  const rejected = limits.rateLimitType ? upcoming(limits.windows[limits.rateLimitType]?.resetsAt) : null;
  const earliest = Object.values(limits.windows)
    .map((window) => upcoming(window.resetsAt))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0];
  const resetsAt = limits.status === 'rejected' ? (rejected ?? earliest) : earliest;

  return resetsAt == null ? null : new Date(resetsAt * 1000 + 60_000).toISOString();
}
