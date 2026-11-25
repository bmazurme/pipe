import { describe, expect, it } from 'vitest';

import type { ClaudeLimits } from '../../store/api';
import { describeRecentUsage, describeUsage, formatResetIn, limitRows, limitTheme, windowLabel } from './claudeLimits';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const sec = (iso: string) => Date.parse(iso) / 1000;

const limits = (windows: ClaudeLimits['windows']): ClaudeLimits => ({
  status: 'allowed',
  rateLimitType: null,
  isUsingOverage: false,
  windows,
  reportedAt: '2026-10-14T11:55:00Z',
});

describe('limitTheme', () => {
  it('turns warning at 75% and danger at 90%', () => {
    expect([0, 0.5, 0.74].map(limitTheme)).toEqual(['success', 'success', 'success']);
    expect([0.75, 0.89].map(limitTheme)).toEqual(['warning', 'warning']);
    expect([0.9, 1, 1.2].map(limitTheme)).toEqual(['danger', 'danger', 'danger']);
  });
});

describe('formatResetIn', () => {
  it('is coarse: minutes, hours and minutes, days and hours', () => {
    expect(formatResetIn(sec('2026-10-14T12:10:00Z'), NOW)).toBe('через 10 мин');
    expect(formatResetIn(sec('2026-10-14T15:20:00Z'), NOW)).toBe('через 3 ч 20 мин');
    expect(formatResetIn(sec('2026-10-14T16:00:00Z'), NOW)).toBe('через 4 ч');
    expect(formatResetIn(sec('2026-10-16T16:00:00Z'), NOW)).toBe('через 2 дн 4 ч');
  });
});

describe('limitRows', () => {
  it('lists five-hour first, then the week, then anything else, with labels and percents', () => {
    const rows = limitRows(
      limits({
        seven_day_opus: { utilization: 0.1, resetsAt: sec('2026-10-20T12:00:00Z') },
        seven_day: { utilization: 0.76, resetsAt: sec('2026-10-19T12:00:00Z') },
        five_hour: { utilization: 0.16, resetsAt: sec('2026-10-14T14:00:00Z') },
      }),
      NOW,
    );

    expect(rows.map((row) => [row.label, row.percent, row.theme])).toEqual([
      ['5 часов', 16, 'success'],
      ['Неделя', 76, 'warning'],
      ['Неделя · Opus', 10, 'success'],
    ]);
    expect(rows[0].reset).toBe('сброс через 2 ч');
  });

  it('marks a window that has rolled over since the report instead of showing an old alarm', () => {
    const [row] = limitRows(limits({ five_hour: { utilization: 0.95, resetsAt: sec('2026-10-14T11:00:00Z') } }), NOW);

    expect(row).toMatchObject({ stale: true, theme: 'success', reset: 'окно уже сброшено' });
  });

  it('caps the bar at 100% and tolerates an unknown reset', () => {
    const [row] = limitRows(limits({ five_hour: { utilization: 1.3, resetsAt: null } }), NOW);

    expect(row).toMatchObject({ percent: 100, theme: 'danger', reset: '' });
  });
});

describe('windowLabel', () => {
  it('humanizes an unknown window name', () => {
    expect(windowLabel('thirty_day_extra')).toBe('thirty day extra');
  });
});

describe('describeUsage', () => {
  it('shows cost and all tokens, compactly', () => {
    expect(describeUsage({ costUsd: 0.254, inputTokens: 2, outputTokens: 4000, cacheReadTokens: 8000, cacheCreationTokens: 300 })).toBe('$0.25 · 12.3k токенов');
  });

  it('leaves the cost out when unknown and keeps tiny costs visible', () => {
    expect(describeUsage({ costUsd: null, inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe('10 токенов');
    expect(describeUsage({ costUsd: 0.0025, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 })).toContain('$0.0025');
  });
});

describe('describeRecentUsage', () => {
  it('shows runs, cost and tokens', () => {
    expect(describeRecentUsage({ runs: 14, costUsd: 3.2, tokens: 1_200_000 })).toBe('За 7 дней: 14 запусков · $3.20 · 1.2M токенов');
  });

  it('declines the word for runs and leaves out an unknown cost', () => {
    expect(describeRecentUsage({ runs: 1, costUsd: null, tokens: 900 })).toBe('За 7 дней: 1 запуск · 900 токенов');
    expect(describeRecentUsage({ runs: 3, costUsd: null, tokens: 5000 })).toContain('3 запуска');
    expect(describeRecentUsage({ runs: 12, costUsd: null, tokens: 5 })).toContain('12 запусков');
  });

  it('says there were no runs', () => {
    expect(describeRecentUsage(null)).toBe('За 7 дней запусков не было');
    expect(describeRecentUsage({ runs: 0, costUsd: null, tokens: 0 })).toBe('За 7 дней запусков не было');
  });
});
