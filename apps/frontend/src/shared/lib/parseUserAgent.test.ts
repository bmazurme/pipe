import { describe, expect, it } from 'vitest';

import { getDeviceKind, parseUserAgent } from './parseUserAgent';

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

describe('getDeviceKind', () => {
  it('returns unknown without a user agent', () => {
    expect(getDeviceKind(null)).toBe('unknown');
    expect(getDeviceKind('SomeBot/1.0')).toBe('unknown');
  });

  it('detects phones', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
    expect(getDeviceKind(ua)).toBe('mobile');
    expect(
      getDeviceKind('Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120.0 Mobile Safari/537.36'),
    ).toBe('mobile');
  });

  it('prefers tablet over mobile for iPads and tokenless Android', () => {
    expect(
      getDeviceKind('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1'),
    ).toBe('tablet');
    expect(
      getDeviceKind('Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120.0 Safari/537.36'),
    ).toBe('tablet');
  });

  it('detects desktops', () => {
    expect(
      getDeviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36'),
    ).toBe('desktop');
    expect(
      getDeviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'),
    ).toBe('desktop');
  });
});
