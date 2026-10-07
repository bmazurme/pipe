// Quiet hours for automatic Telegram notifications: a daily window during
// which nothing is sent, and the morning digest that follows it.

export const DEFAULT_QUIET_HOURS = '23:00-08:00';
export const DEFAULT_QUIET_TIMEZONE = 'Europe/Moscow';

export interface QuietWindow {
  // Minutes since local midnight. start > end means the window wraps midnight.
  startMin: number;
  endMin: number;
}

const WINDOW_PATTERN = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function toMinutes(hours: string, minutes: string): number | null {
  const h = Number(hours);
  const m = Number(minutes);

  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : null;
}

// "23:00-08:00" → a window; "" / "off" / "none" → null (quiet hours disabled).
// Anything else is a configuration mistake and throws — silently ignoring it
// would turn quiet hours off without anyone noticing.
export function parseQuietHours(raw: string | undefined): QuietWindow | null {
  const value = (raw ?? DEFAULT_QUIET_HOURS).trim().toLowerCase();

  if (value === '' || value === 'off' || value === 'none') {
    return null;
  }

  const match = WINDOW_PATTERN.exec(value);
  const startMin = match ? toMinutes(match[1], match[2]) : null;
  const endMin = match ? toMinutes(match[3], match[4]) : null;

  if (startMin === null || endMin === null || startMin === endMin) {
    throw new Error(
      `NOTIFY_QUIET_HOURS must look like "23:00-08:00" (or "off"), got "${raw}"`,
    );
  }

  return { startMin, endMin };
}

export function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);

  return hour * 60 + minute;
}

export function isQuietNow(
  window: QuietWindow | null,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!window) {
    return false;
  }

  const minutes = localMinutes(now, timeZone);

  return window.startMin < window.endMin
    ? minutes >= window.startMin && minutes < window.endMin
    : minutes >= window.startMin || minutes < window.endMin;
}

export function formatLocalTime(date: Date, timeZone: string): string {
  const minutes = localMinutes(date, timeZone);

  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// Telegram rejects a message over 4096 characters; leave room for the header.
const DIGEST_CHUNK = 3500;

export interface DigestItem {
  text: string;
  createdAt: Date;
}

// One or more messages: a header with the count, then one bullet per
// notification with the local time it would have been sent. Long digests split
// on item boundaries, never mid-notification.
export function buildDigests(items: DigestItem[], timeZone: string): string[] {
  if (items.length === 0) {
    return [];
  }

  const lines = items.map(
    (item) => `• ${formatLocalTime(item.createdAt, timeZone)} ${item.text}`,
  );
  const chunks: string[][] = [[]];
  let size = 0;

  for (const line of lines) {
    if (size + line.length > DIGEST_CHUNK && chunks[chunks.length - 1].length) {
      chunks.push([]);
      size = 0;
    }

    chunks[chunks.length - 1].push(line);
    size += line.length + 1;
  }

  return chunks.map((chunk, index) => {
    const header =
      index === 0
        ? `🌅 Пока вы не получали уведомления (${items.length}):`
        : `🌅 …продолжение (${index + 1}/${chunks.length}):`;

    return [header, ...chunk].join('\n');
  });
}
