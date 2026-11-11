// How the cloud VM (infra/cloudagent) and the services on it are doing, judged from its own report. Pure: the service stores the report,
// this decides what is worth saying. The VM is the first layer (CLOUD-FIRST-PLAN.md): its own death must be loud, so "no report" is a problem.

export type CloudStatus = 'ok' | 'warn' | 'bad';

export interface CloudService {
  name: string;
  /** Replicas wanted / running (a Swarm service) or 1/0-1 for a plain container. */
  desired: number;
  running: number;
  /** Docker's own health check, when the container has one. */
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none' | null;
  restarts24h?: number | null;
  memMb?: number | null;
  /** A critical service that is down is a problem; a non-critical one is only a remark. */
  critical: boolean;
}

export interface CloudProbe {
  /** What was asked, e.g. "https://bridge.ntlstl.dev/api/v1/health". */
  name: string;
  ok: boolean;
  httpCode?: number | null;
  ms?: number | null;
  critical: boolean;
}

export interface CloudBackup {
  name: string;
  ageHours: number | null;
}

export interface CloudCert {
  name: string;
  days: number;
}

export interface CloudData {
  host: string;
  uptimeSec: number;
  cpus: number;
  load5: number | null;
  memory: {
    totalMb: number;
    availableMb: number;
    swapTotalMb: number;
    swapUsedMb: number;
  };
  disk: { totalBytes: number; usedBytes: number };
  services: CloudService[];
  probes: CloudProbe[];
  /** Which layer answers on this VM's side and under which epoch (docs: CLOUD-FIRST-PLAN.md §5.3); absent until the leader mechanism exists. */
  leader?: { site: string; epoch: number } | null;
  /** The standby's replication as the primary sees it; absent when no replica is expected yet. */
  replication?: { connected: boolean; lagSec: number | null } | null;
  backups?: CloudBackup[];
  certs?: CloudCert[];
  /** Ports found open to the whole internet that must not be (a self-check: 5432 and the like). */
  exposedPorts?: number[];
  /** Commit the stack on the VM runs, for the drift check against the other layer. */
  version?: string | null;
}

