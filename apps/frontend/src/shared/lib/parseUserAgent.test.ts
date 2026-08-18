import { describe, expect, it } from 'vitest';

import { parseUserAgent } from './parseUserAgent';

describe('parseUserAgent', () => {
  it('returns a fallback for null', () => {
    expect(parseUserAgent(null)).toBe('Неизвестное устройство');
  });

  it('detects browser and OS together', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
    expect(parseUserAgent(ua)).toBe('Chrome, Windows');
  });

  it('detects Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0';
    expect(parseUserAgent(ua)).toBe('Firefox, Linux');
  });

  it('detects Safari on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
    expect(parseUserAgent(ua)).toBe('Safari, macOS');
  });

  it('falls back when neither OS nor browser is recognized', () => {
    expect(parseUserAgent('SomeBot/1.0')).toBe('Неизвестное устройство');
  });
});
