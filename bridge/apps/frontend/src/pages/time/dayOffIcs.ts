import type { DayOff } from '../../store/api';
import { DAY_TYPE_LABELS } from './dayTypeLabels';

const CRLF = '\r\n';

/** `2025-12-31` → `20251231`, the all-day `VALUE=DATE` form. */
function icsDate(date: string): string {
  return date.replace(/-/g, '');
}

/** The day after an ISO date, in UTC so no time zone can shift it. */
function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** `DTSTAMP` wants a UTC date-time: `20251022T093000Z`. */
function icsTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 TEXT escaping — the labels need none today, but a label may change. */
function escapeText(text: string): string {
  return text.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\n/g, '\\n');
}

/**
 * The year's days off as an RFC 5545 calendar a calendar app can import: one
 * all-day event per entry, titled with the same wording as the legend. The UID
 * depends only on the date and type, so importing the file again updates the
 * events instead of duplicating them.
 */
export function buildDayOffsIcs(year: number, dayOffs: Pick<DayOff, 'date' | 'type'>[], now = new Date()): string {
  const stamp = icsTimestamp(now);
  const sorted = [...dayOffs].sort((a, b) => a.date.localeCompare(b.date));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//pipe//bridge time calendar//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`Дни отдыха ${year}`)}`,
    ...sorted.flatMap(({ date, type }) => [
      'BEGIN:VEVENT',
      `UID:dayoff-${date}-${type}@pipe-bridge`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(date))}`,
      `SUMMARY:${escapeText(DAY_TYPE_LABELS[type])}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];

  return lines.join(CRLF) + CRLF;
}

/** Saves the calendar as `days-off-<year>.ics` through a Blob link. */
export function downloadDayOffsIcs(year: number, dayOffs: Pick<DayOff, 'date' | 'type'>[]): void {
  const blob = new Blob([buildDayOffsIcs(year, dayOffs)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `days-off-${year}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
