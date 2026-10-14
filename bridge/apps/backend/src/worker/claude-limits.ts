// What a worker reports about the Claude plan it ran on (limit windows) and about one run (tokens, cost).
// Stored as snapshots: the CLI only tells us while it is running, so what a card shows is "as of reportedAt".
export interface ClaudeLimitWindow {
  /** 0..1 of the window's allowance. */
  utilization: number;
  /** Unix seconds when the window resets, or null when unknown. */
  resetsAt: number | null;
}

export interface ClaudeLimits {
  /** The CLI's own verdict: allowed, allowed_warning, rejected … */
  status: string;
  rateLimitType: string | null;
  isUsingOverage: boolean;
  /** five_hour, seven_day, … */
  windows: Record<string, ClaudeLimitWindow>;
  /** ISO time bridge received it. */
  reportedAt: string;
}

export interface ClaudeRunUsage {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const MAX_WINDOWS = 8;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const count = (value: unknown): number => {
  const n = finite(value);

  return n === null ? 0 : Math.max(0, Math.round(n));
};

// A worker is trusted with its own jobs, not with the shape of what it sends: keep only known fields, in range.
export function sanitizeLimits(raw: unknown, now: Date): ClaudeLimits | null {
  if (!isObject(raw) || typeof raw.status !== 'string') return null;

  const windows: Record<string, ClaudeLimitWindow> = {};

  if (isObject(raw.windows)) {
    for (const [name, value] of Object.entries(raw.windows).slice(
      0,
      MAX_WINDOWS,
    )) {
      const utilization = isObject(value) ? finite(value.utilization) : null;

      if (utilization === null || !/^[a-z0-9_]{1,40}$/.test(name)) continue;

      windows[name] = {
        utilization: Math.min(Math.max(utilization, 0), 1.5),
        resetsAt: finite((value as Record<string, unknown>).resetsAt),
      };
    }
  }

  return {
    status: raw.status.slice(0, 40),
    rateLimitType:
      typeof raw.rateLimitType === 'string'
        ? raw.rateLimitType.slice(0, 40)
        : null,
    isUsingOverage: raw.isUsingOverage === true,
    windows,
    reportedAt: now.toISOString(),
  };
}

export function sanitizeUsage(raw: unknown): ClaudeRunUsage | null {
  if (!isObject(raw)) return null;

  const costUsd = finite(raw.costUsd);

  return {
    costUsd: costUsd === null ? null : Math.max(0, costUsd),
    inputTokens: count(raw.inputTokens),
    outputTokens: count(raw.outputTokens),
    cacheReadTokens: count(raw.cacheReadTokens),
    cacheCreationTokens: count(raw.cacheCreationTokens),
  };
}
