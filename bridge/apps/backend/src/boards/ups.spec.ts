import { assessUps, UpsData } from './ups';

const NOW = new Date('2026-11-02T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const healthy = (over: Partial<UpsData> = {}): UpsData => ({
  host: 'ubuntu-blue',
  status: 'OL CHRG',
  model: 'UT1050EG',
  chargePct: 100,
  runtimeSec: 4500,
  loadPct: 9,
  inputVolts: 231,
  batteryVolts: 28.2,
  nominalWatts: 630,
  testResult: 'No test initiated',
  ...over,
});

describe('assessUps', () => {
  it('is ok on the mains, charged, lightly loaded', () => {
    expect(assessUps(healthy(), minutesAgo(1), NOW)).toEqual({
      status: 'ok',
      reasons: [],
      onBattery: false,
    });
  });

  it('says the agent went quiet, and trusts nothing else, once the report is stale', () => {
    const verdict = assessUps(
      healthy({ status: 'OB DISCHRG' }),
      minutesAgo(8),
      NOW,
    );

    expect(verdict.status).toBe('bad');
    expect(verdict.onBattery).toBe(false);
    expect(verdict.reasons).toEqual([
      'ИБП не присылает данные 8 мин — плата, NUT или USB-кабель недоступны',
    ]);
    expect(
      assessUps(healthy(), new Date(NOW.getTime() - 3 * 3_600_000), NOW)
        .reasons[0],
    ).toContain('3 ч');
  });

  it('is bad on the battery, with the minutes left', () => {
    const verdict = assessUps(
      healthy({ status: 'OB DISCHRG', runtimeSec: 1800, chargePct: 70 }),
      minutesAgo(1),
      NOW,
    );

    expect(verdict.status).toBe('bad');
    expect(verdict.onBattery).toBe(true);
    expect(verdict.reasons).toEqual([
      'Питание пропало, ИБП работает от батареи, примерно 30 мин до отключения',
    ]);
  });

  it('is bad on a low battery, and during a forced shutdown', () => {
    const verdict = assessUps(
      healthy({ status: 'OB LB FSD', runtimeSec: null }),
      minutesAgo(1),
      NOW,
    );

    expect(verdict.status).toBe('bad');
    expect(verdict.reasons).toEqual([
      'Питание пропало, ИБП работает от батареи',
      'Батарея почти разряжена',
      'Идёт выключение плат по команде ИБП',
    ]);
  });

  it('warns about a battery to replace, an overload and a bypass', () => {
    const verdict = assessUps(
      healthy({ status: 'OL RB OVER BYPASS' }),
      minutesAgo(1),
      NOW,
    );

    expect(verdict.status).toBe('bad');
    expect(verdict.reasons).toEqual([
      'Батарею пора заменить',
      'ИБП перегружен',
      'ИБП в режиме обхода',
    ]);
  });

  it('warns about a low charge, a short runtime, a high load and a failed test — on the mains only', () => {
    const verdict = assessUps(
      healthy({
        chargePct: 40,
        runtimeSec: 300,
        loadPct: 85,
        testResult: 'Done and failed',
      }),
      minutesAgo(1),
      NOW,
    );

    expect(verdict.status).toBe('warn');
    expect(verdict.reasons).toEqual([
      'Заряд батареи 40 %',
      'Автономность всего 5 мин при текущей нагрузке',
      'Нагрузка 85 %',
      'Тест батареи: Done and failed',
    ]);
  });

  it('does not warn about the charge while on the battery (the battery alarm already says it)', () => {
    const verdict = assessUps(
      healthy({ status: 'OB DISCHRG', chargePct: 30, runtimeSec: 300 }),
      minutesAgo(1),
      NOW,
    );

    expect(verdict.reasons).toHaveLength(1);
  });

  it('warns about a status that is neither on the mains nor on the battery', () => {
    expect(
      assessUps(healthy({ status: 'TRIM' }), minutesAgo(1), NOW).reasons,
    ).toEqual(['Статус ИБП: TRIM']);
  });

  it('copes with readings the UPS did not give', () => {
    expect(
      assessUps(
        healthy({
          chargePct: null,
          runtimeSec: null,
          loadPct: null,
          testResult: null,
        }),
        minutesAgo(1),
        NOW,
      ).status,
    ).toBe('ok');
  });
});