export interface CloudAssessment {
  status: CloudStatus;
  reasons: string[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// The agent reports every minute: five missed ones is a VM that is off, cut off or whose agent died — at the first layer that is a problem.
export const CLOUD_STALE_AFTER_MS = 5 * MINUTE;
// A VM younger than this was (re)booted just now; worth a remark, as on 2026-11-10.
export const REBOOT_NOTICE_SEC = 10 * 60;
export const MEM_BAD_MB = 250;
export const MEM_BAD_PCT = 15;
export const MEM_WARN_PCT = 25;
export const SWAP_WARN_PCT = 50;
export const DISK_WARN_PCT = 80;
export const DISK_BAD_PCT = 90;
export const LOAD_WARN_PER_CORE = 1.5;
export const LOAD_BAD_PER_CORE = 3;
export const RESTARTS_WARN = 3;
// The target RPO is 15 minutes (DISTRIBUTED-PLAN.md §6): a lag near it is a problem, a minute is a remark.
export const REPLICA_LAG_WARN_SEC = 60;
export const REPLICA_LAG_BAD_SEC = 10 * 60;
export const BACKUP_STALE_HOURS = 26;
export const BACKUP_VERY_STALE_HOURS = 50;
export const CERT_WARN_DAYS = 14;
export const CERT_BAD_DAYS = 5;

const ago = (ms: number) => {
  const hours = Math.floor(ms / HOUR);

  return hours >= 1
    ? `${hours} ч`
    : `${Math.max(1, Math.round(ms / MINUTE))} мин`;
};

export function assessCloud(
  data: CloudData,
  reportedAt: Date,
  now: Date = new Date(),
): CloudAssessment {
  const bad: string[] = [];
  const warn: string[] = [];
  const sinceReport = now.getTime() - reportedAt.getTime();

  // Nothing else in the report can be trusted once it is stale.
  if (sinceReport > CLOUD_STALE_AFTER_MS) {
    return {
      status: 'bad',
      reasons: [
        `VM не присылает отчёт ${ago(sinceReport)} — выключена, недоступна или остановлен агент`,
      ],
    };
  }

  if (data.uptimeSec < REBOOT_NOTICE_SEC) {
    warn.push(
      `VM перезагружалась ${Math.max(1, Math.round(data.uptimeSec / 60))} мин назад`,
    );
  }

  const mem = data.memory;
  if (mem.totalMb > 0) {
    const pct = Math.round((mem.availableMb / mem.totalMb) * 100);

    if (mem.availableMb < MEM_BAD_MB || pct < MEM_BAD_PCT)
      bad.push(`Память на исходе: доступно ${mem.availableMb} МБ (${pct} %)`);
    else if (pct < MEM_WARN_PCT)
      warn.push(`Мало памяти: доступно ${mem.availableMb} МБ (${pct} %)`);
  }
  if (mem.swapTotalMb === 0) {
    warn.push('Swap не настроен — при нехватке памяти процессы убивает ядро');
  } else {
    const swapPct = Math.round((mem.swapUsedMb / mem.swapTotalMb) * 100);

    if (swapPct > SWAP_WARN_PCT) warn.push(`Swap занят на ${swapPct} %`);
  }

  if (data.disk.totalBytes > 0) {
    const pct = Math.round((data.disk.usedBytes / data.disk.totalBytes) * 100);

    if (pct >= DISK_BAD_PCT) bad.push(`Диск заполнен на ${pct} %`);
    else if (pct >= DISK_WARN_PCT) warn.push(`Диск заполнен на ${pct} %`);
  }

  if (data.load5 != null && data.cpus > 0) {
    const perCore = data.load5 / data.cpus;

    if (perCore >= LOAD_BAD_PER_CORE)
      bad.push(`Нагрузка ${data.load5.toFixed(1)} на ${data.cpus} ядр.`);
    else if (perCore >= LOAD_WARN_PER_CORE)
      warn.push(
        `Высокая нагрузка ${data.load5.toFixed(1)} на ${data.cpus} ядр.`,
      );
  }

  for (const service of data.services) {
    // A service scaled to zero on purpose says nothing.
    if (service.desired === 0) continue;

    const target = service.critical ? bad : warn;
    if (service.running < service.desired) {
      target.push(
        `Сервис ${service.name}: запущено ${service.running} из ${service.desired}`,
      );
    } else if (service.health === 'unhealthy') {
      target.push(`Сервис ${service.name}: health check не проходит`);
    }
    if ((service.restarts24h ?? 0) >= RESTARTS_WARN) {
      warn.push(
        `Сервис ${service.name}: ${service.restarts24h} перезапусков за сутки`,
      );
    }
  }

  for (const probe of data.probes) {
    if (probe.ok) continue;

    (probe.critical ? bad : warn).push(
      `Не отвечает ${probe.name}${probe.httpCode ? ` (код ${probe.httpCode})` : ''}`,
    );
  }

  if (data.replication) {
    if (!data.replication.connected) {
      bad.push('Реплика Postgres не подключена — резервный слой отстаёт');
    } else if (data.replication.lagSec != null) {
      const lag = data.replication.lagSec;

      if (lag >= REPLICA_LAG_BAD_SEC)
        bad.push(
          `Реплика отстаёт на ${Math.round(lag / 60)} мин (допустимая потеря — 15 мин)`,
        );
      else if (lag >= REPLICA_LAG_WARN_SEC)
        warn.push(`Реплика отстаёт на ${Math.round(lag)} с`);
    }
  }

  for (const backup of data.backups ?? []) {
    if (backup.ageHours == null) {
      warn.push(`Бэкап ${backup.name}: копии ещё нет`);
    } else if (backup.ageHours > BACKUP_VERY_STALE_HOURS) {
      bad.push(`Бэкап ${backup.name} старше ${Math.floor(backup.ageHours)} ч`);
    } else if (backup.ageHours > BACKUP_STALE_HOURS) {
      warn.push(
        `Бэкап ${backup.name} устарел: ${Math.floor(backup.ageHours)} ч`,
      );
    }
  }

  for (const cert of data.certs ?? []) {
    if (cert.days < CERT_BAD_DAYS)
      bad.push(
        `Сертификат ${cert.name}: осталось ${Math.max(0, cert.days)} дн.`,
      );
    else if (cert.days < CERT_WARN_DAYS)
      warn.push(`Сертификат ${cert.name}: осталось ${cert.days} дн.`);
  }

  if (data.exposedPorts?.length) {
    bad.push(
      `Порт ${data.exposedPorts.join(', ')} открыт в интернет — закрыть (только 127.0.0.1 или WireGuard)`,
    );
  }

  return {
    status: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
  };
}
