import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { Job } from './entities/job.entity';

// Failures that say nothing about the task itself — the worker process went away.
// The first is what the worker reports on SIGTERM (worker/src/index.ts), the second
// what the sweep writes for a job whose worker never came back.
export const SHUTDOWN_FAILURE_MESSAGE =
  'Worker was stopped (SIGTERM) before the job finished — start it again';
export const LOST_MESSAGE =
  'Worker was restarted or lost while this job was running — the run did not finish';

export const INFRA_FAILURE_MESSAGES: readonly string[] = [
  SHUTDOWN_FAILURE_MESSAGE,
  LOST_MESSAGE,
];

// The one place that decides whether a failed job was lost to infrastructure.
export function isInfraFailure(
  job: Pick<Job, 'failureKind' | 'errorMessage'>,
): boolean {
  if (job.failureKind) return true;

  // Legacy fallback for workers that do not send failureKind yet.
  // TODO: remove once every worker is upgraded.
  return (
    job.errorMessage !== null &&
    INFRA_FAILURE_MESSAGES.includes(job.errorMessage)
  );
}

// The same rule as `isInfraFailure`, as a TypeORM `where` (one branch per way to qualify).
export function infraFailureWhere(
  base: FindOptionsWhere<Job>,
): FindOptionsWhere<Job>[] {
  return [
    { ...base, failureKind: Not(IsNull()) },
    // Legacy fallback for workers that do not send failureKind yet.
    // TODO: remove once every worker is upgraded.
    { ...base, errorMessage: In(INFRA_FAILURE_MESSAGES) },
  ];
}
