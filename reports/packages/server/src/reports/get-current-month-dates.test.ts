import { describe, it, expect, vi, afterEach } from 'vitest';

import { getCurrentMonthDates } from './get-current-month-dates';

describe('getCurrentMonthDates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the first and last day of the current month', () => {
    const year = 2025;
    const month = 1; // February

    vi.setSystemTime(new Date(year, month, 15, 12, 0, 0));

    const { start, end } = getCurrentMonthDates();

    expect(start).toBe(new Date(year, month, 1, 0, 0, 0).toISOString().split('T')[0]);
    expect(end).toBe(new Date(year, month + 1, 0, 23, 59, 59).toISOString().split('T')[0]);
  });

  it('handles months with 31 days', () => {
    const year = 2025;
    const month = 0; // January

    vi.setSystemTime(new Date(year, month, 10, 12, 0, 0));

    const { start, end } = getCurrentMonthDates();

    expect(start).toBe(new Date(year, month, 1, 0, 0, 0).toISOString().split('T')[0]);
    expect(end).toBe(new Date(year, month + 1, 0, 23, 59, 59).toISOString().split('T')[0]);
  });
});
