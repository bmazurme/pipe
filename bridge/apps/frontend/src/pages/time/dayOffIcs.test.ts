import { describe, expect, it } from 'vitest';

import { buildDayOffsIcs } from './dayOffIcs';

const NOW = new Date('2025-10-22T09:30:00.123Z');

function events(ics: string): string[][] {
  return ics
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((block) => block.split('\r\n'));
}

describe('buildDayOffsIcs', () => {
  it('makes one all-day event per entry, titled with the day type', () => {
    const ics = buildDayOffsIcs(
      2025,
      [
        { date: '2025-03-12', type: 'short' },
        { date: '2025-03-08', type: 'holiday' },
      ],
      NOW,
    );

    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);

    const [holiday, short] = events(ics);
    expect(holiday).toContain('DTSTART;VALUE=DATE:20250308');
    expect(holiday).toContain('DTEND;VALUE=DATE:20250309');
    expect(holiday).toContain('SUMMARY:Праздник');
    expect(holiday).toContain('DTSTAMP:20251022T093000Z');
    expect(short).toContain('DTSTART;VALUE=DATE:20250312');
    expect(short).toContain('DTEND;VALUE=DATE:20250313');
    expect(short).toContain('SUMMARY:Короткий день');
  });

  it('ends an event on the next day across month and year boundaries', () => {
    const ics = buildDayOffsIcs(
      2025,
      [
        { date: '2025-02-28', type: 'off' },
        { date: '2025-12-31', type: 'compensatory' },
      ],
      NOW,
    );

    const [february, december] = events(ics);
    expect(february).toContain('DTEND;VALUE=DATE:20250301');
    expect(february).toContain('SUMMARY:Day off');
    expect(december).toContain('DTEND;VALUE=DATE:20260101');
    expect(december).toContain('SUMMARY:Рабочий выходной');
  });

  it('gives each event a UID that stays the same between exports', () => {
    const dayOffs = [{ date: '2025-01-01', type: 'holiday' as const }];
    const first = buildDayOffsIcs(2025, dayOffs, NOW);
    const second = buildDayOffsIcs(2025, dayOffs, new Date('2026-01-01T00:00:00Z'));

    expect(first).toContain('UID:dayoff-2025-01-01-holiday@pipe-bridge\r\n');
    expect(second).toContain('UID:dayoff-2025-01-01-holiday@pipe-bridge\r\n');
  });

  it('ends every line with CRLF', () => {
    const ics = buildDayOffsIcs(2025, [{ date: '2025-05-09', type: 'holiday' }], NOW);

    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});
