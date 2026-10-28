import { describe, expect, it } from 'vitest';

import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('prints bytes below 1 KiB as is', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(1023)).toBe('1023 Б');
  });

  it('switches to КБ, МБ and ГБ with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 КБ');
    expect(formatBytes(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 МБ');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 ГБ');
  });
});
