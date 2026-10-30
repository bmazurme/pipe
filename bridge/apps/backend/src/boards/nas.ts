// How the NAS (infra/nas) is doing, judged from its own report. Pure: the service stores the report, this decides what is worth saying.

export type NasStatus = 'ok' | 'warn' | 'bad';

export interface NasDisk {
  name: string;
  model?: string | null;
  healthPassed: boolean;
  reallocated?: number | null;
  powerOnHours?: number | null;
  tempC?: number | null;
  pending?: number | null;
  uncorrectable?: number | null;
}

export interface NasData {
  host: string;
  uptimeSec: number;
  backup: {
    createdAt?: string | null;
    latest?: string | null;
    snapshots: number;
    bytes: number;
  };
  raid: { summary: string; degraded: boolean; syncing: boolean };
  volume: { totalBytes: number; usedBytes: number };
  disks: NasDisk[];
}

export interface NasAssessment {
  status: NasStatus;
  reasons: string[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// The container reports every 10 minutes: three missed ones is a NAS that is off or unreachable, not a slow one.
export const NAS_STALE_AFTER_MS = 30 * MINUTE;
// The daily pull runs at 03:50; a copy older than this missed one (the container's own health check uses the same 26 hours).
export const BACKUP_STALE_HOURS = 26;
export const BACKUP_VERY_STALE_HOURS = 50;
export const VOLUME_WARN_PCT = 85;
export const DISK_WARM_C = 50;

export function assessNas(
  data: NasData,
  reportedAt: Date,
  now: Date = new Date(),
): NasAssessment {
  const bad: string[] = [];
  const warn: string[] = [];
  const sinceReport = now.getTime() - reportedAt.getTime();

  // Nothing else in the report can be trusted once it is stale.
  if (sinceReport > NAS_STALE_AFTER_MS) {
    const hours = Math.floor(sinceReport / HOUR);

    return {
      status: 'bad',
      reasons: [
        `NAS не присылает отчёт ${hours >= 1 ? `${hours} ч` : `${Math.round(sinceReport / MINUTE)} мин`} — выключен или недоступен`,
      ],
    };
  }

  if (data.raid.degraded) bad.push(`RAID деградировал (${data.raid.summary})`);
  else if (data.raid.syncing) warn.push('RAID пересобирается');

  for (const disk of data.disks) {
    if (!disk.healthPassed) bad.push(`Диск ${disk.name}: SMART не пройден`);
    if ((disk.uncorrectable ?? 0) > 0)
      bad.push(
        `Диск ${disk.name}: неисправимых секторов ${disk.uncorrectable}`,
      );
    if ((disk.pending ?? 0) > 0)
      warn.push(`Диск ${disk.name}: секторов в ожидании ${disk.pending}`);
    if ((disk.reallocated ?? 0) > 0)
      warn.push(
        `Диск ${disk.name}: переназначено секторов ${disk.reallocated}`,
      );
    if ((disk.tempC ?? 0) >= DISK_WARM_C)
      warn.push(`Диск ${disk.name}: ${disk.tempC} °C`);
  }

  if (data.backup.createdAt) {
    const ageH =
      (now.getTime() - new Date(data.backup.createdAt).getTime()) / HOUR;

    if (ageH > BACKUP_VERY_STALE_HOURS)
      bad.push(`Копия бэкапа старше ${Math.floor(ageH)} ч`);
    else if (ageH > BACKUP_STALE_HOURS)
      warn.push(`Копия бэкапа устарела: ${Math.floor(ageH)} ч`);
  } else {
    warn.push('Копия бэкапа ещё не получена');
  }

  if (data.volume.totalBytes > 0) {
    const pct = Math.round(
      (data.volume.usedBytes / data.volume.totalBytes) * 100,
    );

    if (pct >= VOLUME_WARN_PCT) warn.push(`Том заполнен на ${pct} %`);
  }

  return {
    status: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
  };
}
