import type { AppLog } from './entities/app-log.entity';

export interface LogSummary {
  days: number;
  total: number;
  // True when the row cap was hit, so older rows in the window were dropped.
  truncated: boolean;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  jobs: {
    succeeded: number;
    failed: number;
    // Share of finished jobs that succeeded, 0..1; null when none finished.
    successRate: number | null;
    avgDurationMs: number | null;
  };
  // Most frequent failure messages (jobs and 5xx), numbers stripped so
  // "failed after 12s" and "failed after 40s" count as one problem.
  topErrors: Array<{ message: string; count: number }>;
  slowestRoutes: Array<{ route: string; count: number; maxMs: number }>;
}

function parseMeta(meta: string | null): Record<string, unknown> {
  if (!meta) return {};

  try {
    return JSON.parse(meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function normalizeError(message: string): string {
  return message
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function summarize(
  rows: AppLog[],
  days: number,
): Omit<LogSummary, 'truncated'> {
  const byLevel: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const errors = new Map<string, number>();
  const routes = new Map<string, { count: number; maxMs: number }>();
  let succeeded = 0;
  let failed = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const row of rows) {
    increment(byLevel, row.level);
    increment(bySource, row.source);

    const meta = parseMeta(row.meta);

    if (row.event === 'job.succeeded' || row.event === 'job.failed') {
      if (row.event === 'job.succeeded') succeeded += 1;
      else failed += 1;

      if (typeof meta.durationMs === 'number') {
        durationSum += meta.durationMs;
        durationCount += 1;
      }
    }

    if (row.event === 'job.failed' || row.event === 'http.error') {
      const key = normalizeError(row.message);

      errors.set(key, (errors.get(key) ?? 0) + 1);
    }

    if (
      (row.event === 'http.slow' || row.event === 'http.error') &&
      typeof meta.route === 'string' &&
      typeof meta.durationMs === 'number'
    ) {
      const entry = routes.get(meta.route) ?? { count: 0, maxMs: 0 };

      entry.count += 1;
      entry.maxMs = Math.max(entry.maxMs, meta.durationMs);
      routes.set(meta.route, entry);
    }
  }

  const finished = succeeded + failed;

  return {
    days,
    total: rows.length,
    byLevel,
    bySource,
    jobs: {
      succeeded,
      failed,
      successRate: finished ? succeeded / finished : null,
      avgDurationMs: durationCount
        ? Math.round(durationSum / durationCount)
        : null,
    },
    topErrors: [...errors.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    slowestRoutes: [...routes.entries()]
      .map(([route, v]) => ({ route, ...v }))
      .sort((a, b) => b.maxMs - a.maxMs)
      .slice(0, 5),
  };
}
