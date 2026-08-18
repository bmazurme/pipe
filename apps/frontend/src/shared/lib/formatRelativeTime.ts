const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Picks the Russian plural form for `count`.
 * `forms` is ordered [1 минуту, 2 минуты, 5 минут].
 */
function plural(count: number, forms: [string, string, string]): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }

  const mod10 = count % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Absolute "18.08.25, 15:04" — the fallback for anything older than a week. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "5 минут назад" for recent timestamps, an absolute date past a week — session
 * activity is much easier to judge as an age than as a wall-clock stamp.
 */
export function formatRelativeTime(value: string, now: number = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return '—';
  }

  // A negative diff means the server clock ran ahead of ours — treat it as now
  // rather than rendering a nonsensical "-1 минуту назад".
  const diff = now - timestamp;

  if (diff < MINUTE_MS) {
    return 'только что';
  }

  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / MINUTE_MS);
    return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])} назад`;
  }

  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    return `${hours} ${plural(hours, ['час', 'часа', 'часов'])} назад`;
  }

  if (diff < WEEK_MS) {
    const days = Math.floor(diff / DAY_MS);
    return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
  }

  return formatDateTime(value);
}
