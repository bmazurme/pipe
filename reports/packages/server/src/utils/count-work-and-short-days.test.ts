import { describe, it, expect } from 'vitest';

import { countWorkAndShortDays } from './count-work-and-short-days';

describe('countWorkAndShortDays', () => {
  it('throws for an invalid year', () => {
    expect(() => countWorkAndShortDays(0)).toThrow('Год должен быть целым числом от 1 до 9999');
    expect(() => countWorkAndShortDays(1.5)).toThrow();
    expect(() => countWorkAndShortDays(10000)).toThrow();
  });

  it('counts all days and weekends for a month with no extra config', () => {
    const data = countWorkAndShortDays(2025);

    // January 2025 has 31 days, 8 of which are weekends (4 Sat + 4 Sun)
    expect(data[1].allDays).toBe(31);
    expect(data[1].weekends).toBe(8);
    expect(data[1].holidays).toBe(0);
    expect(data[1].offDays).toBe(0);
    expect(data[1].workDays).toBe(31 - 8);
    expect(data[1].hours).toBe((31 - 8) * 8);
  });

  it('counts holidays that fall on a weekday', () => {
    // 2025-01-01 is a Wednesday
    const data = countWorkAndShortDays(2025, ['2025-01-01']);

    expect(data[1].holidays).toBe(1);
    expect(data[1].workDays).toBe(31 - 8 - 1);
  });

  it('ignores holidays that fall on a weekend', () => {
    // 2025-01-04 is a Saturday
    const data = countWorkAndShortDays(2025, ['2025-01-04']);

    expect(data[1].holidays).toBe(0);
    expect(data[1].weekends).toBe(8);
  });

  it('treats badDays weekends as work days', () => {
    // 2025-01-04 is a Saturday
    const data = countWorkAndShortDays(2025, [], [], ['2025-01-04']);

    expect(data[1].weekends).toBe(7);
    expect(data[1].workDays).toBe(31 - 7);
  });

  it('subtracts shortDays hours and counts them', () => {
    // 2025-01-08 is a Wednesday
    const data = countWorkAndShortDays(2025, [], ['2025-01-08']);

    expect(data[1].shortDays).toBe(1);
    expect(data[1].hours).toBe((31 - 8) * 8 - 1);
  });

  it('counts offDays and excludes them from work days', () => {
    // 2025-01-08 is a Wednesday
    const data = countWorkAndShortDays(2025, [], [], [], ['2025-01-08']);

    expect(data[1].offDays).toBe(1);
    expect(data[1].workDays).toBe(31 - 8 - 1);
  });
});
