// The vital signs of a board (infra/boardagent `collect_metrics`), and what to say about them. Pure: the service stores and aggregates, this judges.

export interface BoardMetricsData {
  socTempC?: number;
  // The low four bits of `vcgencmd get_throttled`, "right now": 1 under-voltage, 2 frequency capped, 4 throttled, 8 soft temperature limit.
  throttled?: number;
  fanRpm?: number;
  nvmeTempC?: number;
  load1?: number;
  memAvailPct?: number;
  memTotalMb?: number;
  diskUsedPct?: number;
  uptimeSec?: number;
}

export type BoardMetricsStatus = 'ok' | 'warn' | 'bad';

export interface BoardMetricsAssessment {
  status: BoardMetricsStatus;
  reasons: string[];
}

const MINUTE = 60_000;
// The agent posts every 2 minutes; five missed ones is a board that is off, hung or cut off from bridge.
export const METRICS_STALE_AFTER_MS = 10 * MINUTE;
// The same limit infra/monitor/resource-check.sh alerts on.
export const SOC_BAD_C = 75;
export const SOC_WARN_C = 65;
export const NVME_BAD_C = 80;
export const NVME_WARN_C = 70;
export const MEM_BAD_PCT = 10;
export const MEM_WARN_PCT = 15;
export const DISK_WARN_PCT = 80;
export const DISK_BAD_PCT = 90;

const THROTTLE_REASONS: Array<[number, string]> = [
  [0x1, 'просадка напряжения питания'],
  [0x2, 'частота процессора ограничена'],
  [0x4, 'процессор троттлится'],
  [0x8, 'мягкий предел температуры'],
];

export function assessBoardMetrics(
  data: BoardMetricsData,
  at: Date,
  now: Date = new Date(),
): BoardMetricsAssessment {
  const sinceMs = now.getTime() - at.getTime();

  // Nothing else can be trusted once the numbers are old.
  if (sinceMs > METRICS_STALE_AFTER_MS) {
    const minutes = Math.round(sinceMs / MINUTE);

    return {
      status: 'bad',
      reasons: [
        `Нет данных ${minutes >= 120 ? `${Math.floor(minutes / 60)} ч` : `${minutes} мин`} — плата выключена, зависла или без связи с мостом`,
      ],
    };
  }

  const bad: string[] = [];
  const warn: string[] = [];

  for (const [bit, text] of THROTTLE_REASONS) {
    if (((data.throttled ?? 0) & bit) !== 0) bad.push(`Сейчас: ${text}`);
  }

  if (data.socTempC !== undefined) {
    if (data.socTempC >= SOC_BAD_C) bad.push(`Процессор ${data.socTempC} °C`);
    else if (data.socTempC >= SOC_WARN_C)
      warn.push(`Процессор ${data.socTempC} °C`);
  }

  if (data.nvmeTempC !== undefined) {
    if (data.nvmeTempC >= NVME_BAD_C) bad.push(`NVMe ${data.nvmeTempC} °C`);
    else if (data.nvmeTempC >= NVME_WARN_C)
      warn.push(`NVMe ${data.nvmeTempC} °C`);
  }

  // A stopped fan on a board that is warming up is the early sign; a fan that is simply not there reports nothing and says nothing.
  if (data.fanRpm === 0 && (data.socTempC ?? 0) >= SOC_WARN_C) {
    warn.push('Кулер стоит при высокой температуре');
  }

  if (data.memAvailPct !== undefined) {
    if (data.memAvailPct < MEM_BAD_PCT)
      bad.push(`Свободной памяти ${data.memAvailPct} %`);
    else if (data.memAvailPct < MEM_WARN_PCT)
      warn.push(`Свободной памяти ${data.memAvailPct} %`);
  }

  if (data.diskUsedPct !== undefined) {
    if (data.diskUsedPct >= DISK_BAD_PCT)
      bad.push(`Диск заполнен на ${data.diskUsedPct} %`);
    else if (data.diskUsedPct >= DISK_WARN_PCT)
      warn.push(`Диск заполнен на ${data.diskUsedPct} %`);
  }

  return {
    status: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
  };
}

// The history for the graph: one point per bucket (the average inside it; null where the bucket had no reading), the time of the bucket's start.
export interface SeriesPoint {
  t: string;
  soc: number | null;
  nvme: number | null;
}

// How coarse the graph is for a window: five minutes for a day or less, half an hour for up to a week.
export function bucketSeconds(hours: number): number {
  return hours <= 24 ? 300 : 1800;
}
