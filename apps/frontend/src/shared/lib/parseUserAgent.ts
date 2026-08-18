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

export type DeviceKind = 'mobile' | 'tablet' | 'desktop' | 'unknown';

const KIND_PATTERNS: [RegExp, DeviceKind][] = [
  // iPad must win over the generic mobile check, and Android tablets are the
  // Android UAs that omit the "Mobile" token — so order matters here.
  [/ipad|tablet|playbook|silk/i, 'tablet'],
  [/iphone|ipod|windows phone|android.*mobile|mobile safari/i, 'mobile'],
  [/android/i, 'tablet'],
  [/windows|mac os x|macintosh|linux|cros/i, 'desktop'],
];

/**
 * Coarse form factor of the session's device — drives which icon the devices
 * list shows, so an unrecognized UA is better as 'unknown' than as a guess.
 */
export function getDeviceKind(userAgent: string | null): DeviceKind {
  if (!userAgent) {
    return 'unknown';
  }

  return (
    KIND_PATTERNS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'unknown'
  );
}
