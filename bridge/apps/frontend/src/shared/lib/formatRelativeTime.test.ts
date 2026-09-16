import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './formatRelativeTime';

const NOW = new Date('2026-08-18T12:00:00Z').getTime();

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('collapses anything under a minute to "только что"', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('только что');
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('только что');
  });

  it('treats a future timestamp as now instead of a negative age', () => {
    expect(formatRelativeTime(ago(-60_000), NOW)).toBe('только что');
  });

  it('picks the right Russian plural form for minutes', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1 минуту назад');
    expect(formatRelativeTime(ago(3 * 60_000), NOW)).toBe('3 минуты назад');
    expect(formatRelativeTime(ago(7 * 60_000), NOW)).toBe('7 минут назад');
    expect(formatRelativeTime(ago(11 * 60_000), NOW)).toBe('11 минут назад');
    expect(formatRelativeTime(ago(21 * 60_000), NOW)).toBe('21 минуту назад');
  });

  it('switches to hours and days as the age grows', () => {
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe('1 час назад');
    expect(formatRelativeTime(ago(5 * 60 * 60_000), NOW)).toBe('5 часов назад');
    expect(formatRelativeTime(ago(24 * 60 * 60_000), NOW)).toBe('1 день назад');
    expect(formatRelativeTime(ago(3 * 24 * 60 * 60_000), NOW)).toBe('3 дня назад');
  });

  it('falls back to an absolute date past a week', () => {
    expect(formatRelativeTime(ago(8 * 24 * 60 * 60_000), NOW)).toMatch(/^10\.08\.26/);
  });

  it('does not throw on an unparsable value', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('—');
  });
});
