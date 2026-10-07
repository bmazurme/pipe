import type { AppLog } from './entities/app-log.entity';
import { normalizeError, summarize } from './summary';

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

  it('handles an empty window', () => {
    const s = summarize([], 7);

    expect(s.total).toBe(0);
    expect(s.jobs.successRate).toBeNull();
    expect(s.jobs.avgDurationMs).toBeNull();
  });
});
