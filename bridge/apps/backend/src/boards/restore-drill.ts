// R7: how the monthly restore drill (infra/backup/restore-drill.sh) is going, judged from what it reported. Pure: the service stores the
// reports, this decides what is worth saying. A backup that was never restored is a hope, and one that was restored once a year is the
// same hope with a date on it — so the verdict is mostly about how long ago the last SUCCESSFUL drill was.

export type DrillStatus = 'ok' | 'warn' | 'bad';

export interface DrillData {
  host: string;
  ok: boolean;
  // The backup that was restored (meta.env CREATED, a bare UTC stamp such as 20261112T030000Z, or an ISO date).
  backupCreatedAt?: string | null;
  // Wall-clock of the restore itself (decrypt + load into a fresh Postgres) — the part of RTO that is the database.
  restoreSeconds?: number | null;
  // Tables that came back with at least one row, and the exact total of rows in them.
  tables?: number | null;
  rows?: number | null;
  // Exact row counts of the key tables.
  counts?: Record<string, number> | null;
  lastMigration?: string | null;
  error?: string | null;
}

export interface DrillRow {
  ranAt: Date;
  data: DrillData;
}

export interface DrillAssessment {
  status: DrillStatus;
  reasons: string[];
  lastAt: string | null;
  lastOkAt: string | null;
  // How far behind the live database the restored copy was when it was restored (RPO as measured), and how long the restore took (RTO's DB part).
  backupAgeHours: number | null;
  restoreSeconds: number | null;
  nextDueAt: string | null;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
// The drill runs monthly (a weekly trigger that does it when 30 days have passed). A month without one is late; 35 days is the alert.
export const DRILL_DUE_DAYS = 30;
export const DRILL_ALERT_DAYS = 35;
// The backup is daily: a restored copy older than this was already stale before it was restored.
export const DRILL_BACKUP_STALE_HOURS = 36;
// The database part of the recovery time. The target is minutes; half an hour means the dump has outgrown the board or the box it is restored on.
export const DRILL_SLOW_SECONDS = 30 * 60;
// A restored copy with less than this share of the rows the previous successful drill saw lost data between two backups.
export const DRILL_ROWS_DROP_RATIO = 0.5;

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export function parseBackupDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const match = STAMP.exec(value.trim());
  const date = match
    ? new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        ),
      )
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function days(ms: number): number {
  return Math.floor(ms / DAY);
}

// `rows` newest first.
export function assessDrills(
  rows: DrillRow[],
  now: Date = new Date(),
): DrillAssessment {
  const newest = rows[0];
  const lastOk = rows.find((row) => row.data.ok);
  const previousOk = lastOk
    ? rows.slice(rows.indexOf(lastOk) + 1).find((row) => row.data.ok)
    : undefined;

  if (!newest) {
    return {
      status: 'warn',
      reasons: ['Учение восстановления ещё ни разу не проводилось'],
      lastAt: null,
      lastOkAt: null,
      backupAgeHours: null,
      restoreSeconds: null,
      nextDueAt: null,
    };
  }

  const bad: string[] = [];
  const warn: string[] = [];

  if (!newest.data.ok) {
    bad.push(
      `Последнее учение (${newest.ranAt.toISOString().slice(0, 10)}) провалилось: ${newest.data.error || 'причина не названа'}`,
    );
  }

  if (!lastOk) {
    bad.push('Ни одно учение не закончилось успешно');
  } else {
    const since = now.getTime() - lastOk.ranAt.getTime();

    if (since > DRILL_ALERT_DAYS * DAY) {
      bad.push(`Восстановление не проверялось ${days(since)} дн`);
    } else if (since > DRILL_DUE_DAYS * DAY) {
      warn.push(
        `Учение пора повторить: прошло ${days(since)} дн (раз в ${DRILL_DUE_DAYS})`,
      );
    }
  }

  const backupAt = lastOk ? parseBackupDate(lastOk.data.backupCreatedAt) : null;
  const backupAgeHours =
    lastOk && backupAt
      ? Math.max(
          0,
          Math.round((lastOk.ranAt.getTime() - backupAt.getTime()) / HOUR),
        )
      : null;

  if (backupAgeHours !== null && backupAgeHours > DRILL_BACKUP_STALE_HOURS) {
    warn.push(
      `Восстанавливали копию возрастом ${backupAgeHours} ч — бэкап в тот момент уже не был свежим`,
    );
  }

  const restoreSeconds = lastOk?.data.restoreSeconds ?? null;

  if (restoreSeconds !== null && restoreSeconds > DRILL_SLOW_SECONDS) {
    warn.push(
      `Восстановление заняло ${Math.round(restoreSeconds / 60)} мин — больше ${DRILL_SLOW_SECONDS / 60}`,
    );
  }

  if (lastOk && previousOk) {
    const before = previousOk.data.counts ?? {};
    const after = lastOk.data.counts ?? {};

    for (const [table, count] of Object.entries(before)) {
      if (count > 0 && (after[table] ?? 0) === 0) {
        bad.push(
          `Таблица ${table}: в прошлом учении ${count} строк, сейчас пусто`,
        );
      }
    }

    const prevRows = previousOk.data.rows ?? 0;
    const nowRows = lastOk.data.rows ?? 0;

    if (prevRows > 0 && nowRows < prevRows * DRILL_ROWS_DROP_RATIO) {
      warn.push(
        `Строк в восстановленной копии ${nowRows}, в прошлый раз ${prevRows}`,
      );
    }
  }

  return {
    status: bad.length > 0 ? 'bad' : warn.length > 0 ? 'warn' : 'ok',
    reasons: [...bad, ...warn],
    lastAt: newest.ranAt.toISOString(),
    lastOkAt: lastOk ? lastOk.ranAt.toISOString() : null,
    backupAgeHours,
    restoreSeconds,
    nextDueAt: lastOk
      ? new Date(lastOk.ranAt.getTime() + DRILL_DUE_DAYS * DAY).toISOString()
      : null,
  };
}

// The Telegram text: only when the verdict is `bad` — a late drill that is merely «пора» is on the Dashboard, not in the owner's pocket.
export function drillAlert(assessment: DrillAssessment): string | null {
  if (assessment.status !== 'bad') return null;

  return `⚠️ Учение восстановления БД: ${assessment.reasons[0]}${assessment.reasons.length > 1 ? ` (и ещё ${assessment.reasons.length - 1})` : ''}. Запуск и разбор — infra/backup/README.md.`;
}
