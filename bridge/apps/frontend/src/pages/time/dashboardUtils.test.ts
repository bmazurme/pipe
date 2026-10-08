import { describe, expect, it } from 'vitest';

import { monthStats, normRatio, summarizeReport } from './dashboardUtils';

describe('monthStats', () => {
  it('counts a plain month: weekends are not working days', () => {
    // October 2026 starts on a Thursday: 5 Saturdays + 4 Sundays = 9 weekend days.
    const stats = monthStats(2026, 10, []);

    expect(stats).toMatchObject({ allDays: 31, weekends: 9, holidays: 0, offDays: 0, shortDays: 0, workDays: 22, norm: 176 });
  });

  it('takes holidays and days off out of the working days', () => {
    const stats = monthStats(2026, 10, [
      { date: '2026-10-05', type: 'holiday' },
      { date: '2026-10-06', type: 'off' },
    ]);

    expect(stats).toMatchObject({ holidays: 1, offDays: 1, workDays: 20, norm: 160 });
  });

  it('takes one hour off the norm per short day, without losing the working day', () => {
    const stats = monthStats(2026, 10, [{ date: '2026-10-07', type: 'short' }]);

    expect(stats).toMatchObject({ shortDays: 1, workDays: 22, norm: 175 });
  });

  it('does not count a holiday or day off on a weekend a second time', () => {
    // 2026-10-03 is a Saturday.
    const stats = monthStats(2026, 10, [
      { date: '2026-10-03', type: 'holiday' },
      { date: '2026-10-04', type: 'off' },
    ]);

    expect(stats).toMatchObject({ weekends: 9, holidays: 0, offDays: 0, workDays: 22 });
  });

  it('treats a compensatory weekend as a working day', () => {
    const stats = monthStats(2026, 10, [{ date: '2026-10-03', type: 'compensatory' }]);

    expect(stats).toMatchObject({ weekends: 8, workDays: 23, norm: 184 });
  });

  it('handles a leap-year February', () => {
    expect(monthStats(2028, 2, []).allDays).toBe(29);
  });
});

describe('summarizeReport', () => {
  it('totals hours and splits closed from in-progress tasks', () => {
    expect(
      summarizeReport([
        { hours: 8, status: 'Закрыта' },
        { hours: 2.5, status: 'В работе' },
        { hours: 1, status: 'Закрыта' },
      ]),
    ).toEqual({ totalHours: 11.5, tasks: 3, closed: 2, inProgress: 1 });
  });

  it('is all zeros for an empty report', () => {
    expect(summarizeReport([])).toEqual({ totalHours: 0, tasks: 0, closed: 0, inProgress: 0 });
  });
});

describe('normRatio', () => {
  it('is a percentage of the norm, and 0 without one', () => {
    expect(normRatio(88, 176)).toBe(50);
    expect(normRatio(10, 0)).toBe(0);
  });
});
