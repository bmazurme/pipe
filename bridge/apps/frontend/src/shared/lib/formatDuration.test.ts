import { describe, expect, it } from 'vitest';

import { formatDuration, jobDuration } from './formatDuration';

describe('formatDuration', () => {
  it('formats seconds, minutes and hours compactly', () => {
    expect(formatDuration(45_000)).toBe('45 с');
    expect(formatDuration(185_000)).toBe('3 мин 05 с');
    expect(formatDuration(3_720_000)).toBe('1 ч 02 мин');
  });

  it('rejects negative or non-finite input', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('jobDuration', () => {
  it('is null until the job has started', () => {
    expect(jobDuration({ startedAt: null, finishedAt: null })).toBeNull();
  });

  it('measures start → finish for a finished job', () => {
    expect(
      jobDuration({ startedAt: '2026-10-07T10:00:00Z', finishedAt: '2026-10-07T10:03:05Z' }),
    ).toBe('3 мин 05 с');
  });

  it('measures start → now while the job is still running', () => {
    const now = new Date('2026-10-07T10:00:30Z').getTime();

    expect(jobDuration({ startedAt: '2026-10-07T10:00:00Z', finishedAt: null }, now)).toBe('30 с');
  });
});
