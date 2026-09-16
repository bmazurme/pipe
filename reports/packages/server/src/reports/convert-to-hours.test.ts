import { describe, it, expect } from 'vitest';

import { convertToHours } from './convert-to-hours';

describe('convertToHours', () => {
  it('returns 0 for an empty string', () => {
    expect(convertToHours('')).toBe(0);
  });

  it('converts hours', () => {
    expect(convertToHours('5h')).toBe(5);
  });

  it('converts days to hours (1d = 8h)', () => {
    expect(convertToHours('2d')).toBe(16);
  });

  it('converts weeks to hours (1w = 40h)', () => {
    expect(convertToHours('1w')).toBe(40);
  });

  it('converts months to hours (1mo = 120h)', () => {
    expect(convertToHours('1mo')).toBe(120);
  });

  it('combines multiple units', () => {
    expect(convertToHours('1mo 1w 2d 3h')).toBe(120 + 40 + 16 + 3);
  });
});
