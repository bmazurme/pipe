import type { ImproveSchedule } from '../../store/api';

// The offset of an IANA zone from UTC at a given moment, in minutes (DST included); 0 for a zone this engine does not know.
function utcOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((item) => item.type === 'timeZoneName')?.value;
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(part ?? '');

    if (!match) return 0;
    if (!match[1]) return 0;

    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}

type Timed = Pick<ImproveSchedule, 'id' | 'name' | 'hour' | 'minute' | 'timezone'>;

// The zone the order is read in: the one most schedules are set in (a tie goes to the oldest schedule's), so for the usual case of
// one zone the list reads exactly like the times shown — 00:05, 02:00, 06:15, 22:30 — and only an odd one out is moved.
export function referenceZone(schedules: Timed[]): string {
  const counts = new Map<string, number>();

  for (const item of schedules) counts.set(item.timezone, (counts.get(item.timezone) ?? 0) + 1);

  const best = Math.max(0, ...counts.values());
  const oldest = [...schedules].sort((a, b) => a.id - b.id).find((item) => counts.get(item.timezone) === best);

  return oldest?.timezone ?? 'UTC';
}

// When in the day a schedule fires, in minutes after midnight of the reference zone. Schedules run once a day at their own
// hour:minute in their own zone, so ones from different zones are brought to one clock before they are compared.
export function runMinuteOfDay(schedule: Pick<ImproveSchedule, 'hour' | 'minute' | 'timezone'>, inZone: string, now: Date = new Date()): number {
  const local = schedule.hour * 60 + schedule.minute;
  const shifted = local - utcOffsetMinutes(schedule.timezone, now) + utcOffsetMinutes(inZone, now);

  return ((shifted % 1440) + 1440) % 1440;
}

// The schedules by the time they run, earliest first; the same time — by name, so the order does not jump around between reloads.
export function sortSchedulesByRunTime<T extends Timed>(schedules: T[], now: Date = new Date()): T[] {
  const zone = referenceZone(schedules);

  return [...schedules].sort(
    (a, b) => runMinuteOfDay(a, zone, now) - runMinuteOfDay(b, zone, now) || a.name.localeCompare(b.name, 'ru') || a.id - b.id,
  );
}
