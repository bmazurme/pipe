import { describe, expect, it } from 'vitest';

import { formatMs, formatPercent, searchTermFromNormalized } from './logFormat';

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

describe('searchTermFromNormalized', () => {
  it('keeps the longest literal fragment between placeholders', () => {
    expect(searchTermFromNormalized('Job N failed: fetch failed')).toBe('failed: fetch failed');
    expect(searchTermFromNormalized('GET /api/vN/vpn/status → N in Nms')).toBe('/vpn/status');
  });

  it('returns an empty string when only placeholders remain', () => {
    expect(searchTermFromNormalized('N')).toBe('');
    expect(searchTermFromNormalized('N N')).toBe('');
  });

  it('handles a message cut at 160 characters', () => {
    const message = `Job N failed: ${'x'.repeat(146)}`;

    expect(message).toHaveLength(160);
    expect(searchTermFromNormalized(message)).toBe(`failed: ${'x'.repeat(146)}`);
    expect(searchTermFromNormalized('Job N failed: boom…')).toBe('failed: boom');
  });
});
