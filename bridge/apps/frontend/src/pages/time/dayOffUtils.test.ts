import { describe, expect, it } from 'vitest';

import {
  countWeekends,
  groupConsecutiveDayOffs,
  isWeekend,
  listDates,
  weekdayShort,
} from './dayOffUtils';

function d(date: string, type: 'off' | 'holiday' | 'short' = 'off') {
  return { id: date, date, type };
}

describe('groupConsecutiveDayOffs', () => {
  it('groups adjacent calendar days into one run', () => {
    const groups = groupConsecutiveDayOffs([d('2026-03-15'), d('2026-03-16'), d('2026-03-17')]);
    expect(groups).toEqual([[d('2026-03-15'), d('2026-03-16'), d('2026-03-17')]]);
  });

  it('splits on a gap of one or more days', () => {
    const groups = groupConsecutiveDayOffs([d('2026-03-15'), d('2026-03-16'), d('2026-03-20')]);
    expect(groups).toEqual([[d('2026-03-15'), d('2026-03-16')], [d('2026-03-20')]]);
  });

  it('keeps isolated single days as their own one-item group', () => {
    const groups = groupConsecutiveDayOffs([d('2026-01-01'), d('2026-06-01'), d('2026-12-31')]);
    expect(groups).toEqual([[d('2026-01-01')], [d('2026-06-01')], [d('2026-12-31')]]);
  });

  it('spans a month boundary correctly', () => {
    const groups = groupConsecutiveDayOffs([d('2026-01-31'), d('2026-02-01')]);
    expect(groups).toEqual([[d('2026-01-31'), d('2026-02-01')]]);
  });

  it('spans a year boundary correctly', () => {
    const groups = groupConsecutiveDayOffs([d('2025-12-31'), d('2026-01-01')]);
    expect(groups).toEqual([[d('2025-12-31'), d('2026-01-01')]]);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupConsecutiveDayOffs([])).toEqual([]);
  });

  it('splits an otherwise-consecutive run when the type changes', () => {
    const groups = groupConsecutiveDayOffs([
      d('2026-01-01', 'holiday'),
      d('2026-01-02', 'holiday'),
      d('2026-01-03', 'off'),
    ]);
    expect(groups).toEqual([
      [d('2026-01-01', 'holiday'), d('2026-01-02', 'holiday')],
      [d('2026-01-03', 'off')],
    ]);
  });
});

describe('weekdayShort / isWeekend', () => {
  it('names the weekday of the calendar day, short and capitalised', () => {
    // 2026-10-19 is a Monday.
    expect(weekdayShort('2026-10-19')).toBe('Пн');
    expect(weekdayShort('2026-10-20')).toBe('Вт');
    expect(weekdayShort('2026-10-24')).toBe('Сб');
    expect(weekdayShort('2026-10-25')).toBe('Вс');
  });

  it('does not slip a day at the edges of the year, whatever the timezone', () => {
    expect(weekdayShort('2026-01-01')).toBe('Чт');
    expect(weekdayShort('2026-12-31')).toBe('Чт');
  });

  it('marks Saturday and Sunday only', () => {
    expect(['2026-10-19', '2026-10-23', '2026-10-24', '2026-10-25'].map(isWeekend)).toEqual([false, false, true, true]);
  });
});

describe('listDates', () => {
  it('returns a single date when start equals end', () => {
    expect(listDates('2026-05-01', '2026-05-01')).toEqual(['2026-05-01']);
  });

  it('is inclusive and crosses month and year boundaries', () => {
    expect(listDates('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('is empty when end is before start', () => {
    expect(listDates('2026-05-02', '2026-05-01')).toEqual([]);
  });
});

describe('countWeekends', () => {
  it('counts Saturdays and Sundays only', () => {
    expect(countWeekends(listDates('2026-10-19', '2026-10-25'))).toBe(2);
  });
});
