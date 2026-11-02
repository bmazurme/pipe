// How the UPS (infra/ups, read from NUT on the board its USB cable is plugged into) is doing, judged from its own report. Pure: the
// service stores the report, this decides what is worth saying.

export type UpsStatus = 'ok' | 'warn' | 'bad';

export interface UpsData {
  host: string;
  // NUT's ups.status: "OL CHRG", "OB DISCHRG", "OB LB", … (flags separated by spaces)
  status: string;
  model?: string | null;
  chargePct: number | null;
  runtimeSec?: number | null;
  loadPct?: number | null;
  inputVolts?: number | null;
  batteryVolts?: number | null;
  nominalWatts?: number | null;
  // NUT's ups.test.result, e.g. "No test initiated", "Done and passed"
  testResult?: string | null;
}

export interface UpsAssessment {
  status: UpsStatus;
  reasons: string[];
  // true while the UPS carries the load from its battery
  onBattery: boolean;
}

const MINUTE = 60_000;
// The agent reports every minute: five missed ones is a board, NUT or the cable that stopped, not a slow one.
export const UPS_STALE_AFTER_MS = 5 * MINUTE;
export const CHARGE_WARN_PCT = 50;
export const LOAD_WARN_PCT = 80;
export const RUNTIME_WARN_SEC = 10 * 60;

const flags = (status: string) =>
  new Set(status.trim().split(/\s+/).filter(Boolean));

export function assessUps(
  data: UpsData,
  reportedAt: Date,
  now: Date = new Date(),
): UpsAssessment {
  const sinceReport = now.getTime() - reportedAt.getTime();

  // Nothing else in the report can be trusted once it is stale.
  if (sinceReport > UPS_STALE_AFTER_MS) {
    const hours = Math.floor(sinceReport / (60 * MINUTE));

    return {
      status: 'bad',
      onBattery: false,
      reasons: [
        `ИБП не присылает данные ${hours >= 1 ? `${hours} ч` : `${Math.round(sinceReport / MINUTE)} мин`} — плата, NUT или USB-кабель недоступны`,
      ],
    };
  }

  const bad: string[] = [];
  const warn: string[] = [];
  const state = flags(data.status);
  const onBattery = state.has('OB');

  if (onBattery) {
    const left =
      data.runtimeSec != null
        ? `, примерно ${Math.round(data.runtimeSec / 60)} мин до отключения`
        : '';

    bad.push(`Питание пропало, ИБП работает от батареи${left}`);
  }
  if (state.has('LB')) bad.push('Батарея почти разряжена');
  if (state.has('FSD')) bad.push('Идёт выключение плат по команде ИБП');
  if (state.has('RB')) bad.push('Батарею пора заменить');
  if (state.has('OVER')) warn.push('ИБП перегружен');
  if (state.has('BYPASS')) warn.push('ИБП в режиме обхода');
  if (!state.has('OL') && !onBattery) warn.push(`Статус ИБП: ${data.status}`);

  if (
    !onBattery &&
    data.chargePct != null &&
    data.chargePct < CHARGE_WARN_PCT
  ) {
    warn.push(`Заряд батареи ${data.chargePct} %`);
  }
  if (
    !onBattery &&
    data.runtimeSec != null &&
    data.runtimeSec < RUNTIME_WARN_SEC
  ) {
    warn.push(
      `Автономность всего ${Math.round(data.runtimeSec / 60)} мин при текущей нагрузке`,
    );
  }
  if ((data.loadPct ?? 0) >= LOAD_WARN_PCT) {
    warn.push(`Нагрузка ${data.loadPct} %`);
  }
  if (data.testResult && /fail|error|bad/i.test(data.testResult)) {
    warn.push(`Тест батареи: ${data.testResult}`);
  }

  return {
    status: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
    onBattery,
  };
}
