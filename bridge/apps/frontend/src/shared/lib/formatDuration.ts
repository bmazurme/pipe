/** "45 с", "3 мин 05 с", "1 ч 02 мин" — a compact elapsed time for job rows. */
export function formatDuration(totalMs: number): string {
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    return '—';
  }

  const seconds = Math.floor(totalMs / 1000);

  if (seconds < 60) return `${seconds} с`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes} мин ${String(seconds % 60).padStart(2, '0')} с`;

  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, '0')} мин`;
}

/** Elapsed time of a job: start → finish, or start → now while it is still running. */
export function jobDuration(
  job: { startedAt: string | null; finishedAt: string | null },
  now: number = Date.now(),
): string | null {
  if (!job.startedAt) return null;

  const start = new Date(job.startedAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now;

  return Number.isNaN(start) || Number.isNaN(end) ? null : formatDuration(end - start);
}
