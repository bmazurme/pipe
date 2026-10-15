import type { AppLogService } from '../logs/app-log.service';
import { Job, JobStatus } from './entities/job.entity';

// One row per finished job — the raw material for success rate, durations
// and the most common failure reasons. Never awaited for its result.
export function logJobOutcome(
  appLogs: AppLogService | undefined,
  job: Job,
): void {
  const failed = job.status === JobStatus.Failed;
  const durationMs =
    job.startedAt && job.finishedAt
      ? job.finishedAt.getTime() - job.startedAt.getTime()
      : undefined;

  void appLogs?.record({
    level: failed ? 'error' : 'info',
    source: 'job',
    event: failed ? 'job.failed' : 'job.succeeded',
    message: failed
      ? `Job ${job.id} failed: ${job.errorMessage ?? 'no error message'}`
      : `Job ${job.id} succeeded`,
    meta: { jobId: job.id, model: job.model, durationMs },
  });
}
