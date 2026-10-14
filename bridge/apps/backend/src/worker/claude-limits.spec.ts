import { sanitizeLimits, sanitizeUsage } from './claude-limits';

const NOW = new Date('2026-10-14T12:00:00.000Z');

describe('sanitizeLimits', () => {
  it('keeps the known fields and stamps the time it was received', () => {
    expect(
      sanitizeLimits(
        {
          status: 'allowed',
          rateLimitType: 'five_hour',
          isUsingOverage: true,
          windows: { five_hour: { utilization: 0.16, resetsAt: 100 } },
          evil: 'x',
        },
        NOW,
      ),
    ).toEqual({
      status: 'allowed',
      rateLimitType: 'five_hour',
      isUsingOverage: true,
      windows: { five_hour: { utilization: 0.16, resetsAt: 100 } },
      reportedAt: '2026-10-14T12:00:00.000Z',
    });
  });

  it('drops windows with a bad name or value, and clamps utilization', () => {
    const limits = sanitizeLimits(
      {
        status: 'allowed',
        windows: {
          five_hour: { utilization: 9, resetsAt: 'x' },
          'Bad Name': { utilization: 0.1 },
          seven_day: { utilization: 'high' },
          negative: { utilization: -3 },
        },
      },
      NOW,
    );

    expect(limits?.windows).toEqual({
      five_hour: { utilization: 1.5, resetsAt: null },
      negative: { utilization: 0, resetsAt: null },
    });
  });

  it('is null without a status', () => {
    expect(sanitizeLimits(null, NOW)).toBeNull();
    expect(sanitizeLimits({ windows: {} }, NOW)).toBeNull();
    expect(sanitizeLimits([], NOW)).toBeNull();
  });
});

describe('sanitizeUsage', () => {
  it('rounds the counts and keeps a missing cost as null', () => {
    expect(
      sanitizeUsage({
        inputTokens: 1.6,
        outputTokens: -4,
        cacheReadTokens: 'x',
      }),
    ).toEqual({
      costUsd: null,
      inputTokens: 2,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it('is null for a non-object', () => {
    expect(sanitizeUsage('x')).toBeNull();
    expect(sanitizeUsage(undefined)).toBeNull();
  });
});
