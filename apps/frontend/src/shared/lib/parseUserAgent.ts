const OS_PATTERNS: [RegExp, string][] = [
  [/windows/i, 'Windows'],
  [/mac os x|macintosh/i, 'macOS'],
  [/iphone/i, 'iPhone'],
  [/ipad/i, 'iPad'],
  [/android/i, 'Android'],
  [/linux/i, 'Linux'],
];

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/yabrowser/i, 'Yandex Browser'],
  [/chrome\//i, 'Chrome'],
  [/firefox\//i, 'Firefox'],
  [/safari\//i, 'Safari'],
];

export function parseUserAgent(userAgent: string | null): string {
  if (!userAgent) {
    return 'Неизвестное устройство';
  }

  const os = OS_PATTERNS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const browser = BROWSER_PATTERNS.find(([pattern]) =>
    pattern.test(userAgent),
  )?.[1];

  if (os && browser) return `${browser}, ${os}`;
  if (browser) return browser;
  if (os) return os;
  return 'Неизвестное устройство';
}
