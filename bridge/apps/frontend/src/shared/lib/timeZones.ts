// IANA zones for a picker: a short list of the common ones first, then everything the
// engine knows (Intl.supportedValuesOf where it exists), with the current value kept.
const FALLBACK_ZONES = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Vladivostok', 'Europe/Kyiv', 'Europe/Minsk', 'Asia/Almaty', 'Europe/Berlin', 'Europe/London', 'UTC'];

export function listTimeZones(current: string): string[] {
  let zones = FALLBACK_ZONES;

  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');

    if (supported?.length) zones = [...new Set([...FALLBACK_ZONES, ...supported])];
  } catch {
    // Older engines: the short list is enough.
  }

  return zones.includes(current) ? zones : [current, ...zones];
}
