import { describe, expect, it } from 'vitest';

import { formatMs, formatPercent } from './logFormat';

describe('log formatting', () => {
  it('formats a success rate and treats missing as a dash', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.666)).toBe('67%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats durations compactly', () => {
    expect(formatMs(450)).toBe('450 мс');
    expect(formatMs(12_000)).toBe('12 с');
    expect(formatMs(185_000)).toBe('3 мин 05 с');
    expect(formatMs(null)).toBe('—');
  });
});
