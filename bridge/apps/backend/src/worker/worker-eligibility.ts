import type { WorkerCapability } from './capabilities';
import type { JobModel } from './entities/job.entity';
import type { Worker } from './entities/worker.entity';

// The one place that says which managed worker may take a job: switched on, model allowed by `models` (null = any),
// the required capability present. The pin itself is checked by the caller (create/retry) or in SQL (claim).
export type WorkerEligibilityTarget = Pick<
  Worker,
  'name' | 'enabled' | 'models' | 'capabilities'
>;

export function whyWorkerCannotRun(
  worker: WorkerEligibilityTarget,
  job: {
    model: JobModel;
    requiredCapability?: WorkerCapability | null;
  },
): string | null {
  if (!worker.enabled) {
    return `Worker "${worker.name}" is paused`;
  }
  if (worker.models !== null && !worker.models.includes(job.model)) {
    return `Worker "${worker.name}" is not set up to run ${job.model}`;
  }
  if (
    job.requiredCapability != null &&
    !(worker.capabilities ?? []).includes(job.requiredCapability)
  ) {
    return `Worker "${worker.name}" does not have ${job.requiredCapability}`;
  }

  return null;
}

// Does the worker have this capability (and is it switched on)? Used to refuse a run that could never start.
export function workerHasCapability(
  worker: Pick<Worker, 'enabled' | 'capabilities'>,
  capability: string,
): boolean {
  return (
    worker.enabled &&
    (worker.capabilities ?? []).includes(capability as WorkerCapability)
  );
}

// The SQL clause (starting with " AND") restricting the queued jobs a claiming worker may take. `params` already holds
// $1..$5 with the worker id at $5; this pushes its own parameters. A legacy worker (null) takes only unpinned jobs
// that need no capability.
export function claimEligibilitySql(
  worker: Pick<Worker, 'models' | 'capabilities'> | null,
  params: unknown[],
): string {
  if (!worker) {
    return ' AND "targetWorkerId" IS NULL AND "requiredCapability" IS NULL';
  }

  let eligibility = ' AND ("targetWorkerId" IS NULL OR "targetWorkerId" = $5)';

  if (worker.models !== null) {
    params.push(worker.models);
    eligibility += ` AND model::text = ANY($${params.length}::text[])`;
  }

  params.push(worker.capabilities ?? []);
  eligibility += ` AND ("requiredCapability" IS NULL OR "requiredCapability" = ANY($${params.length}::text[]))`;

  return eligibility;
}
