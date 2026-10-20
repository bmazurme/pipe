import { describe, expect, it } from 'vitest';

import { referenceZone, runMinuteOfDay, sortSchedulesByRunTime } from './scheduleOrder';

const schedule = (id: number, name: string, hour: number, minute: number, timezone = 'Europe/Moscow') => ({ id, name, hour, minute, timezone });
// A winter day and a summer one: zones differ in whether they observe daylight saving time.
const WINTER = new Date('2026-01-15T12:00:00Z');
const SUMMER = new Date('2026-07-15T12:00:00Z');

describe('referenceZone', () => {
  it('is the zone most schedules are in, and on a tie that of the oldest schedule', () => {
    expect(referenceZone([schedule(1, 'a', 1, 0, 'UTC'), schedule(2, 'b', 1, 0), schedule(3, 'c', 1, 0)])).toBe('Europe/Moscow');
    expect(referenceZone([schedule(5, 'a', 1, 0, 'UTC'), schedule(2, 'b', 1, 0, 'Europe/Moscow')])).toBe('Europe/Moscow');
    expect(referenceZone([])).toBe('UTC');
  });
});

describe('runMinuteOfDay', () => {
  it('is plain hour:minute in the reference zone itself', () => {
    expect(runMinuteOfDay(schedule(1, 'a', 2, 5), 'Europe/Moscow', WINTER)).toBe(2 * 60 + 5);
  });

  it('moves a time from another zone onto the reference zone\'s clock, across midnight too', () => {
    // 06:00 UTC is 09:00 in Moscow (UTC+3); 22:00 UTC is 01:00 the next day there
    expect(runMinuteOfDay(schedule(1, 'a', 6, 0, 'UTC'), 'Europe/Moscow', WINTER)).toBe(9 * 60);
    expect(runMinuteOfDay(schedule(1, 'a', 22, 0, 'UTC'), 'Europe/Moscow', WINTER)).toBe(60);
  });

  it('follows daylight saving time: the same Berlin wall-clock time is a different Moscow time in winter and summer', () => {
    const berlin = schedule(1, 'a', 9, 0, 'Europe/Berlin');

    expect(runMinuteOfDay(berlin, 'Europe/Moscow', WINTER)).toBe(11 * 60); // UTC+1 → +3
    expect(runMinuteOfDay(berlin, 'Europe/Moscow', SUMMER)).toBe(10 * 60); // UTC+2 → +3
  });

  it('copes with fractional offsets and an unknown zone', () => {
    expect(runMinuteOfDay(schedule(1, 'a', 12, 0, 'Asia/Kolkata'), 'UTC', WINTER)).toBe(6 * 60 + 30); // UTC+5:30
    expect(runMinuteOfDay(schedule(1, 'a', 12, 0, 'Not/AZone'), 'UTC', WINTER)).toBe(12 * 60);
  });
});

describe('sortSchedulesByRunTime', () => {
  it('reads like the times shown when they are all in one zone: 00:05, 02:00, 06:15, 22:30', () => {
    const sorted = sortSchedulesByRunTime([schedule(1, 'ночь', 2, 0), schedule(2, 'утро', 6, 15), schedule(3, 'вечер', 22, 30), schedule(4, 'полночь', 0, 5)], WINTER);

    expect(sorted.map((item) => item.name)).toEqual(['полночь', 'ночь', 'утро', 'вечер']);
  });

  it('orders schedules of different zones by when they really run, on the majority zone\'s clock', () => {
    const sorted = sortSchedulesByRunTime(
      [schedule(1, 'Москва 10:00', 10, 0, 'Europe/Moscow'), schedule(2, 'UTC 06:00', 6, 0, 'UTC'), schedule(3, 'Новосибирск 12:00', 12, 0, 'Asia/Novosibirsk')],
      WINTER,
    );

    // on the Moscow clock: 12:00 Novosibirsk (UTC+7) is 08:00, 06:00 UTC is 09:00, then 10:00
    expect(sorted.map((item) => item.name)).toEqual(['Новосибирск 12:00', 'UTC 06:00', 'Москва 10:00']);
  });

  it('breaks a tie by name, then by id, and does not change what it is given', () => {
    const input = [schedule(3, 'б', 3, 0), schedule(1, 'б', 3, 0), schedule(2, 'а', 3, 0)];
    const copy = [...input];

    expect(sortSchedulesByRunTime(input, WINTER).map((item) => item.id)).toEqual([2, 1, 3]);
    expect(input).toEqual(copy);
  });

  it('is fine with nothing to sort', () => {
    expect(sortSchedulesByRunTime([], WINTER)).toEqual([]);
  });
});
