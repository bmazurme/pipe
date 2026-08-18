import { describe, expect, it } from 'vitest';

import { groupConsecutiveDayOffs } from './dayOffUtils';

function d(date: string) {
  return { id: date, date };
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
});
