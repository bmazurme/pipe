import {
  buildDigests,
  formatLocalTime,
  isQuietNow,
  localMinutes,
  parseQuietHours,
} from './quiet-hours';

const MSK = 'Europe/Moscow'; // UTC+3, no DST

describe('parseQuietHours', () => {
  it('defaults to 23:00-08:00', () => {
    expect(parseQuietHours(undefined)).toEqual({ startMin: 1380, endMin: 480 });
  });

  it('parses a custom window, tolerating a one-digit hour', () => {
    expect(parseQuietHours(' 9:30-18:05 ')).toEqual({
      startMin: 570,
      endMin: 1085,
    });
  });

  it('is disabled by "off", "none" or an empty string', () => {
    for (const value of ['off', 'OFF', 'none', '', '  ']) {
      expect(parseQuietHours(value)).toBeNull();
    }
  });

  it('rejects malformed or degenerate windows instead of silently disabling', () => {
    for (const value of [
      'night',
      '25:00-08:00',
      '23:00-08:60',
      '10:00-10:00',
    ]) {
      expect(() => parseQuietHours(value)).toThrow(/NOTIFY_QUIET_HOURS/);
    }
  });
});

describe('isQuietNow', () => {
  const night = parseQuietHours('23:00-08:00');
  // 2026-10-07T20:00Z is 23:00 in Moscow.
  const at = (iso: string) => new Date(iso);

  it('wraps midnight', () => {
    expect(isQuietNow(night, MSK, at('2026-10-07T20:00:00Z'))).toBe(true); // 23:00
    expect(isQuietNow(night, MSK, at('2026-10-07T22:30:00Z'))).toBe(true); // 01:30
    expect(isQuietNow(night, MSK, at('2026-10-08T04:59:00Z'))).toBe(true); // 07:59
  });

  it('is not quiet at the end of the window or during the day', () => {
    expect(isQuietNow(night, MSK, at('2026-10-08T05:00:00Z'))).toBe(false); // 08:00
    expect(isQuietNow(night, MSK, at('2026-10-08T09:00:00Z'))).toBe(false); // 12:00
    expect(isQuietNow(night, MSK, at('2026-10-07T19:59:00Z'))).toBe(false); // 22:59
  });

  it('handles a same-day window', () => {
    const lunch = parseQuietHours('12:00-13:00');

    expect(isQuietNow(lunch, MSK, at('2026-10-08T09:30:00Z'))).toBe(true);
    expect(isQuietNow(lunch, MSK, at('2026-10-08T10:00:00Z'))).toBe(false);
  });

  it('uses the configured time zone, not the server clock', () => {
    // 20:00Z is 23:00 in Moscow but 20:00 in UTC.
    expect(isQuietNow(night, 'UTC', at('2026-10-07T20:00:00Z'))).toBe(false);
  });

  it('is never quiet when disabled', () => {
    expect(isQuietNow(null, MSK, at('2026-10-07T22:30:00Z'))).toBe(false);
  });
});

describe('localMinutes / formatLocalTime', () => {
  it('converts to the zone and pads', () => {
    const date = new Date('2026-10-07T22:05:00Z');

    expect(localMinutes(date, MSK)).toBe(65); // 01:05
    expect(formatLocalTime(date, MSK)).toBe('01:05');
  });
});

describe('buildDigests', () => {
  const item = (text: string, iso: string) => ({
    text,
    createdAt: new Date(iso),
  });

  it('returns nothing for an empty queue', () => {
    expect(buildDigests([], MSK)).toEqual([]);
  });

  it('lists each notification with its local time under a counted header', () => {
    const [digest] = buildDigests(
      [
        item('🔴 reports оффлайн', '2026-10-07T22:05:00Z'),
        item('🟢 CI зелёный', '2026-10-08T01:30:00Z'),
      ],
      MSK,
    );

    expect(digest).toBe(
      '🌅 Пока вы не получали уведомления (2):\n• 01:05 🔴 reports оффлайн\n• 04:30 🟢 CI зелёный',
    );
  });

  it('splits long digests on item boundaries, under the Telegram limit', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item(`n${i} ${'x'.repeat(400)}`, '2026-10-07T22:00:00Z'),
    );
    const digests = buildDigests(items, MSK);

    expect(digests.length).toBeGreaterThan(1);
    expect(digests.every((d) => d.length < 4000)).toBe(true);
    expect(digests.join('\n')).toContain('n0 ');
    expect(digests.join('\n')).toContain('n19 ');
    expect(digests[1]).toContain('продолжение (2/');
  });
});
