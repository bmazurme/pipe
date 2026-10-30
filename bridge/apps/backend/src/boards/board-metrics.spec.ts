import {
  assessBoardMetrics,
  bucketSeconds,
  METRICS_STALE_AFTER_MS,
} from './board-metrics';

const NOW = new Date('2026-10-30T12:00:00Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('assessBoardMetrics', () => {
  const ok = {
    socTempC: 52,
    throttled: 0,
    fanRpm: 4200,
    nvmeTempC: 41,
    load1: 0.5,
    memAvailPct: 75,
    diskUsedPct: 30,
  };

  it('is fine for a cool board with power and plenty of memory', () => {
    expect(assessBoardMetrics(ok, secondsAgo(60), NOW)).toEqual({
      status: 'ok',
      reasons: [],
    });
  });

  it('is bad, and says only that, when the numbers are older than ten minutes', () => {
    const result = assessBoardMetrics(
      { ...ok, socTempC: 90 },
      secondsAgo(11 * 60),
      NOW,
    );

    expect(result.status).toBe('bad');
    expect(result.reasons).toEqual([
      'Нет данных 11 мин — плата выключена, зависла или без связи с мостом',
    ]);
    expect(
      assessBoardMetrics(ok, secondsAgo(3 * 3600), NOW).reasons[0],
    ).toContain('3 ч');
    expect(METRICS_STALE_AFTER_MS).toBe(10 * 60_000);
  });

  it('allows a gap of a few missed posts', () => {
    expect(assessBoardMetrics(ok, secondsAgo(9 * 60), NOW).status).toBe('ok');
  });

  it('reads the processor temperature: 65 warns, 75 (the limit the monitor alerts on) is bad', () => {
    expect(
      assessBoardMetrics({ ...ok, socTempC: 64 }, secondsAgo(1), NOW).status,
    ).toBe('ok');
    expect(
      assessBoardMetrics({ ...ok, socTempC: 65 }, secondsAgo(1), NOW),
    ).toEqual({ status: 'warn', reasons: ['Процессор 65 °C'] });
    expect(
      assessBoardMetrics({ ...ok, socTempC: 75 }, secondsAgo(1), NOW),
    ).toEqual({ status: 'bad', reasons: ['Процессор 75 °C'] });
  });

  it('says what the firmware reports right now, bit by bit', () => {
    const result = assessBoardMetrics(
      { ...ok, throttled: 0x5 },
      secondsAgo(1),
      NOW,
    );

    expect(result.status).toBe('bad');
    expect(result.reasons).toEqual([
      'Сейчас: просадка напряжения питания',
      'Сейчас: процессор троттлится',
    ]);
    expect(
      assessBoardMetrics({ ...ok, throttled: 0x8 }, secondsAgo(1), NOW).reasons,
    ).toEqual(['Сейчас: мягкий предел температуры']);
  });

  it('judges the NVMe, memory and disk', () => {
    expect(
      assessBoardMetrics({ ...ok, nvmeTempC: 71 }, secondsAgo(1), NOW),
    ).toEqual({ status: 'warn', reasons: ['NVMe 71 °C'] });
    expect(
      assessBoardMetrics({ ...ok, nvmeTempC: 80 }, secondsAgo(1), NOW).status,
    ).toBe('bad');
    expect(
      assessBoardMetrics({ ...ok, memAvailPct: 14 }, secondsAgo(1), NOW).status,
    ).toBe('warn');
    expect(
      assessBoardMetrics({ ...ok, memAvailPct: 9 }, secondsAgo(1), NOW).status,
    ).toBe('bad');
    expect(
      assessBoardMetrics({ ...ok, diskUsedPct: 82 }, secondsAgo(1), NOW).status,
    ).toBe('warn');
    expect(
      assessBoardMetrics({ ...ok, diskUsedPct: 95 }, secondsAgo(1), NOW).status,
    ).toBe('bad');
  });

  it('warns about a stopped fan only on a warm board; a board without a fan reading says nothing', () => {
    expect(
      assessBoardMetrics({ ...ok, fanRpm: 0, socTempC: 68 }, secondsAgo(1), NOW)
        .reasons,
    ).toEqual(['Процессор 68 °C', 'Кулер стоит при высокой температуре']);
    expect(
      assessBoardMetrics({ ...ok, fanRpm: 0, socTempC: 45 }, secondsAgo(1), NOW)
        .status,
    ).toBe('ok');
    const noFan = { ...ok, fanRpm: undefined };
    expect(
      assessBoardMetrics({ ...noFan, socTempC: 68 }, secondsAgo(1), NOW)
        .reasons,
    ).toEqual(['Процессор 68 °C']);
  });

  it('says nothing for readings that are missing', () => {
    expect(assessBoardMetrics({}, secondsAgo(1), NOW)).toEqual({
      status: 'ok',
      reasons: [],
    });
  });

  it('lists the bad before the warnings', () => {
    const result = assessBoardMetrics(
      { ...ok, socTempC: 66, throttled: 1 },
      secondsAgo(1),
      NOW,
    );

    expect(result.reasons).toEqual([
      'Сейчас: просадка напряжения питания',
      'Процессор 66 °C',
    ]);
  });
});

describe('bucketSeconds', () => {
  it('draws a day in five-minute steps and a week in half-hour steps', () => {
    expect(bucketSeconds(1)).toBe(300);
    expect(bucketSeconds(24)).toBe(300);
    expect(bucketSeconds(25)).toBe(1800);
    expect(bucketSeconds(168)).toBe(1800);
  });
});
