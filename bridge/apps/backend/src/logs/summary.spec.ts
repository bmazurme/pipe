import type { AppLog } from './entities/app-log.entity';
import {
  mergeCounts,
  normalizeError,
  summarize,
  summarizeEvents,
} from './summary';

let id = 0;
const row = (
  event: string,
  level: AppLog['level'],
  source: AppLog['source'],
  message: string,
  meta?: object,
) =>
  ({
    id: ++id,
    level,
    source,
    event,
    message,
    meta: meta ? JSON.stringify(meta) : null,
  }) as AppLog;

describe('normalizeError', () => {
  it('collapses numbers so the same problem groups together', () => {
    expect(normalizeError('claude timed out after 1800s')).toBe(
      normalizeError('claude timed out after 60s'),
    );
  });
});

describe('summarize', () => {
  const rows = [
    row('job.succeeded', 'info', 'job', 'Job 1 succeeded', {
      durationMs: 40_000,
    }),
    row('job.succeeded', 'info', 'job', 'Job 2 succeeded', {
      durationMs: 20_000,
    }),
    row('job.failed', 'error', 'job', 'Job 3 failed: timed out after 1800s', {
      durationMs: 1_800_000,
    }),
    row('job.failed', 'error', 'job', 'Job 4 failed: timed out after 60s'),
    row('http.error', 'error', 'http', 'GET /api/v1/x → 500 in 30ms', {
      route: '/api/v1/x',
      durationMs: 30,
    }),
    row('http.slow', 'warn', 'http', 'GET /api/v1/y → 200 in 3000ms', {
      route: '/api/v1/y',
      durationMs: 3000,
    }),
  ];

  it('counts by level and source', () => {
    const s = summarize(rows, 7);

    expect(s.total).toBe(6);
    expect(s.byLevel).toEqual({ info: 2, error: 3, warn: 1 });
    expect(s.bySource).toEqual({ job: 4, http: 2 });
  });

  it('computes job success rate and average duration where known', () => {
    const { jobs } = summarize(rows, 7);

    expect(jobs.succeeded).toBe(2);
    expect(jobs.failed).toBe(2);
    expect(jobs.successRate).toBe(0.5);
    expect(jobs.avgDurationMs).toBe(620_000);
  });

  it('groups top errors after normalizing numbers', () => {
    const { topErrors } = summarize(rows, 7);

    expect(topErrors[0]).toEqual({
      message: 'Job N failed: timed out after Ns',
      count: 2,
    });
  });

  it('ranks routes by their slowest request', () => {
    expect(summarize(rows, 7).slowestRoutes[0]).toEqual({
      route: '/api/v1/y',
      count: 1,
      maxMs: 3000,
    });
  });

  it('keeps fast 5xx out of slowestRoutes and ranks failingRoutes by count', () => {
    const mixed = [
      row('http.slow', 'warn', 'http', 'slow', {
        route: '/s',
        durationMs: 900,
      }),
      row('http.error', 'error', 'http', 'e1', { route: '/a', durationMs: 1 }),
      row('http.error', 'error', 'http', 'e2', { route: '/b', durationMs: 5 }),
      row('http.error', 'error', 'http', 'e3', { route: '/b', durationMs: 2 }),
    ];
    const s = summarize(mixed, 7);

    expect(s.slowestRoutes).toEqual([{ route: '/s', count: 1, maxMs: 900 }]);
    expect(s.failingRoutes).toEqual([
      { route: '/b', count: 2, maxMs: 5 },
      { route: '/a', count: 1, maxMs: 1 },
    ]);
  });

  it('handles an empty window', () => {
    const s = summarize([], 7);

    expect(s.total).toBe(0);
    expect(s.jobs.successRate).toBeNull();
    expect(s.jobs.avgDurationMs).toBeNull();
  });
});

describe('summarize with repeated', () => {
  it('counts a row with meta.repeated as itself plus the repeats', () => {
    const row = {
      level: 'error',
      source: 'http',
      event: 'http.error',
      message: 'POST /hook → 500 in 5ms',
      meta: JSON.stringify({ route: '/hook', durationMs: 5, repeated: 9 }),
    } as unknown as AppLog;
    const result = summarize([row], 7);

    expect(result.failingRoutes[0].count).toBe(10);
    expect(result.topErrors[0].count).toBe(10);
  });
});

describe('summarizeEvents / mergeCounts', () => {
  it('ignores rows of other events', () => {
    const noise = [
      row('telegram.api_failed', 'warn', 'integration', 'getUpdates failed', {
        route: '/x',
        durationMs: 99_999,
      }),
      row('loop.tick', 'info', 'loop', 'tick'),
    ];
    const real = [
      row('http.error', 'error', 'http', 'e', { route: '/a', durationMs: 1 }),
    ];

    expect(summarizeEvents([...noise, ...real])).toEqual(summarizeEvents(real));
    expect(summarizeEvents(noise).topErrors).toEqual([]);
    expect(summarizeEvents(noise).failingRoutes).toEqual([]);
  });

  it('merges grouped counts into the summary', () => {
    const s = mergeCounts(
      [
        { level: 'info', source: 'http', count: 30_000 },
        { level: 'warn', source: 'integration', count: 5 },
        { level: 'warn', source: 'http', count: 2 },
      ],
      summarizeEvents([]),
      7,
    );

    expect(s.total).toBe(30_007);
    expect(s.byLevel).toEqual({ info: 30_000, warn: 7 });
    expect(s.bySource).toEqual({ http: 30_002, integration: 5 });
  });
});
